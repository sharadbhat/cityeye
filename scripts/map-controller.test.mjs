import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CITIES, ORIGINAL_CITY_IDS } from './cities.mjs';
import { createMapController, parseMapSvg, sanitizeMapSvg, validateMapMetadata } from '../src/lib/map-controller.mjs';
import { STAGE_HINTS } from '../src/lib/reveal-stages.mjs';

const namespace = 'http://www.w3.org/2000/svg';
const cameras = { 1: [366.67, 366.67, 66.67, 66.67], 2: [313.33, 313.33, 173.33, 173.33], 3: [200, 200, 400, 400], 4: [0, 0, 800, 800], 5: [0, 0, 800, 800] };

class Element {
  constructor(tag = 'g', attrs = {}, children = []) {
    this.localName = tag;
    this.namespaceURI = namespace;
    this.attrs = new Map(Object.entries(attrs).map(([key, value]) => [key, String(value)]));
    this.children = children;
    children.forEach((child) => { child.parent = this; });
    this.properties = new Map();
    this.classes = new Set((this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
    this.classList = {
      toggle: (name, force = !this.classes.has(name)) => { if (force) this.classes.add(name); else this.classes.delete(name); },
      remove: (name) => this.classes.delete(name),
      contains: (name) => this.classes.has(name),
    };
    this.style = { setProperty: (name, value) => this.properties.set(name, value), removeProperty: (name) => this.properties.delete(name) };
    this.viewBoxWrites = 0;
  }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  get dataset() {
    return Object.fromEntries([...this.attrs].filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), value]));
  }
  setAttribute(name, value) { this.attrs.set(name, String(value)); if (name === 'viewBox') this.viewBoxWrites += 1; }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  removeAttribute(name) { this.attrs.delete(name); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    if (selector === '*') return descendants;
    if (selector === '[data-reveal-stage]') return descendants.filter((child) => child.attrs.has('data-reveal-stage'));
    return descendants.filter((child) => child.localName === selector);
  }
}

function createFixture(reduced = false) {
  const layers = Array.from({ length: 5 }, (_unused, index) => new Element('g', { 'data-reveal-stage': index + 1 }));
  const svg = new Element('svg', { viewBox: '0 0 800 800' }, layers);
  const viewport = new Element('div');
  const surface = new Element('div');
  const animations = [];
  surface.animate = (keyframes, options) => {
    let resolve;
    let reject;
    const animation = {
      keyframes, options, progress: 0, playState: 'running', cancelled: false,
      finished: new Promise((done, fail) => { resolve = done; reject = fail; }),
      effect: { getComputedTiming: () => ({ progress: animation.progress }) },
      finish() { if (animation.playState === 'running') { animation.playState = 'finished'; animation.progress = 1; resolve(); } },
      cancel() { animation.cancelled = true; animation.playState = 'idle'; reject(new Error('Cancelled')); },
    };
    animations.push(animation);
    return animation;
  };
  const controller = createMapController({ svg, config: { cameras }, surface, viewport, reducedMotion: () => reduced });
  controller.showStage(1, true);
  return { svg, viewport, surface, layers, animations, controller };
}

function camera(svg) { return svg.getAttribute('viewBox').split(' ').map(Number); }
function assertClose(actual, expected) { actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-7)); }
function visualCamera(animation, render, progress = 0) {
  const values = (frame) => frame.transform.match(/[-+\d.e]+(?=[%,)])/gi).map(Number);
  const first = values(animation.keyframes[0]);
  const last = values(animation.keyframes[1]);
  const [tx, ty, sx, sy] = first.map((value, index) => value + (last[index] - value) * progress);
  const width = render[2] / sx;
  const height = render[3] / sy;
  return [render[0] - tx / 100 * width, render[1] - ty / 100 * height, width, height];
}
async function finish(animation) { animation.finish(); await Promise.resolve(); await Promise.resolve(); }

