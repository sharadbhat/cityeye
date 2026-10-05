import test from 'node:test';
import assert from 'node:assert/strict';
import { confettiOrigin, createWinConfetti } from '../src/lib/win-confetti.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture({ reduced = false, pendingLoad = false, fail = false } = {}) {
  const particles = deferred();
  const loading = deferred();
  const canvases = [];
  const listeners = new Set();
  const timers = new Map();
  const calls = [];
  let loads = 0;
  let resets = 0;
  const media = {
    matches: reduced,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  };
  const fire = (options) => { calls.push(options); return particles.promise; };
  fire.reset = () => { resets += 1; particles.resolve(); };
  const module = { default: { create(canvas, options) {
    assert.equal(canvas.className, 'win-confetti');
    assert.deepEqual(options, { resize: true, useWorker: true, disableForReducedMotion: true });
    return fire;
  } } };
  const controller = createWinConfetti({
    document: {
      createElement: () => ({ setAttribute(name, value) { this[name] = value; }, remove() { canvases.splice(canvases.indexOf(this), 1); } }),
      body: { appendChild: (canvas) => canvases.push(canvas) },
    },
    window: {
      matchMedia: () => media,
      setTimeout: (fn) => { const id = timers.size + 1; timers.set(id, fn); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
    load: async () => { loads += 1; if (fail) throw new Error('offline'); return pendingLoad ? loading.promise : module; },
  });
  return {
    controller, particles, canvases, calls, listeners, timers,
    get loads() { return loads; }, get resets() { return resets; },
    loaded: () => loading.resolve(module),
    reduce() { media.matches = true; for (const listener of listeners) listener(); },
  };
}

const win = { outcome: 'correct', roundId: '1', origin: { x: 0.7, y: 0.6 } };

test('origin follows the guess button and remains inside the viewport', () => {
  assert.deepEqual(confettiOrigin({ left: 600, top: 300, width: 200, height: 60 }, { width: 1000, height: 600 }), { x: 0.7, y: 0.55 });
  assert.deepEqual(confettiOrigin({ left: -500, top: 1000, width: 100, height: 100 }, { width: 1000, height: 600 }), { x: 0.05, y: 0.95 });
  assert.deepEqual(confettiOrigin(null), { x: 0.5, y: 0.6 });
});

test('only correct guesses celebrate, once per round, then clean up', async () => {
  const f = fixture();
  for (const outcome of ['incorrect', 'lost', 'duplicate', 'invalid', 'ended']) {
    assert.equal(await f.controller.celebrate({ ...win, outcome }), false);
  }
  assert.equal(f.loads, 0);
  const celebration = f.controller.celebrate(win);
  await Promise.resolve();
  assert.equal(f.canvases.length, 1);
  assert.equal(f.canvases[0]['aria-hidden'], 'true');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].origin, win.origin);
  assert.equal(await f.controller.celebrate(win), false);
  f.particles.resolve();
  assert.equal(await celebration, true);
  assert.equal(f.canvases.length, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.resets, 1);
});

test('reduced motion skips animation and loading', async () => {
  const f = fixture({ reduced: true });
  assert.equal(await f.controller.celebrate(win), false);
  assert.equal(f.loads, 0);
});

for (const action of ['cancel', 'dispose', 'reduce']) {
  test(`${action} prevents a pending chunk from firing`, async () => {
    const f = fixture({ pendingLoad: true });
    const celebration = f.controller.celebrate(win);
    if (action === 'reduce') f.reduce();
    else f.controller[action]();
    f.loaded();
    assert.equal(await celebration, false);
    assert.equal(f.canvases.length, 0);
    assert.equal(f.calls.length, 0);
  });
}

for (const action of ['cancel', 'dispose', 'reduce']) {
  test(`${action} stops an active burst`, async () => {
    const f = fixture();
    const celebration = f.controller.celebrate(win);
    await Promise.resolve();
    if (action === 'reduce') f.reduce();
    else f.controller[action]();
    await celebration;
    assert.equal(f.canvases.length, 0);
    assert.equal(f.resets, 1);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.timers.size, 0);
  });
}

test('animation loading failures are non-fatal', async () => {
  const f = fixture({ fail: true });
  assert.equal(await f.controller.celebrate(win), false);
  assert.equal(f.canvases.length, 0);
});

test('fallback timer cleans up a burst that does not complete', async () => {
  const f = fixture();
  const celebration = f.controller.celebrate(win);
  await Promise.resolve();
  for (const timer of f.timers.values()) timer();
  await celebration;
  assert.equal(f.canvases.length, 0);
  assert.equal(f.resets, 1);
});
