// Exercise the offline preview controls against real SVG metadata without launching a browser.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { CITIES, MAJOR_CITY_IDS } from './cities.mjs';
import { cameraTransform } from './camera-transform.mjs';

class Element {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.properties = new Map();
    this.viewBoxWriteCount = 0;
    this._text = null;
    const classes = new Set();
    this.classList = {
      toggle(name, force = !classes.has(name)) { if (force) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
    };
    this.style = {
      transform: '',
      setProperty: (name, value) => this.properties.set(name, value),
      removeProperty: (name) => this.properties.delete(name),
    };
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'viewBox') this.viewBoxWriteCount += 1;
  }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  dispatch(name) { this.listeners.get(name)?.(); }
  replaceChildren(...children) { this.children = children; this._text = null; }
  append(...children) { this.children.push(...children); }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 800, width: 800, height: 800 }; }
  set textContent(value) { this._text = String(value); }
  get textContent() { return this._text ?? this.children.map((child) => typeof child === 'string' ? child : child.textContent).join(''); }
}

class Svg extends Element {
  constructor(record) {
    super();
    this.record = record;
    this.setAttribute('viewBox', record.viewBox);
    this.layers = record.stages.map((stage) => new Element({ revealStage: String(stage) }));
    this.bands = record.elevation.map((band) => new Element({
      elevationNormalized: band.normalized,
      elevationMin: band.min,
      elevationMax: band.max,
    }));
  }
  cloneNode() { return new Svg(this.record); }
  querySelector(selector) { return selector === 'metadata' ? { textContent: JSON.stringify(this.record.config) } : null; }
  querySelectorAll(selector) { return selector === '[data-reveal-stage]' ? this.layers : selector === '.elevation-band' ? this.bands : []; }
}

function decodeXml(text) {
  return text.replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&#39;', "'");
}

async function loadRecords() {
  const records = new Map();
  for (const id of [...MAJOR_CITY_IDS, 'slc']) {
    const svg = await readFile(new URL(`../output/${id}-city-layered.svg`, import.meta.url), 'utf8');
    const config = JSON.parse(decodeXml(svg.match(/<metadata>([\s\S]*?)<\/metadata>/)[1]));
    records.set(id, {
      id,
      config,
      viewBox: svg.match(/\bviewBox="([^"]+)"/)[1],
      stages: [...svg.matchAll(/<g\b[^>]*\bdata-reveal-stage="(\d+)"/g)].map((match) => Number(match[1])),
      elevation: [...svg.matchAll(/<path\b[^>]*class="[^"]*\belevation-band\b[^>]*>/g)].map(([tag]) => ({
        normalized: tag.match(/data-elevation-normalized="([^"]+)"/)?.[1],
        min: tag.match(/data-elevation-min="([^"]+)"/)?.[1],
        max: tag.match(/data-elevation-max="([^"]+)"/)?.[1],
      })),
    });
  }
  return records;
}

