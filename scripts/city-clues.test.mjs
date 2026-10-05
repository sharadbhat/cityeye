import test from 'node:test';
import assert from 'node:assert/strict';
import { CITIES } from './cities.mjs';
import { PLAYABLE_GEO_NAMES } from './playable-cities.mjs';
import { continentForCity, geographyClue } from '../src/lib/city-clues.mjs';
import { applyRevealStages, STAGE_HINTS } from '../src/lib/reveal-stages.mjs';

test('all 365 configured cities have a supported continent clue', () => {
  assert.equal(Object.keys(CITIES).length, 365);
  for (const key of Object.keys(CITIES)) {
    const identity = PLAYABLE_GEO_NAMES[key];
    assert.ok(continentForCity({ ...identity, countryCode: identity.countryCode ?? 'US' }));
  }
});

test('continents use city-level exceptions for transcontinental countries', () => {
  assert.equal(continentForCity({ id: 524901, countryCode: 'RU' }), 'Europe');
  assert.equal(continentForCity({ geonameId: 745044, countryCode: 'TR' }), 'Europe / Asia');
  assert.equal(continentForCity({ countryCode: 'PA' }), 'North America');
  assert.equal(continentForCity({ countryCode: 'NZ' }), 'Oceania');
  assert.equal(continentForCity({ id: 498817, countryCode: 'RU' }), 'Europe');
  assert.equal(continentForCity({ id: 323786, countryCode: 'TR' }), 'Asia');
  assert.equal(continentForCity({ id: 311046, countryCode: 'TR' }), 'Asia');
  assert.equal(continentForCity({ id: 323777, countryCode: 'TR' }), 'Asia');
  assert.equal(continentForCity({ id: 1526273, countryCode: 'KZ' }), 'Asia');
  assert.equal(continentForCity({ id: 611717, countryCode: 'GE' }), 'Asia');
  assert.equal(continentForCity({ id: 587084, countryCode: 'AZ' }), 'Asia');
  assert.throws(() => continentForCity({ id: 1, countryCode: 'RU' }), /No verified continent/);
  assert.throws(() => continentForCity({ countryCode: 'constructor' }), /No verified continent/);
});

test('stage 4 reveals only the continent; stage 5 adds country and retains continent', () => {
  const city = { id: 5780993, countryCode: 'US', country: 'United States' };
  for (const stage of [1, 2, 3]) assert.equal(geographyClue(city, stage), null);
  assert.deepEqual(geographyClue(city, 4), { label: 'Continent', value: 'North America' });
  assert.deepEqual(geographyClue(city, 5), { label: 'Country', value: 'United States', continent: 'North America' });
  assert.equal(geographyClue(null, 4), null);
  assert.equal(STAGE_HINTS[4], 'Continent clue');
});

test('game removes terrain and SVG country labels without modifying generated files', () => {
  const names = ['water', 'parks', 'transit', 'elevation-bands', 'contours', 'country-clue', 'regional-roads'];
  const layers = names.map((name) => ({
    dataset: { layer: name }, removed: false,
    remove() { this.removed = true; },
    setAttribute(key, value) { this[key] = value; },
  }));
  const retained = applyRevealStages(layers);
  assert.deepEqual(retained.map((layer) => layer.dataset.layer), ['water', 'parks', 'transit', 'regional-roads']);
  assert.deepEqual(layers.filter((layer) => layer.removed).map((layer) => layer.dataset.layer), ['elevation-bands', 'contours', 'country-clue']);
  assert.equal(retained[0]['data-reveal-stage'], 1);
  assert.equal(retained[1]['data-reveal-stage'], 2);
  assert.equal(retained[2]['data-reveal-stage'], 2);
  assert.equal(retained[3]['data-reveal-stage'], 3);
});