test('all generated city assets have valid one-based map camera metadata', async () => {
  for (const id of Object.keys(CITIES)) {
    let source;
    try { source = await readFile(new URL(`../output/${id}-city-layered.svg`, import.meta.url), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT' && !ORIGINAL_CITY_IDS.includes(id)) continue; throw error; }
    const encoded = source.match(/<metadata>([\s\S]*?)<\/metadata>/)[1];
    const metadata = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
    const config = validateMapMetadata(metadata);
    assert.deepEqual(Object.keys(config), ['cameras']);
    assert.equal(Object.keys(config.cameras).join(','), '1,2,3,4,5');
    config.cameras[1][0] += 1;
    assert.notEqual(config.cameras[1][0], metadata.cameras[1][0], 'Controller configuration does not mutate parsed metadata.');
  }
});

test('missing, extra, or invalid camera metadata is rejected', () => {
  for (const config of [{}, { cameras: [] }, { cameras: { ...cameras, 0: cameras[1] } }, { cameras: { ...cameras, 3: [0, 0, 0, 10] } }, { cameras: { ...cameras, 5: [0, 0, 800, NaN] } }]) {
    assert.throws(() => validateMapMetadata(config));
  }
});

test('lazy SVG parsing rejects XML entities and missing stage metadata', () => {
  assert.throws(() => parseMapSvg('<!DOCTYPE svg [<!ENTITY leak SYSTEM "file://x">]><svg/>', class {}), /unsupported XML/);
  const svg = new Element('svg');
  class Parser { parseFromString() { return { documentElement: svg, querySelector: () => null }; } }
  assert.throws(() => parseMapSvg('<svg/>', Parser), /five camera stages/);
});

test('SVG parsing keeps only camera configuration and strips descriptive metadata before injection', () => {
  const metadata = new Element('metadata');
  metadata.textContent = JSON.stringify({ cameras, name: 'Secret answer', country: 'United States' });
  const svg = new Element('svg', { viewBox: '0 0 800 800' }, [metadata, new Element('title'), new Element('g', { 'data-reveal-stage': 1 })]);
  class Parser { parseFromString() { return { documentElement: svg, querySelector: () => null }; } }
  const parsed = parseMapSvg('<svg/>', Parser);
  assert.equal(parsed.svg, svg);
  assert.deepEqual(Object.keys(parsed.config), ['cameras']);
  assert.equal(svg.querySelector('metadata'), null);
  assert.equal(svg.querySelector('title'), null);
  assert.equal(svg.getAttribute('aria-label'), 'Mystery city map, north up');
});

test('SVG parsing rejects out-of-range reveal stages', () => {
  const metadata = new Element('metadata');
  metadata.textContent = JSON.stringify({ cameras });
  const svg = new Element('svg', {}, [metadata, new Element('g', { 'data-reveal-stage': 1 }), new Element('g', { 'data-reveal-stage': 6 })]);
  class Parser { parseFromString() { return { documentElement: svg, querySelector: () => null }; } }
  assert.throws(() => parseMapSvg('<svg/>', Parser), /invalid reveal layers/);
});

test('sanitizing map DOM removes scripts, links, external references, styles, and answer labels', () => {
  const clue = new Element('g', { 'data-layer': 'country-clue', 'data-reveal-stage': 5 }, [new Element('text')]);
  const localUse = new Element('use', { href: '#shape' });
  const path = new Element('path', { class: 'road road--local', d: 'M0 0L1 1', onclick: 'alert(1)', style: 'fill:url(https://example.com)', 'data-city': 'Answer', 'clip-path': 'url(https://example.com)' });
  const svg = new Element('svg', { 'aria-label': 'Answer city', 'aria-labelledby': 'city-title', onload: 'alert(1)' }, [
    new Element('metadata'), new Element('title'), new Element('desc'), new Element('script'),
    new Element('foreignObject'), new Element('a', { href: 'https://example.com' }), new Element('text'),
    new Element('image', { href: 'https://example.com' }), new Element('use', { href: 'https://example.com' }),
    localUse, path, clue,
  ]);
  sanitizeMapSvg(svg);
  for (const tag of ['metadata', 'title', 'desc', 'script', 'foreignObject', 'a', 'image']) assert.equal(svg.querySelectorAll(tag).length, 0);
  assert.equal(svg.querySelectorAll('text').length, 0, 'Geography clues are HTML overlays, not SVG text.');
  assert.equal(svg.getAttribute('aria-label'), 'Mystery city map, north up');
  assert.equal(svg.getAttribute('aria-labelledby'), null);
  assert.equal(svg.getAttribute('onload'), null);
  assert.equal(path.getAttribute('onclick'), null);
  assert.equal(path.getAttribute('style'), null);
  assert.equal(path.getAttribute('clip-path'), null);
  assert.equal(path.getAttribute('data-city'), null);
  assert.equal(localUse.getAttribute('href'), '#shape');
  assert.equal(svg.querySelectorAll('use')[0].getAttribute('href'), null);
});

test('first load renders stage 1 immediately', () => {
  const fixture = createFixture();
  assert.deepEqual(camera(fixture.svg), cameras[1]);
  assert.equal(fixture.animations.length, 0);
  fixture.layers.forEach((layer, index) => assert.equal(layer.classList.contains('is-visible'), index === 0));
});

test('water starts at stage 1, parks/transit at stage 2, regional roads at stage 3', () => {
  const fixture = createFixture(true);
  const definitions = { water: 3, parks: 2, transit: 2, 'regional-roads': 4, 'country-clue': 5 };
  const features = Object.entries(definitions).map(([name, stage]) => new Element('g', {
    'data-layer': name, 'data-reveal-stage': stage,
  }, [new Element('path', { d: 'M0 0L1 1' })]));
  fixture.svg.children.push(...features);
  features.forEach((layer) => { layer.parent = fixture.svg; });
  const controller = createMapController({ ...fixture, config: { cameras }, reducedMotion: () => true });
  const visible = () => features.filter((layer) => layer.classList.contains('is-visible')).map((layer) => layer.dataset.layer);
  controller.showStage(1, true);
  assert.deepEqual(visible(), ['water']);
  assert.match(STAGE_HINTS[1], /water/);
  controller.showStage(2);
  assert.deepEqual(visible(), ['water', 'parks', 'transit']);
  assert.match(STAGE_HINTS[2], /Parks and public transit/);
  controller.showStage(3);
  assert.deepEqual(visible(), ['water', 'parks', 'transit', 'regional-roads']);
  assert.match(STAGE_HINTS[3], /regional road/);
  controller.showStage(5);
  assert.deepEqual(visible(), Object.keys(definitions).filter((name) => name !== 'country-clue'));
  assert.equal(fixture.svg.children.includes(features.at(-1)), false, 'HTML country clue replaces the old SVG label.');
  controller.showStage(1);
  assert.deepEqual(visible(), ['water'], 'Returning to stage 1 keeps water but hides later clues.');
  features.forEach((layer) => assert.equal(layer.children[0].getAttribute('d'), 'M0 0L1 1'));
  controller.dispose();
  fixture.controller.dispose();
});

test('zoom out uses one viewBox write and reveals new layers only after compositor motion', async () => {
  const fixture = createFixture();
  const writes = fixture.svg.viewBoxWrites;
  fixture.controller.showStage(4);
  const animation = fixture.animations.at(-1);
  assertClose(visualCamera(animation, camera(fixture.svg)), cameras[1]);
  assert.deepEqual(camera(fixture.svg), cameras[4]);
  assert.equal(fixture.svg.viewBoxWrites, writes + 1);
  assert.equal(animation.options.duration, 360);
  assert.equal(animation.options.easing, 'ease-in-out');
  assert.equal(animation.options.fill, 'both');
  fixture.layers.forEach((layer, index) => assert.equal(layer.classList.contains('is-visible'), index === 0));
  for (const progress of [.1, .5, .9]) {
    animation.progress = progress;
    assert.equal(fixture.svg.viewBoxWrites, writes + 1);
  }
  await finish(animation);
  fixture.layers.forEach((layer, index) => assert.equal(layer.classList.contains('is-visible'), index < 4));
  assert.equal(fixture.svg.viewBoxWrites, writes + 1);
  assert.equal(fixture.surface.properties.get('will-change'), undefined);
});

test('stage 5 shares stage 4 camera and reveals its country clue without another zoom', async () => {
  const fixture = createFixture();
  fixture.controller.showStage(4);
  await finish(fixture.animations.at(-1));
  const animations = fixture.animations.length;
  fixture.controller.showStage(5);
  assert.equal(fixture.animations.length, animations);
  assert.equal(fixture.layers.at(-1).classList.contains('is-visible'), true);
});

test('rapid stage changes continue from interpolated visual bounds and suppress stale completions', async () => {
  const fixture = createFixture();
  fixture.controller.showStage(4);
  const previous = fixture.animations.at(-1);
  previous.progress = .43;
  const expected = visualCamera(previous, camera(fixture.svg), .43);
  fixture.controller.showStage(2);
  const replacement = fixture.animations.at(-1);
  assert.equal(previous.cancelled, true);
  assertClose(visualCamera(replacement, camera(fixture.svg)), expected);
  await Promise.resolve();
  fixture.layers.filter((layer) => Number(layer.dataset.revealStage) > 2).forEach((layer) => assert.equal(layer.classList.contains('is-visible'), false));
  await finish(replacement);
  assertClose(camera(fixture.svg), cameras[2]);
  fixture.layers.forEach((layer, index) => assert.equal(layer.classList.contains('is-visible'), index < 2));
});

test('disposing a map cancels animation and prevents any later stage completion', async () => {
  const fixture = createFixture();
  fixture.controller.showStage(4);
  const animation = fixture.animations.at(-1);
  fixture.controller.dispose();
  assert.equal(animation.cancelled, true);
  assert.equal(fixture.surface.properties.get('will-change'), undefined);
  fixture.controller.showStage(5);
  await Promise.resolve();
  assert.equal(fixture.layers.at(-1).classList.contains('is-visible'), false);
});

test('reduced motion reveals immediately, with no Web Animation request', () => {
  const fixture = createFixture(true);
  fixture.controller.showStage(4);
  assert.equal(fixture.animations.length, 0);
  assert.deepEqual(camera(fixture.svg), cameras[4]);
  fixture.layers.forEach((layer, index) => assert.equal(layer.classList.contains('is-visible'), index < 4));
  assert.equal(fixture.viewport.classList.contains('city-map--instant'), true);
});
