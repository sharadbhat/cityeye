#!/usr/bin/env node
// Check generated assets without depending on browser rendering or live data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { CITIES, MAJOR_CITY_IDS } from './cities.mjs';

const outputDirectory = fileURLToPath(new URL('../output/', import.meta.url));
const expectedStages = {
  'downtown-roads': 1,
  'central-roads': 2,
  parks: 2,
  transit: 2,
  'urban-roads': 3,
  water: 3,
  'regional-roads': 4,
  rail: 4,
  'elevation-bands': 4,
  contours: 4,
  'country-clue': 5,
};
export function validateCitySvg(svg, id, city = CITIES[id]) {
  if (!city) throw new Error(`Unknown city: ${id}`);
  const entry = { id, label: city.label, file: `${id}-city-layered.svg`, errors: [], warnings: [], metrics: {} };
  validateSvg(svg, entry, city);
  entry.status = entry.errors.length ? 'failed' : 'passed';
  return entry;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const args = process.argv.slice(2);
let cityIds = MAJOR_CITY_IDS;
if (args.length) {
  if (args.length === 2 && args[0] === '--cities') cityIds = [...new Set(args[1].split(','))];
  else if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/validate-city-maps.mjs [--cities nyc,sf,...]\nDefault: validate all 15 requested cities. Report: output/city-validation.json');
    process.exit(0);
  } else throw new Error('Expected --cities followed by comma-separated city ids.');
}
if (!cityIds.length || cityIds.some((id) => !CITIES[id])) throw new Error('Unknown or empty city list.');