async function createPreview(records, reducedMotion = false) {
  const html = await readFile(new URL('./city-preview-template.html', import.meta.url), 'utf8');
  const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const map = new Element();
  const surface = new Element();
  map.append(surface);
  const status = new Element();
  const attribution = new Element();
  const selector = new Element();
  selector.options = [...records.keys()].map((value) => ({ value }));
  const buttons = Array.from({ length: 5 }, (_, index) => new Element({ stage: String(index + 1) }));
  const templates = [...records].map(([id, record]) => ({
    dataset: { city: id, label: CITIES[id].label },
    content: { querySelector: () => new Svg(record) },
  }));
  const surfaces = new Map([['#map', map], ['#map-surface', surface], ['#city', selector], ['#status', status], ['#additional-sources', attribution]]);
  const frames = new Map();
  const animations = [];
  surface.animate = (keyframes, options) => {
    let resolveFinished;
    let rejectFinished;
    const animation = {
      keyframes,
      options,
      progress: 0,
      cancelled: false,
      playState: 'running',
      finished: new Promise((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; }),
      effect: { getComputedTiming: () => ({ progress: animation.progress }) },
      cancel() {
        animation.cancelled = true;
        animation.playState = 'idle';
        animation.progress = null;
        rejectFinished(Object.assign(new Error('Animation cancelled.'), { name: 'AbortError' }));
      },
      finish() {
        if (animation.playState === 'running') {
          animation.progress = 1;
          animation.playState = 'finished';
          resolveFinished(animation);
        }
      },
    };
    animations.push(animation);
    return animation;
  };
  let identifier = 0;
  let now = 0;
  const context = vm.createContext({
    document: {
      querySelector: (selector) => surfaces.get(selector),
      querySelectorAll: (selector) => selector.startsWith('button') ? buttons : templates,
      createElement: () => new Element(),
    },
    matchMedia: () => ({ matches: reducedMotion }),
    requestAnimationFrame: (callback) => { frames.set(++identifier, callback); return identifier; },
    cancelAnimationFrame: (id) => frames.delete(id),
    setTimeout: (callback) => callback(),
    performance: { now: () => now },
    console: { error: (error) => { throw error; } },
  });
  new vm.Script(source).runInContext(context);
  const advanceAnimation = (progress, animation = animations.findLast((animation) => animation.playState === 'running')) => {
    assert.ok(animation, 'A camera animation is active.');
    assert.ok(progress >= 0 && progress <= 1, 'Animation progress is between zero and one.');
    animation.progress = progress;
    return animation;
  };
  const finishAnimation = async (animation = animations.findLast((animation) => animation.playState === 'running')) => {
    assert.ok(animation, 'A camera animation is available to finish.');
    animation.finish();
    await Promise.resolve();
    await Promise.resolve();
  };
  const settle = async () => {
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const pending = [...frames.values()];
      frames.clear();
      now += 700;
      pending.forEach((callback) => callback(now));
      await Promise.resolve();
      animations.filter((animation) => animation.playState === 'running').forEach((animation) => animation.finish());
      await Promise.resolve();
      await Promise.resolve();
      if (!frames.size && !animations.some((animation) => animation.playState === 'running')) return;
    }
    throw new Error('The preview animation did not settle.');
  };
  await settle();
  const preview = { map, surface, status, attribution, selector, buttons, settle, frames, animations, advanceAnimation, finishAnimation };
  Object.defineProperty(preview, 'svg', { get: () => surface.children[0] });
  Object.defineProperty(preview, 'viewBoxWriteCount', { get: () => surface.children[0]?.viewBoxWriteCount ?? 0 });
  return preview;
}

function camera(svg) { return svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number); }

function assertCamera(actual, expected, message) {
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-7, `${message}: component ${index} (${value} versus ${expected[index]})`));
}

function transformValues(frame) {
  const match = frame.transform.match(/^translate\(([-+\d.e]+)%,\s*([-+\d.e]+)%\) scale\(([-+\d.e]+),\s*([-+\d.e]+)\)$/i);
  assert.ok(match, `Camera keyframe has a translation and scale: ${frame.transform}`);
  return match.slice(1).map(Number);
}

function visualCamera(animation, renderCamera, progress = 0) {
  const first = transformValues(animation.keyframes[0]);
  const last = transformValues(animation.keyframes.at(-1));
  const [translateX, translateY, scaleX, scaleY] = first.map((value, index) => value + (last[index] - value) * progress);
  const width = renderCamera[2] / scaleX;
  const height = renderCamera[3] / scaleY;
  return [renderCamera[0] - translateX / 100 * width, renderCamera[1] - translateY / 100 * height, width, height];
}

