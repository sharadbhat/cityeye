#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { WORLD_CITIES, WORLD_CITY_IDS } from './world-cities.mjs';
import { runProcess } from './run-process.mjs';
import { acquireBatchLock, atomicJson, runCityBatch } from './city-batch.mjs';
import { validateCitySvg } from './validate-city-maps.mjs';
import { loadPlayableCities } from './playable-cities.mjs';
import { OVERTURE_RELEASE, OVERTURE_PACKAGE } from './map-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDirectory = join(root, 'output');

export async function retrySetup(operation, { signal, attempts = 3, delay = attempt => pause(attempt * 2_000, undefined, { signal }), log = console.warn } = {}) {
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    try { return await operation(); }
    catch (error) {
      if (signal?.aborted || attempt >= attempts) throw error;
      log(`Setup retry ${attempt}/${attempts - 1}: ${error.message.slice(0, 300)}`);
      await delay(attempt);
    }
  }
}

export function parseWorldArguments(args) {
  const options = { ids: WORLD_CITY_IDS, jobs: 1, attempts: 3, timeoutMinutes: 45, force: false, dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '--cities') options.ids = [...new Set((args[++i] ?? '').split(',').map(id => id.trim()).filter(Boolean))];
    else if (argument === '--jobs') options.jobs = Number(args[++i]);
    else if (argument === '--attempts') options.attempts = Number(args[++i]);
    else if (argument === '--timeout-minutes') options.timeoutMinutes = Number(args[++i]);
    else if (argument === '--force') options.force = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.ids.length || options.ids.some(id => !WORLD_CITIES[id])) throw new Error(`--cities must contain IDs from: ${WORLD_CITY_IDS.join(', ')}`);
  for (const [key, maximum] of [['jobs', 2], ['attempts', 5], ['timeoutMinutes', 180]]) {
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > maximum) throw new Error(`${key} must be an integer between 1 and ${maximum}.`);
  }
  return options;
}

export async function generationFingerprints(ids) {
  const dependencies = ['generate-city-map-svg.mjs', 'download-overture.py', 'map-source.mjs', 'road-paths.mjs', 'water-features.mjs', 'map-geometry.mjs', 'elevation-scale.mjs'];
  const code = await Promise.all(dependencies.map(file => readFile(new URL(file, import.meta.url))));
  return Object.fromEntries(ids.map(id => {
    const hash = createHash('sha256');
    for (const content of code) hash.update(content);
    return [id, hash.update(JSON.stringify(WORLD_CITIES[id])).digest('hex')];
  }));
}

