#!/usr/bin/env node

/** Build the global guess catalog from GeoNames' downloadable city records. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { availableCityMaps } from './available-city-maps.mjs';
import { loadPlayableCities, PLAYABLE_GEO_NAMES } from './playable-cities.mjs';
import { normalizeCityQuery } from '../src/lib/city-search.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = 'https://download.geonames.org/export/dump/';
export const MIN_CITY_POPULATION = 100_000;
export const CITY_FEATURE_CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLG', 'PPLF']);
const EXTRA_ALIASES = { nyc: ['NYC', 'New York'], sf: ['SF'], la: ['LA', 'L.A.'], philly: ['Philly'], slc: ['SLC'] };

export function parseCountries(text) {
  return new Map(text.split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const columns = line.split('\t');
    return [columns[0], columns[4]];
  }));
}

export function parseRegions(text) {
  return new Map(text.split(/\r?\n/).filter(Boolean).map((line) => {
    const [code, name] = line.split('\t');
    return [code, name];
  }));
}

export function parseCityRecords(text, countries, regions) {
  const cities = new Map();
  const omitted = new Map();
  let omittedPopulationCount = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const columns = line.split('\t');
    const code = columns[7];
    if (columns[6] !== 'P' || !CITY_FEATURE_CODES.has(code)) {
      omitted.set(code ?? 'invalid', (omitted.get(code ?? 'invalid') ?? 0) + 1);
      continue;
    }
    const id = Number(columns[0]);
    const latitude = Number(columns[4]);
    const longitude = Number(columns[5]);
    const population = Number(columns[14] || 0);
    const name = columns[1]?.trim();
    const countryCode = columns[8];
    if (!Number.isSafeInteger(id) || id <= 0 || !name || !countries.has(countryCode)
      || !Number.isFinite(latitude) || Math.abs(latitude) > 90
      || !Number.isFinite(longitude) || Math.abs(longitude) > 180
      || !Number.isSafeInteger(population) || population < 0) {
      throw new Error(`Invalid GeoNames city record ${columns[0] ?? '(missing id)'}.`);
    }
    // Apply the same cutoff to administrative seats; no small-town exceptions.
    if (population < MIN_CITY_POPULATION) {
      omittedPopulationCount += 1;
      continue;
    }
    const aliases = [...new Set([columns[2], ...(columns[3] ?? '').split(',')].map((alias) => alias?.trim()).filter((alias) => alias && alias !== name))];
    const record = {
      id, name, region: regions.get(`${countryCode}.${columns[10]}`) ?? '',
      country: countries.get(countryCode), countryCode, latitude, longitude, population, aliases,
    };
    const previous = cities.get(id);
    if (!previous || previous.population < population) cities.set(id, record);
  }
  return { cities: [...cities.values()].sort((first, second) => first.id - second.id), omitted: Object.fromEntries(omitted), omittedPopulationCount };
}

/** Extract the expected TXT entry using ZIP's central directory and Node inflate. */
export function extractZipEntry(zip, expectedName) {
  let footer = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 65_557); offset -= 1) {
    if (zip.readUInt32LE(offset) === 0x06054b50) { footer = offset; break; }
  }
  if (footer < 0) throw new Error('GeoNames archive has no ZIP directory.');
  if (zip.readUInt16LE(footer + 4) || zip.readUInt16LE(footer + 6)) throw new Error('Multi-disk ZIP archives are unsupported.');
  const entries = zip.readUInt16LE(footer + 10);
  let offset = zip.readUInt32LE(footer + 16);
  for (let index = 0; index < entries; index += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('GeoNames archive has an invalid ZIP directory.');
    const flags = zip.readUInt16LE(offset + 8);
    const compression = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const size = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === expectedName) {
      if (flags & 1) throw new Error('Encrypted ZIP archives are unsupported.');
      if ([compressedSize, size, localOffset].includes(0xffffffff)) throw new Error('ZIP64 archives are unsupported.');
      if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('GeoNames archive has an invalid local header.');
      const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
      const compressed = zip.subarray(start, start + compressedSize);
      const content = compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : null;
      if (!content) throw new Error(`Unsupported ZIP compression method: ${compression}.`);
      if (content.length !== size || crc32(content) !== crc) throw new Error('GeoNames archive failed its size/checksum verification.');
      return content.toString('utf8').replace(/^\uFEFF/, '');
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`GeoNames archive does not contain ${expectedName}.`);
}

