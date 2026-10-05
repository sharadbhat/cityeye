import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

function killTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.on('error', () => child.kill());
    killer.once('close', code => { if (code !== 0) child.kill(); });
    setTimeout(() => { if (child.exitCode === null) child.kill(); }, 5000).unref();
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2000).unref();
  }
}

// No interactive stdin, hidden Windows processes, bounded lifetimes, full logs.
export function runProcess(command, args, { cwd, logPath, timeoutMs = 45 * 60_000, signal, env = {} } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const log = logPath ? createWriteStream(logPath, { flags: 'a' }) : null;
    let tail = '';
    let failure = null;
    let settled = false;
    const child = spawn(command, args, {
      cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, UV_NO_PROGRESS: '1', PYTHONUNBUFFERED: '1', ...env },
    });
    const capture = (chunk) => { tail = (tail + chunk.toString()).slice(-8_000); log?.write(chunk); };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    const stop = (error) => { failure ??= error; killTree(child); };
    const abort = () => stop(new Error('Interrupted; rerun the command to resume.'));
    const timer = setTimeout(() => stop(new Error(`Timed out after ${Math.round(timeoutMs / 60_000)} minutes.`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    log?.on('error', (error) => stop(error));
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      const complete = () => error ? reject(error) : resolve(tail);
      if (log && !log.destroyed) log.end(complete);
      else complete();
    }
    child.once('error', finish);
    child.once('close', (code, stoppedBy) => finish(failure ?? (code === 0 ? null : new Error(`Process exited ${code ?? stoppedBy}: ${tail.slice(-2_000)}`))));
    if (signal?.aborted) abort();
  });
}