async function main() {
  const options = parseWorldArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run generate:world -- [--jobs 1|2] [--attempts 1..5] [--timeout-minutes 45] [--cities london,paris] [--force] [--dry-run]\nDefault: all 42 cities; resumes valid outputs; publishes successful maps and builds the app.');
    return;
  }
  const catalogPath = join(root, 'data', 'city-catalog.json');
  let catalogText;
  try { catalogText = await readFile(catalogPath, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (options.dryRun) throw new Error('Dry run requires a city directory. Run npm run catalog first.');
    console.log('Preparing the worldwide city directory…');
    await retrySetup(() => runProcess(process.execPath, [join(root, 'scripts', 'build-city-catalog.mjs')], { cwd: root, timeoutMs: 5 * 60_000 }));
    catalogText = await readFile(catalogPath, 'utf8');
  }
  const catalog = JSON.parse(catalogText);
  loadPlayableCities(catalog, Object.fromEntries(options.ids.map(id => [id, WORLD_CITIES[id]])));
  const fingerprints = await generationFingerprints(options.ids);
  const inspect = async (id) => {
    let svg;
    try { svg = await readFile(join(outputDirectory, `${id}-city-layered.svg`), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    const validation = validateCitySvg(svg, id);
    const fingerprint = svg.match(/&quot;buildFingerprint&quot;:&quot;([a-f0-9]+)&quot;/)?.[1];
    if (validation.errors.length || !validation.metrics.elevationBands || fingerprint !== fingerprints[id]) return null;
    return { file: validation.file, metrics: validation.metrics, warnings: validation.warnings, fingerprint };
  };
  if (options.dryRun) {
    for (const id of options.ids) console.log(`${!options.force && await inspect(id) ? 'SKIP' : 'GENERATE'} ${id}: ${WORLD_CITIES[id].label}, ${WORLD_CITIES[id].country}`);
    console.log(`Dry run: ${options.ids.length} verified identities; no downloads or file changes. Release ${OVERTURE_RELEASE}; ${OVERTURE_PACKAGE}.`);
    return;
  }
  await stat(join(root, 'node_modules', 'vite', 'bin', 'vite.js')).catch(() => { throw new Error('Run npm install first.'); });
  const releaseLock = await acquireBatchLock(outputDirectory);
  const controller = new AbortController();
  const interrupt = () => { console.log('\nStopping active downloads; progress is saved. Rerun the same command to resume.'); controller.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const reportPath = join(outputDirectory, 'world-generation-report.json');
  let report;
  try {
    await mkdir(join(outputDirectory, 'logs', 'world-cities'), { recursive: true });
    const setupLog = join(outputDirectory, 'logs', 'world-cities', 'setup.log');
    let needsGeneration = options.force;
    if (!needsGeneration) {
      for (const id of options.ids) {
        if (!await inspect(id)) { needsGeneration = true; break; }
      }
    }
    if (needsGeneration) {
      console.log(`Preparing ${OVERTURE_PACKAGE} (uvx installs/caches it automatically).`);
      await retrySetup(() => runProcess('uvx', ['--from', OVERTURE_PACKAGE, 'python', '-c', 'from overturemaps.core import record_batch_reader; from overturemaps.writers import get_writer, copy; print("Downloader ready")'], { cwd: root, logPath: setupLog, timeoutMs: 10 * 60_000, signal: controller.signal }), { signal: controller.signal });
      // Catch expired release URLs up front, rather than retrying all 42 cities.
      const prefix = `release/${OVERTURE_RELEASE}/theme=transportation/type=segment/`;
      await retrySetup(async () => {
        const response = await fetch(`https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&max-keys=1&prefix=${encodeURIComponent(prefix)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]) });
        if (!response.ok || !/<KeyCount>1<\/KeyCount>/.test(await response.text())) throw new Error(`Overture release ${OVERTURE_RELEASE} is unavailable. See scripts/map-source.mjs before rerunning.`);
      }, { signal: controller.signal });
    }
    report = await runCityBatch({
      ids: options.ids, outputDirectory, jobs: options.jobs, attempts: options.attempts,
      force: options.force, signal: controller.signal, inspect,
      generate: async (id, { logPath, signal }) => {
        await writeFile(logPath, `\n${new Date().toISOString()} ${id}\n`, { flag: 'a' });
        await runProcess(process.execPath, [join(root, 'scripts', 'generate-city-map-svg.mjs'), '--city', id, '--fingerprint', fingerprints[id]], { cwd: root, logPath, signal, timeoutMs: options.timeoutMinutes * 60_000 });
      },
    });
    if (!controller.signal.aborted) {
      console.log('Publishing validated maps to the game and rebuilding the app…');
      const publicationLog = join(outputDirectory, 'logs', 'world-cities', 'publication.log');
      const commands = [
        ['scripts/prepare-app.mjs', '--all-generated'],
        ['scripts/build-city-catalog.mjs'],
        ['node_modules/vite/bin/vite.js', 'build'],
      ];
      for (const [script, ...args] of commands) await retrySetup(() => runProcess(process.execPath, [join(root, script), ...args], { cwd: root, logPath: publicationLog, signal: controller.signal, timeoutMs: 10 * 60_000 }), { signal: controller.signal });
      report.publication = { status: 'complete', playableCities: JSON.parse(await readFile(join(root, 'data', 'playable-cities.json'), 'utf8')).length };
    }
    report.finishedAt = new Date().toISOString();
    await atomicJson(reportPath, report);
    const successes = report.cities.filter(city => ['generated', 'skipped'].includes(city.status)).length;
    console.log(`Finished: ${successes}/${options.ids.length} ready. Report: ${reportPath}`);
    if (report.publication) console.log(`${report.publication.playableCities} total playable cities. Restart the app server and refresh the browser when ready.`);
    if (report.status !== 'complete') process.exitCode = controller.signal.aborted ? 130 : 1;
  } catch (error) {
    if (report) { report.publication = { status: 'failed', error: error.message }; report.status = 'partial'; await atomicJson(reportPath, report); }
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    await releaseLock();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