function crc32(content) {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  let crc = 0xffffffff;
  for (const value of content) crc = table[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function cachedDownload(file, cacheDirectory, refresh) {
  const output = join(cacheDirectory, file);
  if (!refresh) {
    try { return await readFile(output); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  console.log(`Downloading ${SOURCE}${file}`);
  const response = await fetch(`${SOURCE}${file}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`GeoNames ${file} download failed: HTTP ${response.status}.`);
  const content = Buffer.from(await response.arrayBuffer());
  await mkdir(cacheDirectory, { recursive: true });
  await atomicWrite(output, content);
  return content;
}

async function atomicWrite(file, content) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, file);
}

export async function buildCityCatalog({ cacheDirectory = join(ROOT, 'output/source/geonames'), outputDirectory = join(ROOT, 'data'), refresh = false } = {}) {
  const [zip, countriesText, regionsText] = await Promise.all([
    cachedDownload('cities15000.zip', cacheDirectory, refresh),
    cachedDownload('countryInfo.txt', cacheDirectory, refresh),
    cachedDownload('admin1CodesASCII.txt', cacheDirectory, refresh),
  ]);
  const { cities, omitted, omittedPopulationCount } = parseCityRecords(extractZipEntry(zip, 'cities15000.txt'), parseCountries(countriesText.toString('utf8')), parseRegions(regionsText.toString('utf8')));
  const catalog = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: 'GeoNames cities15000', url: `${SOURCE}cities15000.zip`,
      attribution: 'GeoNames', attributionUrl: 'https://www.geonames.org/',
      license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      minimumPopulation: MIN_CITY_POPULATION,
      scope: 'Cities with a recorded population of at least 100,000; smaller administrative seats and historical, abandoned, and neighborhood features excluded.',
    },
    omittedFeatureCodes: omitted,
    omittedPopulationCount,
    cities,
  };
  // Verify existing map-to-city identities before adding game-friendly short names.
  const available = await availableCityMaps({ mapDirectory: join(ROOT, 'output') });
  const playable = loadPlayableCities(catalog, available);
  const byId = new Map(cities.map((city) => [city.id, city]));
  for (const [key, aliases] of Object.entries(EXTRA_ALIASES)) {
    const record = byId.get(PLAYABLE_GEO_NAMES[key].id);
    for (const alias of aliases) {
      if (![record.name, ...record.aliases].some((name) => normalizeCityQuery(name) === normalizeCityQuery(alias))) record.aliases.push(alias);
    }
  }
  await atomicWrite(join(outputDirectory, 'city-catalog.json'), JSON.stringify(catalog));
  await atomicWrite(join(outputDirectory, 'playable-cities.json'), JSON.stringify(playable, null, 2) + '\n');
  console.log(`Built ${cities.length.toLocaleString('en-US')} cities across ${new Set(cities.map((city) => city.countryCode)).size} countries/territories; ${playable.length} verified playable maps.`);
  console.log(`Excluded feature codes: ${JSON.stringify(omitted)}`);
  console.log(`Wrote ${join(outputDirectory, 'city-catalog.json')} and ${join(outputDirectory, 'playable-cities.json')}`);
  return { catalog, playable };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const unknown = process.argv.slice(2).find((argument) => argument !== '--refresh');
  if (unknown) throw new Error(`Unknown argument: ${unknown}. Usage: node scripts/build-city-catalog.mjs [--refresh]`);
  await buildCityCatalog({ refresh: process.argv.includes('--refresh') });
}
