import { cameraTransform } from '../../scripts/camera-transform.mjs';
import { applyRevealStages } from './reveal-stages.mjs';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SAFE_TAGS = new Set(['svg', 'g', 'path', 'defs', 'clippath', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'use', 'symbol']);
const SAFE_ATTRIBUTES = new Set([
  'class', 'id', 'viewBox', 'preserveAspectRatio', 'xmlns', 'd', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'points', 'transform', 'fill-rule', 'clip-rule', 'clip-path', 'vector-effect',
  'data-layer', 'data-reveal-stage', 'href', 'xlink:href',
]);

export const validCamera = (camera) => Array.isArray(camera) && camera.length === 4
  && camera.every(Number.isFinite) && camera[2] > 0 && camera[3] > 0;

export const sameCamera = (first, second) => validCamera(first) && validCamera(second)
  && first.every((value, index) => Math.abs(value - second[index]) < 1e-7);

export function validateMapMetadata(metadata) {
  if (!metadata?.cameras || Object.keys(metadata.cameras).sort().join(',') !== '1,2,3,4,5') {
    throw new Error('The map must contain five camera stages.');
  }
  const cameras = {};
  for (let stage = 1; stage <= 5; stage += 1) {
    const camera = metadata.cameras[stage];
    if (!validCamera(camera)) throw new Error(`Stage ${stage} has an invalid map camera.`);
    cameras[stage] = [...camera];
  }
  // Keep only rendering configuration, never answer or source-name metadata.
  return { cameras };
}

/** Defense in depth for our generated assets, not a general-purpose SVG importer. */
export function sanitizeMapSvg(svg) {
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    if (element.namespaceURI !== SVG_NAMESPACE || !SAFE_TAGS.has(element.localName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name;
      const value = attribute.value;
      const localReference = (name === 'href' || name === 'xlink:href') && /^#[\w.-]+$/.test(value);
      const validClip = name !== 'clip-path' || /^url\(#[\w.-]+\)$/.test(value);
      if (!SAFE_ATTRIBUTES.has(name) || !validClip
        || ((name === 'href' || name === 'xlink:href') && !localReference)) {
        element.removeAttribute(name);
      }
    }
  }
  // Geography clues are React overlays; map assets must not contain answer text.
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Mystery city map, north up');
  svg.setAttribute('focusable', 'false');
  return svg;
}

export function parseMapSvg(source, Parser = globalThis.DOMParser) {
  if (typeof Parser !== 'function') throw new Error('This browser cannot read SVG maps.');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) throw new Error('The map contains unsupported XML declarations.');
  const document = new Parser().parseFromString(source, 'image/svg+xml');
  const svg = document.documentElement;
  if (document.querySelector('parsererror') || svg?.localName !== 'svg' || svg.namespaceURI !== SVG_NAMESPACE) {
    throw new Error('The map is not a valid SVG document.');
  }
  const metadata = svg.querySelector('metadata');
  let config;
  try {
    config = validateMapMetadata(JSON.parse(metadata?.textContent ?? '{}'));
  } catch (error) {
    throw new Error(`Unable to read map stages: ${error.message}`);
  }
  sanitizeMapSvg(svg);
  const layers = [...svg.querySelectorAll('[data-reveal-stage]')];
  if (!layers.length || !layers.some((layer) => Number(layer.dataset.revealStage) === 1)
    || layers.some((layer) => !Number.isInteger(Number(layer.dataset.revealStage))
      || Number(layer.dataset.revealStage) < 1 || Number(layer.dataset.revealStage) > 5)) {
    throw new Error('The map contains invalid reveal layers.');
  }
  return { svg, config };
}

/** Animate the HTML surface, keeping SVG geometry stable throughout each zoom. */
export function createMapController({ svg, config, surface, viewport, reducedMotion = () => false }) {
  let motion = null;
  let stage = 1;
  let disposed = false;
  const layers = applyRevealStages([...svg.querySelectorAll('[data-reveal-stage]')]);

  const camera = () => svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const setCamera = (next) => {
    if (!sameCamera(camera(), next)) svg.setAttribute('viewBox', next.join(' '));
  };
  const cancelZoom = () => {
    if (motion) {
      const previous = motion;
      motion = null;
      previous.animation.cancel();
    }
    surface.style.removeProperty('will-change');
  };
  const currentCamera = () => {
    if (!motion) return camera();
    const progress = motion.animation.playState === 'finished' ? 1 : motion.animation.effect.getComputedTiming().progress ?? 0;
    const amount = Math.max(0, Math.min(1, progress));
    const interpolate = (key) => motion.first[key] + (motion.last[key] - motion.first[key]) * amount;
    const width = motion.render[2] / interpolate('scaleX');
    const height = motion.render[3] / interpolate('scaleY');
    return [motion.render[0] - interpolate('translateXPercent') / 100 * width,
      motion.render[1] - interpolate('translateYPercent') / 100 * height, width, height];
  };

  function showStage(nextStage, immediate = false) {
    if (disposed) return;
    if (!Number.isInteger(nextStage) || nextStage < 1 || nextStage > 5) throw new Error('Map stage must be between 1 and 5.');
    const target = config.cameras[nextStage];
    if (!validCamera(target)) throw new Error(`Stage ${nextStage} has no valid camera.`);
    const start = currentCamera();
    cancelZoom();
    stage = nextStage;
    const instant = immediate || reducedMotion();
    viewport.classList.toggle('city-map--instant', instant);
    layers.forEach((layer) => {
      if (Number(layer.dataset.revealStage) > stage) {
        layer.classList.remove('is-visible');
        layer.style.setProperty('visibility', 'hidden');
      }
    });
    const reveal = () => {
      if (disposed || stage !== nextStage) return;
      layers.forEach((layer) => {
        const visible = Number(layer.dataset.revealStage) <= stage;
        if (visible) layer.style.removeProperty('visibility');
        layer.classList.toggle('is-visible', visible);
      });
    };
    if (instant || !validCamera(start) || sameCamera(start, target) || typeof surface.animate !== 'function') {
      setCamera(target);
      reveal();
      return;
    }
    const left = Math.min(start[0], target[0]);
    const top = Math.min(start[1], target[1]);
    const render = [left, top,
      Math.max(start[0] + start[2], target[0] + target[2]) - left,
      Math.max(start[1] + start[3], target[1] + target[3]) - top];
    const first = cameraTransform(start, render);
    const last = cameraTransform(target, render);
    const transform = (matrix) => `translate(${matrix.translateXPercent}%, ${matrix.translateYPercent}%) scale(${matrix.scaleX}, ${matrix.scaleY})`;
    setCamera(render);
    surface.style.setProperty('will-change', 'transform');
    const animation = surface.animate([{ transform: transform(first) }, { transform: transform(last) }],
      { duration: 360, easing: 'ease-in-out', fill: 'both' });
    const active = { animation, render, first, last };
    motion = active;
    animation.finished.then(() => {
      if (disposed || motion !== active) return;
      motion = null;
      setCamera(target);
      animation.cancel();
      surface.style.removeProperty('will-change');
      reveal();
    }, () => {});
  }

  return {
    showStage,
    dispose() {
      disposed = true;
      cancelZoom();
      viewport.classList.remove('city-map--instant');
    },
  };
}