test('offline preview switches every city and reveals all five stages using its camera metadata', async () => {
  const records = await loadRecords();
  const preview = await createPreview(records);
  assert.equal(preview.selector.value, 'nyc');
  for (const [id, record] of records) {
    for (let stage = 1; stage <= 5; stage += 1) {
      const camera = record.config.cameras[stage];
      assert.equal(camera.length, 4, `${id}: stage ${stage} camera`);
      assert.ok(camera.every(Number.isFinite) && camera[2] > 0 && camera[3] > 0);
    }
    preview.selector.value = id;
    preview.selector.dispatch('change');
    assert.equal(preview.map.getAttribute('aria-busy'), 'true');
    await preview.settle();
    assert.equal(preview.map.children[0], preview.surface, 'The map retains its fixed animation surface.');
    const svg = preview.svg;
    assert.equal(svg.record.id, id);
    assert.equal(preview.map.getAttribute('aria-busy'), 'false');
    for (let stage = 1; stage <= 5; stage += 1) {
      preview.buttons[stage - 1].dispatch('click');
      await preview.settle();
      const actual = svg.getAttribute('viewBox').split(' ').map(Number);
      actual.forEach((value, index) => assert.ok(Math.abs(value - record.config.cameras[stage][index]) < 1e-8, `${id}: stage ${stage} camera component ${index}`));
      svg.layers.forEach((layer) => assert.equal(layer.classList.contains('visible'), Number(layer.dataset.revealStage) <= stage));
      assert.equal(preview.buttons[stage - 1].getAttribute('aria-pressed'), 'true');
      assert.equal(preview.status.textContent, `${CITIES[id].label} · Stage ${stage} of 5`);
    }
    svg.bands.forEach((band) => assert.match(band.properties.get('--elevation-color'), /^rgb\(\d+(?:\.\d+)?, \d+(?:\.\d+)?, \d+(?:\.\d+)?\)$/));
    if (svg.bands.length) {
      assert.equal(svg.bands[0].properties.get('--elevation-color'), 'rgb(255, 255, 255)', `${id}: lowest band is pure white`);
      if (svg.bands.length > 1) {
        assert.equal(svg.bands.at(-1).properties.get('--elevation-color'), 'rgb(170, 170, 170)', `${id}: highest band is medium gray`);
        const luminance = svg.bands.map((band) => Number(band.properties.get('--elevation-color').match(/[\d.]+/)[0]));
        luminance.slice(1).forEach((value, index) => assert.ok(value < luminance[index], `${id}: bands darken monotonically`));
      }
    }
    const supplemental = (record.config.sources ?? []).filter((source) => !/Overture|OpenStreetMap|USGS/i.test(source.name));
    assert.equal(preview.attribution.textContent, supplemental.map((source) => ` ${source.name}.`).join(''));
    supplemental.forEach((source) => assert.ok(preview.attribution.children.some((child) => typeof child !== 'string' && child.href === source.url)));
  }
});

test('zoom-out writes the camera once and reveals stage-4 terrain after the transform finishes', async () => {
  const records = await loadRecords();
  const preview = await createPreview(records);
  preview.buttons[2].dispatch('click');
  await preview.settle();
  const before = preview.viewBoxWriteCount;
  const previousCamera = camera(preview.svg);
  preview.buttons[3].dispatch('click');
  const animation = preview.animations.at(-1);
  const renderCamera = camera(preview.svg);
  assertCamera(renderCamera, records.get('nyc').config.cameras[4], 'Zoom-out commits its render camera upfront');
  assertCamera(visualCamera(animation, renderCamera), previousCamera, 'First frame retains the previous visual camera');
  assert.equal(preview.viewBoxWriteCount, before + 1);
  assert.equal(animation.options.duration, 360);
  assert.equal(animation.options.easing, 'ease-in-out');
  assert.equal(animation.options.fill, 'both');
  assert.equal(preview.surface.properties.get('will-change'), 'transform');
  preview.svg.layers.forEach((layer) => assert.equal(layer.classList.contains('visible'), Number(layer.dataset.revealStage) <= 3, 'New terrain stays hidden while zooming'));
  for (const progress of [.1, .25, .5, .75, .95]) {
    preview.advanceAnimation(progress);
    assert.equal(preview.viewBoxWriteCount, before + 1, 'Advancing compositor animation never rewrites SVG geometry');
    assertCamera(camera(preview.svg), renderCamera, 'Rendering camera stays fixed throughout motion');
  }
  await preview.finishAnimation(animation);
  assert.equal(preview.viewBoxWriteCount, before + 1, 'Zoom-out needs one viewBox write total');
  preview.svg.layers.forEach((layer) => assert.equal(layer.classList.contains('visible'), Number(layer.dataset.revealStage) <= 4));
  assert.equal(preview.surface.properties.get('will-change'), undefined);
  assert.equal(animation.cancelled, true, 'Temporary transform is removed after committing the final camera');
});

