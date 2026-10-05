import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';

export async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await rename(temporary, file);
}

export async function acquireBatchLock(directory) {
  const path = join(directory, 'world-generation.lock');
  await mkdir(directory, { recursive: true });
  async function create() {
    const handle = await open(path, 'wx');
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
    finally { await handle.close(); }
    return async () => { await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); };
  }
  try { return await create(); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const lock = JSON.parse(await readFile(path, 'utf8'));
  let alive = true;
  try { process.kill(lock.pid, 0); }
  catch (error) { if (error.code === 'ESRCH') alive = false; else if (error.code !== 'EPERM') throw error; }
  if (alive) throw new Error(`A world-city batch is already running (PID ${lock.pid}).`);
  await unlink(path); // Only this script's stale lock, never a directory or source file.
  return create();
}

// Persist every transition. A rerun validates files rather than trusting the report.
export async function runCityBatch({
  ids, outputDirectory, generate, inspect, jobs = 1, attempts = 3,
  force = false, signal, log = console.log,
  delay = (attempt) => pause(15_000 * 2 ** (attempt - 1), undefined, { signal }),
}) {
  const reportPath = join(outputDirectory, 'world-generation-report.json');
  const logsDirectory = join(outputDirectory, 'logs', 'world-cities');
  await mkdir(logsDirectory, { recursive: true });
  const report = { startedAt: new Date().toISOString(), status: 'running', requested: ids, cities: [], publication: null };
  let writing = Promise.resolve();
  const save = () => {
    const snapshot = structuredClone(report);
    writing = writing.then(() => atomicJson(reportPath, snapshot));
    return writing;
  };
  await save();
  let cursor = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (cursor < ids.length && !signal?.aborted) {
      const id = ids[cursor++];
      const entry = { id, status: 'checking', attempts: 0, log: join(logsDirectory, `${id}.log`) };
      report.cities.push(entry);
      try {
        if (!force) {
          const existing = await inspect(id);
          if (existing) {
            Object.assign(entry, existing, { status: 'skipped' });
            log(`[${report.cities.length}/${ids.length}] ${id}: already valid; skipped.`);
            await save();
            continue;
          }
        }
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          if (signal?.aborted) break;
          entry.attempts = attempt;
          entry.status = 'running';
          await save();
          log(`[${ids.indexOf(id) + 1}/${ids.length}] ${id}: generating (attempt ${attempt}/${attempts}).`);
          try {
            await generate(id, { logPath: entry.log, signal });
            const result = await inspect(id);
            if (!result) throw new Error('Generated SVG did not pass validation or has a stale fingerprint.');
            Object.assign(entry, result, { status: 'generated' });
            delete entry.error;
            log(`[done] ${id}: ${(entry.metrics.bytes / 1_000_000).toFixed(2)} MB${entry.warnings.length ? `; ${entry.warnings.join(' ')}` : ''}`);
            break;
          } catch (error) {
            entry.error = error.message;
            entry.status = signal?.aborted ? 'interrupted' : attempt === attempts ? 'failed' : 'retrying';
            log(`[${entry.status}] ${id}: ${error.message.slice(0, 400)} See ${entry.log}`);
            await save();
            if (entry.status === 'retrying') await delay(attempt);
          }
        }
        if (signal?.aborted && entry.status !== 'generated') entry.status = 'interrupted';
      } catch (error) {
        entry.status = signal?.aborted ? 'interrupted' : 'failed';
        entry.error = error.message;
      }
      await save();
    }
  }));
  report.cities.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  report.finishedAt = new Date().toISOString();
  report.status = signal?.aborted ? 'interrupted' : report.cities.some(city => city.status === 'failed') ? 'partial' : 'complete';
  await save();
  return report;
}
