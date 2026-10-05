import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { acquireBatchLock, runCityBatch } from './city-batch.mjs';
import { parseWorldArguments, generationFingerprints, retrySetup, cityPoolSummary } from './generate-world-cities.mjs';
import { WORLD_CITY_IDS } from './world-cities.mjs';
import { runProcess } from './run-process.mjs';
import { availableCityMaps } from './available-city-maps.mjs';

async function directory(t) {
  const parent = resolve(tmpdir());
  const path = await mkdtemp(join(parent, 'guess-the-world-batch-test-'));
  t.after(async () => {
    assert.equal(dirname(resolve(path)), parent);
    assert.ok(basename(path).startsWith('guess-the-world-batch-test-'));
    await rm(path, { recursive: true, force: true });
  });
  return path;
}
const result = { file: 'fixture.svg', metrics: { bytes: 1000 }, warnings: [] };

test('setup/publication transient errors are retried without user intervention', async () => {
  let calls = 0;
  const value = await retrySetup(async () => { if (++calls < 3) throw new Error('Temporary error'); return 'ready'; }, { delay: async () => {}, log: () => {} });
  assert.equal(value, 'ready');
  assert.equal(calls, 3);
  await assert.rejects(retrySetup(async () => { throw new Error('Permanent'); }, { attempts: 2, delay: async () => {}, log: () => {} }), /Permanent/);
});

test('world batch defaults to all 349 cities and rejects invalid options', () => {
  const options = parseWorldArguments([]);
  assert.deepEqual(options.ids, WORLD_CITY_IDS);
  assert.equal(options.ids.length, 349);
  assert.equal(options.jobs, 1);
  assert.equal(options.attempts, 3);
  assert.equal(options.timeoutMinutes, 45);
  assert.deepEqual(parseWorldArguments(['--cities', 'london,paris,london', '--jobs', '2', '--dry-run']).ids, ['london', 'paris']);
  assert.deepEqual(parseWorldArguments(['--cities', 'phoenix,kyoto,adelaide']).ids, ['phoenix', 'kyoto', 'adelaide']);
  assert.equal(parseWorldArguments(['--dry-run']).dryRun, true);
  for (const args of [['--jobs','0'], ['--jobs','3'], ['--cities',''], ['--cities','bogus'], ['--attempts','0'], ['--timeout-minutes','NaN'], ['--unknown']]) assert.throws(() => parseWorldArguments(args));
});

test('batch summary distinguishes the 365-city pool from the 349-entry batch', () => {
  assert.equal(cityPoolSummary(), 'City pool: 365 configured (16 original + 349 worldwide batch). Checking 349 batch entries; valid maps will be skipped.');
  assert.match(cityPoolSummary(2), /Checking 2 batch entries/);
  assert.match(cityPoolSummary(2, true), /all selected maps will be regenerated/);
});

test('each city has a stable, distinct generation fingerprint', async () => {
  const first = await generationFingerprints(['london', 'paris']);
  assert.deepEqual(first, await generationFingerprints(['london', 'paris']));
  assert.match(first.london, /^[a-f0-9]{64}$/);
  assert.notEqual(first.london, first.paris);
});

test('batch retries transient failures, continues permanent failures, and persists results', async t => {
  const outputDirectory = await directory(t);
  const counts = {};
  const complete = new Set();
  const report = await runCityBatch({
    ids: ['good', 'transient', 'broken', 'last'], outputDirectory, attempts: 3,
    generate: async id => {
      counts[id] = (counts[id] ?? 0) + 1;
      if (id === 'broken' || (id === 'transient' && counts[id] < 2)) throw new Error('Network error');
      complete.add(id);
    },
    inspect: async id => complete.has(id) ? result : null,
    delay: async () => {}, log: () => {},
  });
  assert.deepEqual(counts, { good: 1, transient: 2, broken: 3, last: 1 });
  assert.equal(report.status, 'partial');
  assert.deepEqual(report.cities.map(city => city.status), ['generated', 'generated', 'failed', 'generated']);
  assert.deepEqual(JSON.parse(await readFile(join(outputDirectory, 'world-generation-report.json'), 'utf8')), report);
});