test('zoom-in hides extra layers immediately and changes viewBox only at completion', async () => {
  const records = await loadRecords();
  const preview = await createPreview(records);
  preview.buttons[3].dispatch('click');
  await preview.settle();
  const before = preview.viewBoxWriteCount;
  const regionalCamera = camera(preview.svg);
  preview.buttons[1].dispatch('click');
  const animation = preview.animations.at(-1);
  assertCamera(camera(preview.svg), regionalCamera, 'Zoom-in retains its larger render camera to avoid clipped margins');
  assert.equal(preview.viewBoxWriteCount, before);
  preview.svg.layers.filter((layer) => Number(layer.dataset.revealStage) > 2).forEach((layer) => {
    assert.equal(layer.classList.contains('visible'), false);
    assert.equal(layer.properties.get('visibility'), 'hidden', 'Unwanted layers disappear immediately without opacity fading');
  });
  assertCamera(visualCamera(animation, regionalCamera, 1), records.get('nyc').config.cameras[2], 'Last transformed frame reaches the requested close camera');
  preview.advanceAnimation(.6);
  assert.equal(preview.viewBoxWriteCount, before);
  await preview.finishAnimation(animation);
  assert.equal(preview.viewBoxWriteCount, before + 1, 'Zoom-in needs one viewBox write total');
  assertCamera(camera(preview.svg), records.get('nyc').config.cameras[2], 'Final close camera');
  preview.svg.layers.forEach((layer) => assert.equal(layer.classList.contains('visible'), Number(layer.dataset.revealStage) <= 2));
});

test('stage 4 to stage 5 shares a camera and reveals the country without an animation', async () => {
  const preview = await createPreview(await loadRecords());
  preview.buttons[3].dispatch('click');
  await preview.settle();
  const animations = preview.animations.length;
  const writes = preview.viewBoxWriteCount;
  preview.buttons[4].dispatch('click');
  assert.equal(preview.animations.length, animations);
  assert.equal(preview.viewBoxWriteCount, writes);
  preview.svg.layers.forEach((layer) => assert.equal(layer.classList.contains('visible'), true));
});

test('rapid stage changes resume the interpolated visual camera and cancel the old zoom', async () => {
  const records = await loadRecords();
  const preview = await createPreview(records);
  preview.buttons[3].dispatch('click');
  const first = preview.advanceAnimation(.43);
  const interruptedCamera = visualCamera(first, camera(preview.svg), .43);
  preview.buttons[1].dispatch('click');
  const second = preview.animations.at(-1);
  assert.notEqual(first, second);
  assert.equal(first.cancelled, true);
  assertCamera(visualCamera(second, camera(preview.svg)), interruptedCamera, 'Replacement starts exactly where the interrupted zoom was visible');
  await Promise.resolve();
  preview.svg.layers.filter((layer) => Number(layer.dataset.revealStage) > 2).forEach((layer) => assert.equal(layer.classList.contains('visible'), false));
  await preview.finishAnimation(second);
  assertCamera(camera(preview.svg), records.get('nyc').config.cameras[2], 'Latest stage wins');
  preview.svg.layers.forEach((layer) => assert.equal(layer.classList.contains('visible'), Number(layer.dataset.revealStage) <= 2));
  assert.equal(preview.status.textContent, 'New York City · Stage 2 of 5');
});