const report = { validatedAt: new Date().toISOString(), expectedCities: cityIds.length, passed: 0, failed: 0, cities: [] };
for (const id of cityIds) {
  const entry = { id, label: CITIES[id].label, file: `${id}-city-layered.svg`, errors: [], warnings: [], metrics: {} };
  try {
    const svg = await readFile(join(outputDirectory, entry.file), 'utf8');
    validateSvg(svg, entry);
  } catch (error) {
    entry.errors.push(error.code === 'ENOENT' ? 'Missing layered SVG.' : error.message);
  }
  entry.status = entry.errors.length ? 'failed' : 'passed';
  report[entry.status] += 1;
  report.cities.push(entry);
  const counts = entry.metrics;
  console.log(`${entry.status === 'passed' ? 'PASS' : 'FAIL'} ${id}: ${counts.parks ?? 0} parks, ${counts.transit ?? 0} transit paths, ${counts.waterAreas ?? 0} water areas, ${counts.waterLines ?? 0} water lines${entry.warnings.length ? `; ${entry.warnings.join(' ')}` : ''}`);
  for (const error of entry.errors) console.error(`  ${error}`);
}
await mkdir(outputDirectory, { recursive: true });
await writeFile(join(outputDirectory, 'city-validation.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`Validated ${report.passed}/${report.expectedCities} city maps; ${report.failed} failed. Report: output/city-validation.json`);
if (report.failed) process.exitCode = 1;
}

function validateSvg(svg, entry, city = CITIES[entry.id]) {
  entry.metrics.bytes = Buffer.byteLength(svg, 'utf8');
  if (/\b(?:NaN|undefined|Infinity)\b/.test(svg)) entry.errors.push('Asset contains invalid non-finite or undefined values.');
  const root = svg.match(/<svg\b([^>]*)>/);
  if (!root || attributes(root[1]).viewBox !== '0 0 800 800') entry.errors.push('SVG must use the 800 × 800 world viewport.');
  const metadataMatch = svg.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/);
  if (!metadataMatch) entry.errors.push('Missing SVG metadata.');
  else {
    try {
      const metadata = JSON.parse(decodeXml(metadataMatch[1]));
      entry.metrics.source = metadata.source;
      entry.metrics.release = metadata.release;
      validateCameras(metadata.cameras, entry.errors);
      if (metadata.country !== city.country) entry.errors.push('Country metadata does not match the city configuration.');
    } catch (error) {
      entry.errors.push(`Invalid SVG metadata: ${error.message}`);
    }
  }

  // Allow geometry semantics such as fill-rule and vector-effect, but leave
  // actual paint, opacity, and dimensions to the consuming HTML/React CSS.
  const bakedPaint = [];
  for (const match of svg.matchAll(/<([A-Za-z][\w:.-]*)\b([^<>]*)>/g)) {
    const attrs = attributes(match[2]);
    for (const attribute of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'color']) {
      if (attribute in attrs) bakedPaint.push(attribute);
    }
    if (attrs.style && /(?:^|;)\s*(?:fill|stroke|color|opacity)(?:-[\w-]+)?\s*:/.test(attrs.style)) bakedPaint.push('style');
  }
  if (/<style\b/i.test(svg)) bakedPaint.push('style element');
  if (bakedPaint.length) entry.errors.push(`Baked visual styling found: ${[...new Set(bakedPaint)].join(', ')}.`);

  const groups = new Map();
  for (const match of svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)) {
    const attrs = attributes(match[1]);
    if (!attrs['data-layer']) continue;
    const name = attrs['data-layer'];
    if (groups.has(name)) entry.errors.push(`Duplicate layer: ${name}.`);
    groups.set(name, { stage: Number(attrs['data-reveal-stage']), content: match[2] });
  }
  for (const [name, stage] of Object.entries(expectedStages)) {
    if (!groups.has(name)) entry.errors.push(`Missing ${name} layer.`);
    else if (groups.get(name).stage !== stage) entry.errors.push(`${name} must reveal at stage ${stage}.`);
  }

  const paths = [...svg.matchAll(/<path\b([^>]*)\/?\s*>/g)].map((match) => attributes(match[1]));
  const byClass = (name) => paths.filter((path) => (path.class ?? '').split(/\s+/).includes(name));
  const downtownPaths = [...(groups.get('downtown-roads')?.content ?? '').matchAll(/<path\b([^>]*)\/?\s*>/g)].map((match) => attributes(match[1]));
  const parks = byClass('park');
  const waterAreas = byClass('water-area');
  const waterLines = byClass('water-line');
  const roads = byClass('road');
  const transit = byClass('transit');
  entry.metrics = {
    ...entry.metrics,
    paths: paths.length,
    roadPaths: roads.length,
    roadSubpaths: roads.reduce((total, path) => total + (path.d?.match(/[Mm]/g)?.length ?? 0), 0),
    downtownRoadPaths: downtownPaths.length,
    parks: parks.length,
    transit: transit.length,
    rail: byClass('rail').length,
    waterAreas: waterAreas.length,
    waterLines: waterLines.length,
    elevationBands: byClass('elevation-band').length,
    contours: byClass('contour').length,
    polygonsWithHoles: [...parks, ...waterAreas].filter((path) => (path.d?.match(/[Mm]/g)?.length ?? 0) > 1).length,
  };
  if (!downtownPaths.length || downtownPaths.every((path) => !path.d?.trim())) entry.errors.push('Downtown roads are empty.');
  if (!parks.length) entry.errors.push('Parks are empty.');
  if (!waterAreas.length && !waterLines.length) entry.warnings.push('No eligible major water features.');
  if (!transit.length) entry.warnings.push('No classified passenger transit geometry.');
  if (!entry.metrics.elevationBands) entry.warnings.push('No elevation bands.');

  let invalidPaths = 0;
  for (const path of paths) {
    const d = path.d ?? '';
    if (!d.trim() || /[^\s,MLZmlz+\-.0-9eE]/.test(d) || !/^[Mm]/.test(d)) invalidPaths += 1;
    const numbers = d.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
    if (numbers.length % 2 || numbers.some((number) => !Number.isFinite(number))) invalidPaths += 1;
  }
  if (invalidPaths) entry.errors.push(`${invalidPaths} malformed or empty paths.`);
  if (roads.some((path) => /[Zz]/.test(path.d ?? ''))) entry.errors.push('Road paths must not contain closed polygon subpaths.');

  const polygons = [...parks, ...waterAreas];
  const badPolygons = polygons.filter((path) => {
    const commands = path.d ?? '';
    const starts = commands.match(/[Mm]/g)?.length ?? 0;
    const closes = commands.match(/[Zz]/g)?.length ?? 0;
    return path['fill-rule'] !== 'evenodd' || !starts || starts !== closes;
  });
  if (badPolygons.length) entry.errors.push(`${badPolygons.length} polygon paths lack closed even-odd rings.`);
  // Lines may cross the viewport edge, but clipped filled areas must remain in
  // the world frame so distant ocean vertices do not bloat or distort the SVG.
  const unboundedWater = waterAreas.filter((path) => {
    const coordinates = path.d?.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number) ?? [];
    return coordinates.some((number) => number < -0.05 || number > 800.05);
  });
  if (unboundedWater.length) entry.errors.push(`${unboundedWater.length} filled water polygons extend beyond the clipped regional viewport.`);
}

function validateCameras(cameras, errors) {
  if (!cameras || Object.keys(cameras).sort().join(',') !== '1,2,3,4,5') {
    errors.push('Exactly five camera frames (1–5) are required.');
    return;
  }
  let previousWidth = 0;
  for (const stage of [1, 2, 3, 4, 5]) {
    const camera = cameras[stage];
    if (!Array.isArray(camera) || camera.length !== 4 || !camera.every(Number.isFinite)) {
      errors.push(`Stage ${stage} camera requires four finite numeric bounds.`);
      continue;
    }
    const [x, y, width, height] = camera;
    if (x < -0.05 || y < -0.05 || width <= 0 || height <= 0 || x + width > 800.05 || y + height > 800.05) errors.push(`Stage ${stage} camera falls outside the world viewport.`);
    if (width < previousWidth) errors.push(`Stage ${stage} camera zooms inward.`);
    previousWidth = width;
  }
}

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [match[1], decodeXml(match[2] ?? match[3])]));
}

function decodeXml(value) {
  return value.replace(/&(?:quot|apos|lt|gt|amp|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    if (/^&#x/i.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
    if (/^&#/.test(entity)) return String.fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
    return { '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }[entity.toLowerCase()];
  });
}
