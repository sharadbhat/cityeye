import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableCityMaps } from './available-city-maps.mjs';
import { CITIES } from './cities.mjs';
import { loadPlayableCities } from './playable-cities.mjs';
import { packCatalog } from '../src/lib/catalog-format.mjs';
import { publicMapSvg } from './public-map.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let cities;
let catalog;
const args = process.argv.slice(2);
if (args.some(argument => argument !== '--all-generated')) throw new Error('Unknown prepare-app argument.');
try {
  cities = args.includes('--all-generated')
    ? Object.keys(await availableCityMaps({ mapDirectory: resolve(root, 'output') })).map(key => ({ key }))
    : JSON.parse(await readFile(resolve(root, 'data/playable-cities.json'), 'utf8'));
  catalog = JSON.parse(await readFile(resolve(root, 'data/city-catalog.json'), 'utf8'));
} catch {
  console.error('City directory is missing. Run npm run catalog first (requires internet once).');
  process.exit(1);
}
if (!Array.isArray(cities) || !cities.length) throw new Error('No playable cities configured.');
const definitions = Object.fromEntries(cities.map(city => {
  if (!/^[a-z0-9-]+$/.test(city.key) || !CITIES[city.key]) throw new Error('Invalid map key.');
  return [city.key, CITIES[city.key]];
}));
cities = loadPlayableCities(catalog, definitions);
const destination = resolve(root, 'public/maps');
await mkdir(destination, { recursive: true });
for (const city of cities) {
  const source = resolve(root, 'output', `${city.key}-city-layered.svg`);
  const target = resolve(destination, `${city.id}.svg`);
  await writeChanged(target, publicMapSvg(await readFile(source, 'utf8')));
}
// Retire only known generated, city-named public copies; keep them recoverable
// outside public/ so Vite will not include them in future deployments.
const archive = resolve(root, 'output/legacy-public-maps');
let archived = 0;
for (const key of Object.keys(CITIES)) {
  const name = `${key}-city-layered.svg`;
  const oldFile = resolve(destination, name);
  const exists = await stat(oldFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (!exists) continue;
  if (!exists.isFile()) throw new Error(`Expected a generated map file: ${oldFile}`);
  await mkdir(archive, { recursive: true });
  await rename(oldFile, resolve(archive, `${key}-${Date.now()}-${process.pid}.svg`));
  archived++;
}
const dataDirectory = resolve(root, 'public/data');
await mkdir(dataDirectory, { recursive: true });
const compact = JSON.stringify(packCatalog(catalog));
const catalogFile = `cities-${createHash('sha256').update(compact).digest('hex').slice(0, 12)}.json`;
await writeChanged(resolve(dataDirectory, catalogFile), compact);
// Publish the manifest last, only after every referenced static asset exists.
await writeChanged(resolve(dataDirectory, 'game-data.json'), JSON.stringify({ version: 1, catalogFile, playableIds: cities.map(city => city.id) }));
console.log(`Prepared ${cities.length} ID-named maps and a ${(Buffer.byteLength(compact) / 1024 / 1024).toFixed(2)} MB static catalog.`);
if (archived) console.log(`Archived ${archived} old city-named public copies in output/legacy-public-maps (recoverable).`);

async function writeChanged(file, content) {
  const previous = await readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (previous === content) return;
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, file);
}