test('a rerun skips validated maps and force explicitly regenerates them', async t => {
  const outputDirectory = await directory(t);
  let calls = 0;
  const options = { ids: ['ready'], outputDirectory, inspect: async () => result, generate: async () => { calls++; }, log: () => {} };
  assert.equal((await runCityBatch(options)).cities[0].status, 'skipped');
  assert.equal(calls, 0);
  assert.equal((await runCityBatch({ ...options, force: true })).cities[0].status, 'generated');
  assert.equal(calls, 1);
});

test('invalid generated maps are retried and never reported as ready', async t => {
  const report = await runCityBatch({ ids: ['invalid'], outputDirectory: await directory(t), generate: async () => {}, inspect: async () => null, attempts: 2, delay: async () => {}, log: () => {} });
  assert.equal(report.cities[0].status, 'failed');
  assert.equal(report.cities[0].attempts, 2);
  assert.match(report.cities[0].error, /validation/);
});

test('worker concurrency is bounded and final report order is deterministic', async t => {
  let active = 0;
  let maximum = 0;
  const ready = new Set();
  const report = await runCityBatch({
    ids: ['a', 'b', 'c', 'd'], outputDirectory: await directory(t), jobs: 2,
    generate: async id => { active++; maximum = Math.max(maximum, active); await new Promise(done => setTimeout(done, 5)); active--; ready.add(id); },
    inspect: async id => ready.has(id) ? result : null, log: () => {},
  });
  assert.equal(maximum, 2);
  assert.equal(report.status, 'complete');
  assert.deepEqual(report.cities.map(city => city.id), ['a', 'b', 'c', 'd']);
});

test('interrupting saves progress and does not start the next city', async t => {
  const controller = new AbortController();
  const report = await runCityBatch({
    ids: ['active', 'pending'], outputDirectory: await directory(t), signal: controller.signal,
    generate: async () => { controller.abort(); throw new Error('Stopped'); },
    inspect: async () => null, log: () => {},
  });
  assert.equal(report.status, 'interrupted');
  assert.equal(report.cities.length, 1);
  assert.equal(report.cities[0].status, 'interrupted');
});

test('concurrent batches are refused and released locks allow reruns', async t => {
  const path = await directory(t);
  const unlock = await acquireBatchLock(path);
  await assert.rejects(acquireBatchLock(path), /already running/);
  await unlock();
  await (await acquireBatchLock(path))();
});

test('missing or invalid assets are not published merely because a city is configured', async t => {
  const path = await directory(t);
  await writeFile(join(path, 'broken-city-layered.svg'), '<svg></svg>');
  const warnings = [];
  const available = await availableCityMaps({ mapDirectory: path, definitions: { missing: { label: 'Missing' }, broken: { label: 'Broken' } }, warn: message => warnings.push(message) });
  assert.deepEqual(available, {});
  assert.equal(warnings.length, 1);
});

test('process runner captures diagnostics, writes full logs, and rejects nonzero exits', async t => {
  const logPath = join(await directory(t), 'process.log');
  assert.match(await runProcess(process.execPath, ['-e', 'console.log("ready")'], { logPath }), /ready/);
  assert.match(await readFile(logPath, 'utf8'), /ready/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'console.error("fixture failure"); process.exit(7)']), /exited 7.*fixture failure/s);
});

test('process runner terminates hung children at the configured deadline', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 }), /Timed out/);
});

test('process runner refuses already-aborted work and terminates active work on cancellation', async () => {
  const stopped = new AbortController();
  stopped.abort();
  assert.throws(() => runProcess(process.execPath, ['-e', 'process.exit(0)'], { signal: stopped.signal }));
  const active = new AbortController();
  const running = runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: active.signal });
  setTimeout(() => active.abort(), 50);
  await assert.rejects(running, /Interrupted/);
});
