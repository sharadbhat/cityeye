// Game rules live outside generated geometry so existing maps can be reused.
export const STAGE_HINTS = Object.freeze({
  1: 'Downtown streets and major water features',
  2: 'Parks and public transit',
  3: 'Wider regional road network',
  4: 'Continent clue',
  5: 'Country clue',
});

export const FEATURE_REVEAL_STAGES = Object.freeze({
  water: 1,
  parks: 2,
  transit: 2,
  'regional-roads': 3,
  rail: 3,
});

export function applyRevealStages(layers) {
  // The app renders geography labels as readable HTML overlays. Preserve the
  // generated files, but omit terrain and the old SVG country label in-game.
  const omitted = new Set(['elevation-bands', 'contours', 'country-clue']);
  const visibleLayers = [];
  for (const layer of layers) {
    if (omitted.has(layer.dataset.layer)) {
      layer.remove();
      continue;
    }
    if (Object.hasOwn(FEATURE_REVEAL_STAGES, layer.dataset.layer)) {
      layer.setAttribute('data-reveal-stage', FEATURE_REVEAL_STAGES[layer.dataset.layer]);
    }
    visibleLayers.push(layer);
  }
  return visibleLayers;
}