test('a queued completion from an older animation cannot reveal stale layers or clear a new transform', async () => {
  const records = await loadRecords();
  const preview = await createPreview(records);
  preview.buttons[3].dispatch('click');
  const first = preview.animations.at(-1);
  first.finish(); // Queue the old completion callback without allowing it to run.
  first.progress = null; // Some completed effects report no active timing progress.
  preview.buttons[1].dispatch('click');
  const second = preview.animations.at(-1);
  assert.notEqual(first, second);
  assertCamera(visualCamera(second, camera(preview.svg)), records.get('nyc').config.cameras[4], 'Completed effects resume from their final visual camera');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(second.playState, 'running');
  assert.equal(preview.surface.properties.get('will-change'), 'transform');
  preview.svg.layers.filter((layer) => Number(layer.dataset.revealStage) >= 4).forEach((layer) => assert.equal(layer.classList.contains('visible'), false));
  await preview.finishAnimation(second);
  assert.equal(preview.status.textContent, 'New York City · Stage 2 of 5');
});

test('switching city mid-animation cancels stale geometry and retains the visual camera', async () => {
  const records = await loadRecords();
  const preview = await createPreview(records);
  preview.buttons[3].dispatch('click');
  const first = preview.advanceAnimation(.31);
  const interruptedCamera = visualCamera(first, camera(preview.svg), .31);
  const previousSvg = preview.svg;
  preview.selector.value = 'sf';
  preview.selector.dispatch('change');
  assert.equal(first.cancelled, true);
  assert.equal(preview.map.getAttribute('aria-busy'), 'true');
  // Flush the loading frame, but leave the replacement zoom active for inspection.
  const pending = [...preview.frames.values()];
  preview.frames.clear();
  pending.forEach((callback) => callback(700));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(preview.svg.record.id, 'sf');
  assert.notEqual(preview.svg, previousSvg);
  const second = preview.animations.at(-1);
  assert.notEqual(first, second);
  assertCamera(visualCamera(second, camera(preview.svg)), interruptedCamera, 'New city continues from the current visual camera');
  first.finish();
  await Promise.resolve();
  assert.equal(preview.svg.record.id, 'sf');
  await preview.finishAnimation(second);
  assertCamera(camera(preview.svg), records.get('sf').config.cameras[4], 'New city final stage camera');
  assert.equal(preview.status.textContent, 'San Francisco · Stage 4 of 5');
  assert.equal(preview.map.children[0], preview.surface);
});

test('reduced motion sets the target camera without queuing a camera animation', async () => {
  const records = await loadRecords();
  const preview = await createPreview(records, true);
  preview.buttons[3].dispatch('click');
  assert.equal(preview.frames.size, 0);
  assert.equal(preview.animations.length, 0);
  assert.deepEqual(preview.svg.getAttribute('viewBox').split(' ').map(Number), records.get('nyc').config.cameras[4]);
  preview.svg.layers.forEach((layer) => assert.equal(layer.classList.contains('visible'), Number(layer.dataset.revealStage) <= 4));
});

test('inline camera transform matches the standalone helper for real city cameras', async () => {
  const html = await readFile(new URL('./city-preview-template.html', import.meta.url), 'utf8');
  const definition = html.match(/(?:^|\n)([ \t]*)function cameraTransform\(sourceCamera, targetCamera\) \{[\s\S]*?\n\1\}/);
  assert.ok(definition, 'Offline preview exposes the pure camera transform helper.');
  const inlineTransform = new vm.Script(`(${definition[0].trim()})`).runInNewContext({
    validCamera: (camera) => Array.isArray(camera) && camera.length === 4 && camera.every(Number.isFinite) && camera[2] > 0 && camera[3] > 0,
  });
  for (const [id, record] of await loadRecords()) {
    for (const source of Object.values(record.config.cameras)) {
      for (const target of Object.values(record.config.cameras)) {
        assert.deepEqual({ ...inlineTransform(source, target) }, cameraTransform(source, target), `${id}: inline and module camera geometry agree`);
      }
    }
  }
  const source = [100, 200, 400, 200];
  const target = [150, 175, 600, 300];
  assert.deepEqual({ ...inlineTransform(source, target) }, cameraTransform(source, target), 'Rectangular and shifted cameras use the same transform');
});

