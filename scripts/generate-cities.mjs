#!/usr/bin/env node
// Generate requested city maps in a bounded pool. Existing source caches are reused.
import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CITIES, MAJOR_CITY_IDS } from './cities.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const generator = fileURLToPath(new URL('./generate-city-map-svg.mjs', import.meta.url));
const outputDirectory = join(workspace, 'output');
const args = process.argv.slice(2);
let cityIds = MAJOR_CITY_IDS;
let jobs = 2;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--cities') cityIds = args[++index]?.split(',') ?? [];
  else if (args[index] === '--jobs') jobs = Number(args[++index]);
  else if (args[index] === '--help') {
    console.log('Usage: node scripts/generate-cities.mjs [--cities nyc,sf,...] [--jobs 1..3]\nDefault: all 15 requested cities, two workers.');
    process.exit(0);
  } else throw new Error(`Unknown argument: ${args[index]}`);
}
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 3) throw new Error('--jobs must be between 1 and 3.');
if (!cityIds.length || cityIds.some((id) => !CITIES[id])) throw new Error(`Unknown or empty city list. Valid ids: ${Object.keys(CITIES).join(', ')}`);
cityIds = [...new Set(cityIds)];
await mkdir(outputDirectory, { recursive: true });
const report = { generatedAt: new Date().toISOString(), cities: [], failures: [] };
let cursor = 0;
const generate = (id) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [generator, '--city', id], { cwd: workspace, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Generator exited with code ${code}.`)));
});

await Promise.all(Array.from({ length: jobs }, async () => {
  while (cursor < cityIds.length) {
    const index = cursor++;
    const id = cityIds[index];
    const start = Date.now();
    console.log(`[${index + 1}/${cityIds.length}] Generating ${CITIES[id].label} (${id})`);
    try {
      await generate(id);
      const file = `${id}-city-layered.svg`;
      const svg = await readFile(join(outputDirectory, file), 'utf8');
      const metadata = JSON.parse(svg.match(/<metadata>(.*?)<\/metadata>/s)[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
      if (Object.keys(metadata.cameras).length !== 5 || svg.includes('NaN') || svg.includes('undefined')) throw new Error('Invalid generated geometry or cameras.');
      const count = (pattern) => (svg.match(pattern) ?? []).length;
      const entry = {
        id, label: CITIES[id].label, file, country: CITIES[id].country,
        center: { latitude: CITIES[id].latitude, longitude: CITIES[id].longitude },
        radiiMeters: CITIES[id].radii,
        release: metadata.release, bytes: (await stat(join(outputDirectory, file))).size,
        parks: count(/class="park"/g), transit: count(/class="transit"/g),
        waterAreas: count(/class="water-area"/g), waterLines: count(/class="water-line"/g),
        elevationBands: count(/class="elevation-band /g),
        seconds: Math.round((Date.now() - start) / 1000),
      };
      report.cities.push(entry);
      console.log(`[done ${report.cities.length}/${cityIds.length}] ${entry.label}: ${(entry.bytes / 1_000_000).toFixed(2)} MB; ${entry.parks} parks, ${entry.transit} transit segments, ${entry.waterAreas + entry.waterLines} water shapes`);
    } catch (error) {
      report.failures.push({ id, label: CITIES[id].label, error: error.message });
      console.error(`[FAILED] ${CITIES[id].label}: ${error.message}`);
    }
  }
}));
report.cities.sort((a, b) => cityIds.indexOf(a.id) - cityIds.indexOf(b.id));
await writeFile(join(outputDirectory, 'cities.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Finished: ${report.cities.length}/${cityIds.length} generated; ${report.failures.length} failed. Manifest: output/cities.json`);
if (report.failures.length) process.exitCode = 1;
