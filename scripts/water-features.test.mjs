import test from 'node:test';
import assert from 'node:assert/strict';
import { isMajorWaterFeature } from './water-features.mjs';

const river = (name, overrides = {}) => ({
  subtype: 'river', class: 'river', names: name ? { primary: name } : undefined,
  source_tags: [['waterway', 'river']], ...overrides,
});

test('intermittent line channels are excluded using normalized or original tags', () => {
  assert.equal(isMajorWaterFeature(river('Dry River', { is_intermittent: true }), 'LineString'), false);
  assert.equal(isMajorWaterFeature(river('Dry River', { source_tags: [['intermittent', 'yes']] }), 'MultiLineString'), false);
  assert.equal(isMajorWaterFeature(river('Wide Creek', { width: 100, is_intermittent: true }), 'LineString'), false);
});

test('perennial named rivers, bayous, and unnamed channels stay continuous', () => {
  for (const name of ['Colorado River', 'Buffalo Bayou', undefined]) {
    assert.equal(isMajorWaterFeature(river(name, { is_intermittent: false }), 'LineString'), true);
  }
});

test('narrow creek, branch, brook, and stream names are rejected only as lines', () => {
  for (const name of ['Bear Creek', 'Johnson Branch', 'Meadow Brook', 'North Stream']) {
    assert.equal(isMajorWaterFeature(river(name), 'LineString'), false);
    assert.equal(isMajorWaterFeature(river(name), 'MultiLineString'), false);
    assert.equal(isMajorWaterFeature(river(name), 'Polygon'), true);
  }
});

test('a creek can qualify with at least 20 metres of explicit channel width', () => {
  assert.equal(isMajorWaterFeature(river('Bear Creek', { width: 20 }), 'LineString'), true);
  assert.equal(isMajorWaterFeature(river('Bear Creek', { width: 19.99 }), 'LineString'), false);
  assert.equal(isMajorWaterFeature(river('Bear Creek', { source_tags: [['width', '20 m']] }), 'LineString'), true);
  assert.equal(isMajorWaterFeature(river('Bear Creek', { width: 10, source_tags: [['width', '25']] }), 'LineString'), true);
  assert.equal(isMajorWaterFeature(river('Bear Creek', { source_tags: [['width', '70 ft']] }), 'LineString'), true);
  assert.equal(isMajorWaterFeature(river('Bear Creek', { source_tags: [['width', '65 ft']] }), 'LineString'), false);
  assert.equal(isMajorWaterFeature(river('Bear Creek', { width: 'unknown' }), 'LineString'), false);
});

test('polygon selection is unchanged by intermittent tags and small-water names', () => {
  const area = river('Bear Creek', { is_intermittent: true, source_tags: [['intermittent', 'yes']] });
  assert.equal(isMajorWaterFeature(area, 'Polygon'), true);
  assert.equal(isMajorWaterFeature(area, 'MultiPolygon'), true);
});

test('irrigation and drainage exclusions still override names and channel width', () => {
  assert.equal(isMajorWaterFeature(river('Irrigation Canal', { width: 100 }), 'LineString'), false);
  assert.equal(isMajorWaterFeature(river('Unnamed', { source_tags: [['waterway', 'ditch']] }), 'LineString'), false);
  assert.equal(isMajorWaterFeature({ subtype: 'reservoir', source_tags: [['reservoir_type', 'wastewater']] }, 'Polygon'), false);
  assert.equal(isMajorWaterFeature({ subtype: 'stream' }, 'LineString'), false);
});

test('omitting geometry type preserves compatibility with existing callers', () => {
  assert.equal(isMajorWaterFeature(river('Bear Creek', { is_intermittent: true })), true);
});
