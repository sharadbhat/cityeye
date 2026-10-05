#!/usr/bin/env node

/**
 * Generate progressive, north-up city-guessing map SVGs from cached Overture data.
 *
 * Default city: Salt Lake City, Utah.
 * Default output: one layered SVG. Use --stage only for an inspection export.
 *
 *   1. Downtown street grid
 *   2. Central city: parks and rail/transit
 *   3. Urban structure: arterial roads and major water features
 *   4. Regional context: freeways and elevation
 *   5. Regional context plus country clue
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { joinRoadSegments } from './road-paths.mjs';
import { isMajorWaterFeature, MIN_WATER_AREA_SQUARE_METERS } from './water-features.mjs';
import { CITIES } from './cities.mjs';
import { geometryParts, netAreaSquareMeters } from './map-geometry.mjs';
import { elevationScale, topographicElevation } from './elevation-scale.mjs';
import { OVERTURE_RELEASE, OVERTURE_PACKAGE } from './map-source.mjs';
import { runProcess } from './run-process.mjs';

const OUTPUT_DIRECTORY = fileURLToPath(new URL('../output/', import.meta.url));
const downloadController = new AbortController();
process.once('SIGTERM', () => downloadController.abort());
process.once('SIGINT', () => downloadController.abort());

const ROAD_CLASSES = new Set(['residential', 'unclassified', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']);

const options = parseArguments(process.argv.slice(2));
const city = CITIES[options.city];

if (!city) {
  throw new Error(`Unknown city "${options.city}". Available cities: ${Object.keys(CITIES).join(', ')}`);
}

const data = await fetchOverture(city);
const features = classifyFeatures(data.elements);
const stages = options.stage ? [options.stage] : [];
const terrain = !options.stage || options.stage >= 4 ? await loadTerrain(city) : null;

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
for (const stage of stages) {
  const output = options.output ?? join(OUTPUT_DIRECTORY, `${options.city}-city-stage-${stage}.svg`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, renderSvg({ city, features, stage, terrain }), 'utf8');
  console.log(`Wrote ${output}`);
}

if (!options.stage) {
  const layeredOutput = join(OUTPUT_DIRECTORY, `${options.city}-city-layered.svg`);
  const temporaryOutput = `${layeredOutput}.${process.pid}.tmp`;
  await writeFile(temporaryOutput, renderLayeredSvg({ city, features, terrain }), 'utf8');
  await rename(temporaryOutput, layeredOutput);
  const previewPath = join(OUTPUT_DIRECTORY, 'slc-layer-preview.html');
  if (options.city === 'slc') {
    const preview = await readFile(previewPath, 'utf8');
    const svg = await readFile(layeredOutput, 'utf8');
    await writeFile(previewPath, preview.replace(/<template id="map-geometry">[\s\S]*?<\/template>/, `<template id="map-geometry">${svg.replace(/<\?xml[^>]*\?>/, '')}</template>`), 'utf8');
  }
  console.log(`Wrote ${layeredOutput}`);
}

console.log(`[${options.city}] Roads: ${features.roads.length}; transit: ${features.transit.length}; parks: ${features.landscape.filter((feature) => feature.kind === 'park').length}; water: ${features.landscape.filter((feature) => feature.kind !== 'park').length}; terrain tiles: ${terrain?.tiles.size ?? 0}`);

function parseArguments(args) {
  const parsed = { city: 'slc', output: null, stage: null, fingerprint: null };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === '--city' && value) {
      parsed.city = value;
      index += 1;
    } else if (argument === '--fingerprint' && value && /^[a-f0-9]{64}$/.test(value)) {
      parsed.fingerprint = value;
      index += 1;
    } else if (argument === '--stage' && value) {
      parsed.stage = Number(value);
      index += 1;
    } else if (argument === '--output' && value) {
      parsed.output = value;
      index += 1;
    } else if (argument === '--help') {
      console.log(`Usage: node scripts/generate-city-map-svg.mjs [--city ${Object.keys(CITIES).join('|')}] [--stage 1..5] [--output path]`);
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  if (parsed.stage !== null && (!Number.isInteger(parsed.stage) || parsed.stage < 1 || parsed.stage > 5)) {
    throw new Error('--stage must be an integer from 1 to 5.');
  }
  if (parsed.output && !parsed.stage) {
    throw new Error('--output can only be used together with --stage.');
  }
  return parsed;
}

async function fetchOverture(city) {
  const cacheDirectory = join(OUTPUT_DIRECTORY, 'source');
  const bbox = cityBoundingBox(city, city.radii[3]).join(',');
  const types = ['segment', 'water', 'land_use'];
  await mkdir(cacheDirectory, { recursive: true });
  const results = await Promise.allSettled(types.map(async (type) => {
    const cacheKey = city.geoNames
      ? `${options.city}-${OVERTURE_RELEASE}-${createHash('sha256').update(bbox).digest('hex').slice(0, 12)}`
      : city.label.toLowerCase().replaceAll(' ', '-');
    const file = `${cacheDirectory}/${cacheKey}-${type}.geojson`;
    try {
      return await readOvertureElements(file, type, city);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Preserve bad caches for diagnosis; retries must not keep rereading them.
        if (error.code && !['ERR_INVALID_ARG_VALUE'].includes(error.code)) throw error;
        await rename(file, `${file}.invalid-${Date.now()}`);
      }
      console.log(`[${city.label}] Downloading Overture ${type}...`);
      await runOvertureDownload({ bbox, type, file });
      return readOvertureElements(file, type, city);
    }
  }));
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  const collections = results.map(result => result.value);
  if (city.transitOverlay) {
    const overlay = city.transitOverlay;
    const file = join(cacheDirectory, overlay.file);
    try {
      collections.push(await readOvertureElements(file, 'segment', city));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      console.log(`[${city.label}] Downloading official passenger-rail geometry...`);
      await runPythonDownload(fileURLToPath(new URL(overlay.downloader, import.meta.url)), ['--output', file], 'passenger rail');
      collections.push(await readOvertureElements(file, 'segment', city));
    }
  }
  return { elements: collections.flat() };
}

async function readOvertureElements(file, type, city) {
  // The official CLI writes one feature per line. Stream those records so a
  // dense city can exceed V8's string limit without loading its whole source.
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const elements = [];
  let header = false;
  let complete = false;
  try {
    for await (const raw of lines) {
      let line = raw.trim();
      if (!line) continue;
      if (!header && line.includes('"FeatureCollection"') && line.includes('"features"')) {
        header = true;
        continue;
      }
      if (line.endsWith(']}')) {
        complete = true;
        line = line.slice(0, -2).trim();
        if (!line) continue;
      }
      const feature = JSON.parse(line.endsWith(',') ? line.slice(0, -1) : line);
      if (feature.type !== 'Feature') throw new Error(`Unexpected record in ${file}.`);
      for (const element of overtureElements([feature], type, city)) elements.push(element);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  if (!header || !complete) throw new Error(`Incomplete Overture GeoJSON cache: ${file}`);
  return elements;
}

function runOvertureDownload({ bbox, type, file }) {
  const downloader = fileURLToPath(new URL('./download-overture.py', import.meta.url));
  return runPythonDownload(downloader, [`--bbox=${bbox}`, `--type=${type}`, '--release', OVERTURE_RELEASE, '--output', file], `Overture ${type}`);
}

function runPythonDownload(script, arguments_, label) {
  const args = ['--from', OVERTURE_PACKAGE, 'python', '-X', 'utf8', script, ...arguments_];
  return retry(() => runProcess('uvx', args, { timeoutMs: 15 * 60_000, signal: downloadController.signal }).catch(error => { throw new Error(`${label}: ${error.message}`); }));
}

async function retry(operation, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      downloadController.signal.throwIfAborted();
      if (attempt >= attempts) throw error;
      console.warn(`Retry ${attempt}/${attempts - 1}: ${error.message.slice(0, 300)}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
    }
  }
}

function cityBoundingBox(city, radius) {
  const latitudeDelta = radius / 110_574;
  const longitudeDelta = radius / (111_320 * Math.cos((city.latitude * Math.PI) / 180));
  return [city.longitude - longitudeDelta, city.latitude - latitudeDelta, city.longitude + longitudeDelta, city.latitude + latitudeDelta].map((value) => value.toFixed(6));
}

function overtureElements(features, type, city) {
  const bounds = cityBoundingBox(city, city.radii[3]).map(Number);
  return features.flatMap((feature) => {
    const properties = feature.properties ?? {};
    if (type === 'segment' && !(properties.subtype === 'rail' || (properties.subtype === 'road' && ROAD_CLASSES.has(properties.class)))) return [];
    if (type === 'land_use' && properties.subtype !== 'park') return [];
    if (type === 'water' && !isMajorWaterFeature(properties, feature.geometry?.type)) return [];
    const kind = type === 'segment' ? properties.subtype : type;
    const railFlags = new Set((properties.rail_flags ?? []).flatMap((flag) => flag.values ?? []));
    const isTransit = kind === 'rail'
      && !['is_abandoned', 'is_disused', 'is_freight'].some((flag) => railFlags.has(flag))
      && (['light_rail', 'tram', 'subway', 'monorail'].includes(properties.class)
        || (city.transitRailNames ?? []).some((name) => (properties.names?.primary ?? '').toLowerCase().includes(name.toLowerCase())));
    const tags = kind === 'road'
      ? { highway: properties.class ?? 'unclassified' }
      : kind === 'rail'
        ? { railway: properties.class === 'light_rail' ? 'light_rail' : 'rail' }
        : kind === 'land_use'
          ? { leisure: 'park' }
          : feature.geometry?.type.includes('Line')
            ? { waterway: properties.class ?? 'river' }
            : { natural: 'water' };
    return geometryParts(feature.geometry, bounds).map((part, index) => ({
      type: 'way', id: `${feature.id ?? type}-${index}`, tags, isTransit,
      waterKind: type === 'water' ? properties.subtype : null,
      ...part,
    })).filter((element) => element.geometry.length > 1 && element.geometry.every((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat)));
  });
}

function classifyFeatures(elements) {
  const roads = [];
  const rail = [];
  const transit = [];
  const landscape = [];

  for (const element of elements) {
    const tags = element.tags ?? {};
    if (element.type === 'way' && Array.isArray(element.geometry) && element.geometry.length > 1) {
      if (tags.highway) roads.push(element);
      else if (tags.railway) (element.isTransit ? transit : rail).push(element);
      else if (tags.leisure === 'park' && isUsefulLandscape(element, 'park')) landscape.push({ element, kind: 'park' });
      else if ((tags.natural === 'water' || tags.waterway === 'riverbank') && isUsefulLandscape(element, 'water-area')) landscape.push({ element, kind: 'water-area' });
      else if (tags.waterway && isUsefulLandscape(element, 'water-line')) landscape.push({ element, kind: 'water-line' });
    }
  }

  return {
    roads,
    rail,
    transit,
    landscape,
  };
}

function renderSvg({ city, features, stage, terrain }) {
  const radius = city.radii[Math.min(stage, 4) - 1];
  const viewport = createViewport(city, radius, 800);
  const roads = features.roads.filter((road) => roadIsVisible(road, city, stage, radius));
  const rail = stage >= 4 ? features.rail.filter((feature) => touchesRadius(feature.geometry, city, radius)) : [];
  const transit = stage >= 2 ? features.transit.filter((feature) => touchesRadius(feature.geometry, city, radius)) : [];
  const landscape = features.landscape.filter(({ element, kind }) =>
    stage >= (kind === 'park' ? 2 : 3) && touchesRadius(element.geometry, city, radius));
  const elevationTint = stage >= 4 && terrain ? elevationBands(terrain, viewport) : [];
  const contours = stage >= 4 && terrain ? contourPaths(terrain, viewport) : [];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${city.label} city puzzle geometry from Overture Maps. Source attribution: OpenStreetMap contributors, ODbL. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="Mystery city map, north up">
  <title>Mystery city map</title>
  <desc>Stage ${stage}: ${stageDescription(stage)}.</desc>
  <rect width="100%" height="100%" fill="#f7f6f0"/>${elevationTint.length ? `
  <g data-city-layer="elevation-tint">${elevationTint.join('')}</g>` : ''}${contours.length ? `
  <g data-city-layer="topography">${contours.join('')}</g>` : ''}${landscape.length ? `
  <g data-city-layer="parks-and-water">${landscape.map(({ element, kind }) => wayPath(element, kind, viewport)).join('')}</g>` : ''}${roads.length ? `
  <g data-city-layer="roads">${roadPaths(roads, viewport, true)}</g>` : ''}${rail.length ? `
  <g data-city-layer="rail">${rail.map((line) => wayPath(line, 'rail', viewport)).join('')}</g>` : ''}${transit.length ? `
  <g data-city-layer="transit">${transit.map((line) => wayPath(line, 'transit', viewport)).join('')}</g>` : ''}${stage >= 4 ? `
  <text x="776" y="782" text-anchor="end" fill="#87928c" font-family="system-ui, sans-serif" font-size="10">Elevation data: USGS</text>` : ''}${stage === 5 ? `
  <g data-city-layer="country-clue"><rect x="24" y="24" width="185" height="48" rx="24" fill="#354745"/><text x="116.5" y="54" text-anchor="middle" fill="#f7f6f0" font-family="system-ui, sans-serif" font-size="18" font-weight="600">${escapeXml(city.country)}</text></g>` : ''}
</svg>
`;
}

function renderLayeredSvg({ city, features, terrain }) {
  const viewport = createViewport(city, city.radii[3], 800);
  const roadSets = [1, 2, 3, 4].map((stage) => new Set(
    features.roads.filter((road) => roadIsVisible(road, city, stage, city.radii[stage - 1])).map((road) => road.id),
  ));
  const newRoads = (stage) => features.roads.filter((road) => roadSets[stage - 1].has(road.id) && (stage === 1 || !roadSets[stage - 2].has(road.id)));
  const parks = features.landscape.filter(({ kind }) => kind === 'park');
  const water = features.landscape.filter(({ kind }) => kind !== 'park');
  const cameras = Object.fromEntries([1, 2, 3, 4, 5].map((stage) => [stage, cameraForRadius(city.radii[Math.min(stage, 4) - 1], city.radii[3])]));
  const sources = [
    { name: 'Overture Maps / OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
    { name: 'USGS SRTM elevation', url: 'https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm' },
    ...(city.transitOverlay ? [{ name: city.transitOverlay.attribution, url: city.transitOverlay.url }] : []),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- React-ready progressive city puzzle geometry. Data © OpenStreetMap contributors, ODbL. Elevation data: USGS. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="Mystery city map, north up">
  <metadata>${escapeXml(JSON.stringify({ cameras, country: city.country, cityKey: options.city, center: { latitude: city.latitude, longitude: city.longitude }, radiiMeters: city.radii, buildFingerprint: options.fingerprint, source: 'Overture Maps', sources, release: OVERTURE_RELEASE, stages: { 1: 'Downtown street grid', 2: 'Parks and public transit', 3: 'Major water features', 4: 'Regional roads, rail, and elevation', 5: 'Country clue' }, layers: ['elevation-bands', 'contours', 'parks', 'water', 'downtown-roads', 'central-roads', 'urban-roads', 'regional-roads', 'rail', 'transit', 'country-clue'] }))}</metadata>
  <g data-layer="elevation-bands" data-reveal-stage="4">${terrain ? elevationBands(terrain, viewport, 72, false).join('') : ''}</g>
  <g data-layer="contours" data-reveal-stage="4">${terrain ? contourPaths(terrain, viewport, 72, false).join('') : ''}</g>
  <g data-layer="parks" data-reveal-stage="2">${parks.map(({ element }) => semanticWayPath(element, 'park', viewport)).join('')}</g>
  <g data-layer="water" data-reveal-stage="3">${water.map(({ element, kind }) => semanticWayPath(element, kind, viewport)).join('')}</g>
  <g data-layer="downtown-roads" data-reveal-stage="1">${roadPaths(newRoads(1), viewport)}</g>
  <g data-layer="central-roads" data-reveal-stage="2">${roadPaths(newRoads(2), viewport)}</g>
  <g data-layer="urban-roads" data-reveal-stage="3">${roadPaths(newRoads(3), viewport)}</g>
  <g data-layer="regional-roads" data-reveal-stage="4">${roadPaths(newRoads(4), viewport)}</g>
  <g data-layer="rail" data-reveal-stage="4">${features.rail.map((line) => semanticWayPath(line, 'rail', viewport)).join('')}</g>
  <g data-layer="transit" data-reveal-stage="2">${features.transit.map((line) => semanticWayPath(line, 'transit', viewport)).join('')}</g>
  <g data-layer="country-clue" data-reveal-stage="5"><text class="country-clue" x="400" y="60" text-anchor="middle">${escapeXml(city.country)}</text></g>
</svg>
`;
}

function cameraForRadius(radius, regionalRadius) {
  const size = (radius / regionalRadius) * 800;
  return [Number(((800 - size) / 2).toFixed(2)), Number(((800 - size) / 2).toFixed(2)), Number(size.toFixed(2)), Number(size.toFixed(2))];
}

function semanticWayPath(element, className, viewport) {
  const isArea = element.isArea;
  const d = elementPathData(element, viewport);
  const waterKind = element.waterKind ? ` data-water-kind="${escapeXml(element.waterKind)}"` : '';
  return `<path class="${className}"${waterKind}${isArea ? ' fill-rule="evenodd"' : ''} d="${d}"/>`;
}

function elementPathData(element, viewport) {
  const rings = [element.geometry, ...(element.holes ?? [])];
  return rings.map((ring) => ring.map((point, index) => {
    const projected = project(point, viewport);
    return `${index === 0 ? 'M' : 'L'}${projected.x.toFixed(2)} ${projected.y.toFixed(2)}`;
  }).join(' ') + (element.isArea ? ' Z' : '')).join(' ');
}

function roadPaths(roads, viewport, styled = false) {
  const styles = {
    local: 'stroke="#8e9c94" stroke-width="1"',
    arterial: 'stroke="#64796c" stroke-width="1.8"',
    motorway: 'stroke="#354f41" stroke-width="2.8"',
  };
  return joinRoadSegments(roads).map(({ kind, lines }) => {
    const d = lines.map((line) => line.map((point, index) => {
      const projected = project(point, viewport);
      return `${index ? 'L' : 'M'}${projected.x.toFixed(3)} ${projected.y.toFixed(3)}`;
    }).join(' ')).join(' ');
    const style = styled ? ` fill="none" stroke-linecap="butt" stroke-linejoin="round" ${styles[kind]}` : '';
    return `<path class="road road--${kind}" vector-effect="non-scaling-stroke" d="${d}"${style}/>`;
  }).join('');
}

function roadIsVisible(road, city, stage, radius) {
  const nearest = Math.min(...road.geometry.map((point) => pointDistanceMeters(point, city)));
  if (nearest > radius) return false;
  const highway = road.tags.highway;
  const [downtown, central, urban] = city.radii;
  if (stage === 1) return nearest <= downtown;
  if (['residential', 'unclassified'].includes(highway)) return nearest <= downtown;
  if (highway === 'tertiary') return nearest <= central;
  if (highway === 'secondary') return nearest <= urban;
  return true;
}

function stageDescription(stage) {
  return ['Downtown street grid.', 'Central city with parks and rail/transit.', 'Urban structure, arterial roads, and water features.', 'Regional geography, freeways, and elevation.', 'Regional context with country clue.'][stage - 1];
}

function createViewport(city, radius, width) {
  const metersPerLongitudeDegree = 111_320 * Math.cos((city.latitude * Math.PI) / 180);
  const metersPerLatitudeDegree = 110_574;
  const span = radius * 2;
  return {
    minX: city.longitude * metersPerLongitudeDegree - span / 2,
    maxY: city.latitude * metersPerLatitudeDegree + span / 2,
    metersPerLongitudeDegree,
    metersPerLatitudeDegree,
    scale: width / span,
  };
}

function wayPath(element, kind, viewport) {
  const isArea = element.isArea;
  const d = elementPathData(element, viewport);
  const styles = {
    local: 'fill="none" stroke="#cdd3ce" stroke-width="1.3" stroke-linecap="round"',
    arterial: 'fill="none" stroke="#a7b1aa" stroke-width="2.2" stroke-linecap="round"',
    motorway: 'fill="none" stroke="#7e8b83" stroke-width="3.3" stroke-linecap="round"',
    rail: 'fill="none" stroke="#85979a" stroke-width="1" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"',
    transit: 'fill="none" stroke="#b94d46" stroke-width="1.8" vector-effect="non-scaling-stroke"',
    park: 'fill="#e1e9d8" stroke="none"',
    'water-area': 'fill="#d8e8ea" stroke="#bdd9dc" stroke-width="1"',
    'water-line': 'fill="none" stroke="#78afca" stroke-width="1"',
  };
  return `<path d="${d}"${isArea ? ' fill-rule="evenodd"' : ''} ${styles[kind]}/>`;
}

function touchesRadius(points, city, radius) {
  return points.some((point) => pointDistanceMeters(point, city) <= radius);
}

function isUsefulLandscape(element, kind) {
  // Rivers are split into network segments; short pieces still belong to the
  // same major river and must remain visible to preserve its continuity.
  if (kind === 'water-line') return element.waterKind === 'river' || lineLengthMeters(element.geometry) >= 700;
  return netAreaSquareMeters(element) >= (kind === 'park' ? 12_000 : MIN_WATER_AREA_SQUARE_METERS);
}

function project(point, viewport) {
  const x = point.lon * viewport.metersPerLongitudeDegree;
  const y = point.lat * viewport.metersPerLatitudeDegree;
  return { x: (x - viewport.minX) * viewport.scale, y: (viewport.maxY - y) * viewport.scale };
}

function pointDistanceMeters(first, second) {
  const latitude = first.lat ?? first.latitude;
  const longitude = first.lon ?? first.longitude;
  const latitudeRadians = ((latitude + second.latitude) / 2) * (Math.PI / 180);
  return Math.hypot((second.latitude - latitude) * 110_574, (second.longitude - longitude) * 111_320 * Math.cos(latitudeRadians));
}

function lineLengthMeters(points) {
  return points.slice(1).reduce((total, point, index) => total + pointDistanceMeters(points[index], { latitude: point.lat, longitude: point.lon }), 0);
}

function polygonAreaSquareMeters(points) {
  if (points.length < 4) return 0;
  const latitude = points.reduce((total, point) => total + point.lat, 0) / points.length;
  const longitudeScale = 111_320 * Math.cos((latitude * Math.PI) / 180);
  return Math.abs(points.slice(1).reduce((area, point, index) => area + (points[index].lon * longitudeScale) * (point.lat * 110_574) - (point.lon * longitudeScale) * (points[index].lat * 110_574), 0)) / 2;
}

function distancePixels(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

async function loadTerrain(city) {
  const radius = city.radii[3];
  const latitudeDelta = radius / 110_574;
  const longitudeDelta = radius / (111_320 * Math.cos((city.latitude * Math.PI) / 180));
  const tiles = [];
  for (let latitude = Math.floor(city.latitude - latitudeDelta); latitude <= Math.floor(city.latitude + latitudeDelta); latitude += 1) {
    for (let longitude = Math.floor(city.longitude - longitudeDelta); longitude <= Math.floor(city.longitude + longitudeDelta); longitude += 1) {
      tiles.push([latitude, longitude]);
    }
  }

  const cacheDirectory = join(OUTPUT_DIRECTORY, 'source', 'terrain');
  await mkdir(cacheDirectory, { recursive: true });
  const downloaded = await Promise.all(tiles.map(async ([latitude, longitude]) => {
    const name = hgtTileName(latitude, longitude);
    const file = join(cacheDirectory, `${name}.hgt.gz`);
    let compressed;
    try { compressed = await readFile(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (compressed) {
      try {
        const cachedBytes = gunzipSync(compressed);
        const dimension = Math.sqrt(cachedBytes.length / 2);
        if (!Number.isInteger(dimension) || dimension < 2) throw new Error('Invalid tile size');
      } catch {
        await rename(file, `${file}.invalid-${Date.now()}`);
        compressed = null;
      }
    }
    const url = `https://elevation-tiles-prod.s3.amazonaws.com/skadi/${name.slice(0, 3)}/${name}.hgt.gz`;
    if (!compressed) {
      compressed = await retry(async () => {
        const response = await fetch(url, { signal: AbortSignal.any([downloadController.signal, AbortSignal.timeout(60_000)]) });
        if (response.status === 404) return null; // Some wholly offshore tiles do not exist.
        if (!response.ok) throw new Error(`Elevation tile ${name} failed (${response.status}).`);
        return Buffer.from(await response.arrayBuffer());
      });
      if (!compressed) {
        console.warn(`[${city.label}] No elevation tile ${name}; leaving that offshore area unshaded.`);
        return null;
      }
      const temporaryFile = `${file}.${process.pid}.tmp`;
      await writeFile(temporaryFile, compressed);
      await rename(temporaryFile, file);
    }
    const bytes = gunzipSync(compressed);
    const dimension = Math.sqrt(bytes.length / 2);
    if (!Number.isInteger(dimension) || dimension < 2) throw new Error(`Invalid elevation tile ${name}.`);
    return [name, { latitude, longitude, bytes, dimension }];
  }));

  const validTiles = downloaded.filter(Boolean);
  if (!validTiles.length) throw new Error(`No elevation data available for ${city.label}.`);
  return { tiles: new Map(validTiles) };
}

function hgtTileName(latitude, longitude) {
  const lat = `${latitude >= 0 ? 'N' : 'S'}${String(Math.abs(latitude)).padStart(2, '0')}`;
  const lon = `${longitude >= 0 ? 'E' : 'W'}${String(Math.abs(longitude)).padStart(3, '0')}`;
  return `${lat}${lon}`;
}

function contourPaths(terrain, viewport, gridSize = 72, styled = true) {
  const values = [];
  for (let row = 0; row <= gridSize; row += 1) {
    const valuesRow = [];
    for (let column = 0; column <= gridSize; column += 1) {
      const x = (column / gridSize) * 800;
      const y = (row / gridSize) * 800;
      const value = elevationAt(terrain, unproject({ x, y }, viewport));
      valuesRow.push(value);
    }
    values.push(valuesRow);
  }

  const levels = elevationScale(values).contours;

  return levels.map((level) => {
    let d = '';
    for (let row = 0; row < gridSize; row += 1) {
      for (let column = 0; column < gridSize; column += 1) {
        const cell = {
          topLeft: values[row][column],
          topRight: values[row][column + 1],
          bottomRight: values[row + 1][column + 1],
          bottomLeft: values[row + 1][column],
          x: (column / gridSize) * 800,
          y: (row / gridSize) * 800,
          size: 800 / gridSize,
        };
        if (![cell.topLeft, cell.topRight, cell.bottomLeft, cell.bottomRight].every(Number.isFinite)) continue;
        for (const [first, second] of contourSegments(cell, level)) {
          d += `M${first.x.toFixed(1)} ${first.y.toFixed(1)}L${second.x.toFixed(1)} ${second.y.toFixed(1)}`;
        }
      }
    }
    if (!d) return '';
    return styled
      ? `<path d="${d}" fill="none" stroke="#c5cec7" stroke-width="0.9" opacity="0.8"/>`
      : `<path class="contour" data-elevation="${level}" d="${d}"/>`;
  }).filter(Boolean);
}

function elevationBands(terrain, viewport, gridSize = 72, styled = true) {
  const values = [];
  for (let row = 0; row <= gridSize; row += 1) {
    const valuesRow = [];
    for (let column = 0; column <= gridSize; column += 1) {
      const value = elevationAt(terrain, unproject({ x: (column / gridSize) * 800, y: (row / gridSize) * 800 }, viewport));
      valuesRow.push(value);
    }
    values.push(valuesRow);
  }

  const bands = elevationScale(values).bands;

  const size = 800 / gridSize;
  return bands.map(({ lower, upper, amount }, index) => {
    let d = '';
    for (let row = 0; row < gridSize; row += 1) {
      for (let column = 0; column < gridSize; column += 1) {
        const polygon = [
          { x: column * size, y: row * size, value: values[row][column] },
          { x: (column + 1) * size, y: row * size, value: values[row][column + 1] },
          { x: (column + 1) * size, y: (row + 1) * size, value: values[row + 1][column + 1] },
          { x: column * size, y: (row + 1) * size, value: values[row + 1][column] },
        ];
        if (!polygon.every((point) => Number.isFinite(point.value))) continue;
        const band = clipElevationBand(polygon, lower, upper);
        if (band.length >= 3) {
          d += `M${band.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join('L')}Z`;
        }
      }
    }
    if (!d) return '';
    return styled
      ? `<path d="${d}" fill="${elevationColor(amount)}"/>`
      : `<path class="elevation-band elevation-band--${index}" data-elevation-min="${lower}" data-elevation-max="${upper}" data-elevation-normalized="${amount.toFixed(4)}" d="${d}"/>`;
  }).filter(Boolean);
}

function clipElevationBand(polygon, lower, upper) {
  return clipPolygon(clipPolygon(polygon, lower, true), upper, false);
}

function clipPolygon(polygon, threshold, keepAbove) {
  if (!polygon.length) return [];
  const output = [];
  for (let index = 0; index < polygon.length; index += 1) {
    const first = polygon[index];
    const second = polygon[(index + 1) % polygon.length];
    const firstInside = keepAbove ? first.value >= threshold : first.value <= threshold;
    const secondInside = keepAbove ? second.value >= threshold : second.value <= threshold;
    if (firstInside) output.push(first);
    if (firstInside !== secondInside) {
      const ratio = (threshold - first.value) / (second.value - first.value);
      output.push({
        x: first.x + (second.x - first.x) * ratio,
        y: first.y + (second.y - first.y) * ratio,
        value: threshold,
      });
    }
  }
  return output;
}

function elevationColor(amount) {
  const low = [255, 255, 255];
  const high = [170, 170, 170];
  const channel = (index) => Math.round(low[index] + (high[index] - low[index]) * amount).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

function contourSegments(cell, level) {
  const edges = [
    [cell.topLeft, cell.topRight, { x: cell.x, y: cell.y }, { x: cell.x + cell.size, y: cell.y }],
    [cell.topRight, cell.bottomRight, { x: cell.x + cell.size, y: cell.y }, { x: cell.x + cell.size, y: cell.y + cell.size }],
    [cell.bottomRight, cell.bottomLeft, { x: cell.x + cell.size, y: cell.y + cell.size }, { x: cell.x, y: cell.y + cell.size }],
    [cell.bottomLeft, cell.topLeft, { x: cell.x, y: cell.y + cell.size }, { x: cell.x, y: cell.y }],
  ];
  const points = edges.flatMap(([firstValue, secondValue, first, second]) => {
    if (!Number.isFinite(firstValue) || !Number.isFinite(secondValue) || (firstValue >= level) === (secondValue >= level)) return [];
    const ratio = (level - firstValue) / (secondValue - firstValue);
    return [{ x: first.x + (second.x - first.x) * ratio, y: first.y + (second.y - first.y) * ratio }];
  });
  if (points.length === 2) return [[points[0], points[1]]];
  if (points.length === 4) return [[points[0], points[1]], [points[2], points[3]]];
  return [];
}

function elevationAt(terrain, point) {
  const latitude = Math.floor(point.lat);
  const longitude = Math.floor(point.lon);
  const tile = terrain.tiles.get(hgtTileName(latitude, longitude));
  if (!tile) return NaN;
  const dimension = tile.dimension;
  const x = Math.max(0, Math.min(dimension - 1, Math.round((point.lon - longitude) * (dimension - 1))));
  const y = Math.max(0, Math.min(dimension - 1, Math.round(((latitude + 1) - point.lat) * (dimension - 1))));
  const value = tile.bytes.readInt16BE((y * dimension + x) * 2);
  return topographicElevation(value);
}

function unproject(point, viewport) {
  return {
    lon: (viewport.minX + point.x / viewport.scale) / viewport.metersPerLongitudeDegree,
    lat: (viewport.maxY - point.y / viewport.scale) / viewport.metersPerLatitudeDegree,
  };
}

function escapeXml(value) {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character]);
}