test('elevation starts white and darkens monotonically for adaptive and legacy band metadata', async () => {
  const records = await loadRecords();
  const base = records.get('nyc');
  const scenarios = [
    // Adaptive city-relative normalization.
    [0, 1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1].map((normalized) => ({ normalized })),
    // Older bands started at a nonzero globally normalized value.
    [.0457, .26, .47, .69, .88].map((normalized) => ({ normalized })),
    // Legacy absolute elevations, including elevated but nearly flat cities.
    [1600, 1601, 1602, 1603].map((min) => ({ min, max: min + 1 })),
    // A normalized field may be unusable while min/max values remain available.
    [250, 500, 750].map((min) => ({ normalized: 'invalid', min, max: min + 250 })),
    // Rounded legacy normalized values can be constant despite different elevations.
    [1600, 1601, 1602].map((min) => ({ normalized: '.6', min, max: min + 1 })),
    // Old assets without elevation metadata still use band order.
    [{}, {}, {}],
  ];
  for (const bands of scenarios) {
    const preview = await createPreview(new Map([['nyc', { ...base, elevation: bands }]]));
    const colors = preview.svg.bands.map((band) => band.properties.get('--elevation-color'));
    assert.equal(colors[0], 'rgb(255, 255, 255)');
    assert.equal(colors.at(-1), 'rgb(170, 170, 170)');
    const luminance = colors.map((color) => Number(color.match(/[\d.]+/)[0]));
    luminance.slice(1).forEach((value, index) => assert.ok(value < luminance[index]));
  }
});

test('single or constant elevation bands stay white without an all-map tint', async () => {
  const base = (await loadRecords()).get('nyc');
  for (const bands of [[{ normalized: '.57' }], [{ min: 1600, max: 1620 }], [{}], [{ normalized: '.4' }, { normalized: '.4' }]]) {
    const preview = await createPreview(new Map([['nyc', { ...base, elevation: bands }]]));
    const colors = preview.svg.bands.map((band) => band.properties.get('--elevation-color'));
    colors.forEach((color) => assert.equal(color, 'rgb(255, 255, 255)'));
  }
  const html = await readFile(new URL('./city-preview-template.html', import.meta.url), 'utf8');
  assert.match(html, /#map \.elevation-band \{ fill: var\(--elevation-color, #fff\); opacity: 1; \}/);
});

test('PNG renderer and standalone SLC preview follow the same elevation palette contract', async () => {
  const sources = await Promise.all([
    readFile(new URL('./city-preview-template.html', import.meta.url), 'utf8'),
    readFile(new URL('./render-city-checks.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../output/slc-layer-preview.html', import.meta.url), 'utf8'),
  ]);
  const palettes = sources.map((source) => {
    const definition = source.match(/(?:^|\n)([ \t]*)function elevationColors\(bands\) \{[\s\S]*?\n\1\}/);
    assert.ok(definition, 'Every preview renderer must expose the same pure palette helper.');
    return new vm.Script(`(${definition[0].trim()})`).runInNewContext();
  });
  for (const bands of [[], [{ normalized: '.5' }], [{ normalized: '.1' }, { normalized: '.3' }, { normalized: '.9' }], [{ min: 1700 }, { min: 1710 }, { min: 1720 }], [{}, {}, {}]]) {
    const expected = Array.from(palettes[0](bands));
    palettes.slice(1).forEach((palette) => assert.deepEqual(Array.from(palette(bands)), expected));
  }
});
