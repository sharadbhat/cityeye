import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CITIES, ORIGINAL_CITY_IDS } from './cities.mjs';
import { WORLD_CITIES } from './world-cities.mjs';
import { createSearchIndex, normalizeCityQuery } from '../src/lib/city-search.mjs';
import { loadPlayableCities, PLAYABLE_GEO_NAMES } from './playable-cities.mjs';

const record = (id, name, population, aliases = [], region = 'Oregon', country = 'United States', countryCode = 'US') => ({
  id, name, region, country, countryCode, latitude: 45.5, longitude: -122.7, population, aliases,
});

test('city autocomplete prioritizes exact names and aliases over larger prefix matches', () => {
  const index = createSearchIndex({ cities: [record(1, 'Portland', 600_000), record(2, 'Port', 600), record(3, 'San Francisco', 900_000, ['SF']), record(4, 'Sfax', 1_000_000)] });
  assert.deepEqual(index.search('port').map((city) => city.id), [2, 1]);
  assert.deepEqual(index.search('SF').map((city) => city.id), [3, 4]);
});

test('accent normalization and aliases find canonical records without duplicate suggestions', () => {
  const index = createSearchIndex([record(1, 'São Paulo', 12_000_000, ['Sao Paulo', 'São Paulo', 'Sampa']), record(1, 'São Paulo', 10, ['Old duplicate'])]);
  assert.equal(normalizeCityQuery('  SÃO  PAULO! '), 'sao paulo');
  assert.deepEqual(index.search('sao paulo').map((city) => city.id), [1]);
  assert.equal(index.search('sampa')[0].name, 'São Paulo');
  assert.equal(index.get('1').population, 12_000_000);
  assert.equal(index.get('bad-id'), null);
});

test('region and country qualifications disambiguate identical city names', () => {
  const index = createSearchIndex([
    record(1, 'Portland', 600_000), record(2, 'Portland', 70_000, [], 'Maine'),
    record(3, 'Portland', 5_000, [], 'Sussex', 'United Kingdom', 'GB'),
  ]);
  assert.deepEqual(index.search('Portland').map((city) => city.id), [1, 2, 3]);
  assert.deepEqual(index.search('Portland Maine').map((city) => city.id), [2]);
  assert.deepEqual(index.search('Portland US').map((city) => city.id), [1, 2], 'US qualification cannot match the middle of Sussex');
  assert.deepEqual(index.search('Portland, United Kingdom').map((city) => city.id), [3]);
});

test('search limits and returned fields keep the playable pool out of autocomplete', () => {
  const index = createSearchIndex(Array.from({ length: 30 }, (_, index) => ({ ...record(index + 1, `Town ${index}`, index), playable: index === 0, svgUrl: '/secret-map.svg' })));
  assert.equal(index.search('town').length, 8);
  assert.equal(index.search('town', 100).length, 20);
  assert.equal(index.search('town', 3).length, 3);
  assert.equal(index.search('town', 'invalid').length, 8);
  assert.deepEqual(index.search('  '), []);
  assert.deepEqual(Object.keys(index.search('town')[0]).sort(), ['id', 'name', 'region', 'country', 'countryCode', 'latitude', 'longitude', 'population', 'aliases'].sort());
});

let worldwide;
const globalSearch = () => worldwide ??= readFile(new URL('../data/city-catalog.json', import.meta.url), 'utf8')
  .then(JSON.parse).then(createSearchIndex);

test('the generated worldwide catalog contains broad coverage and recognizes common international spellings', async () => {
  const index = await globalSearch();
  assert.ok(index.catalog.cities.length > 5_000);
  assert.ok(new Set(index.catalog.cities.map((city) => city.countryCode)).size > 150);
  assert.equal(index.catalog.source.minimumPopulation, 100_000);
  assert.equal(index.catalog.source.name, 'GeoNames cities15000');
  assert.equal(index.catalog.source.url, 'https://download.geonames.org/export/dump/cities15000.zip');
  assert.ok(index.catalog.cities.every((city) => city.population >= 100_000));
  assert.equal(index.catalog.source.license, 'CC BY 4.0');
  assert.equal(index.search('São Paulo')[0].id, 3448439);
  assert.equal(index.search('sao paulo')[0].id, 3448439);
  assert.equal(index.search('München')[0].id, 2867714);
  assert.ok(!index.search('Portland').some((city) => city.id === 4975802), 'Portland Maine is below the population cutoff');
  assert.ok(index.search('Tokyo').length > 0);
});

test('all 16 playable maps match verified global city IDs and curated short names', async () => {
  const index = await globalSearch();
  const playable = loadPlayableCities(index.catalog, Object.fromEntries(ORIGINAL_CITY_IDS.map(id => [id, CITIES[id]])));
  assert.equal(playable.length, 16);
  for (const city of playable) {
    assert.equal(city.id, PLAYABLE_GEO_NAMES[city.key].id);
    assert.equal(city.geonameId, city.id);
    assert.equal(city.region, PLAYABLE_GEO_NAMES[city.key].region);
    assert.equal(city.svgUrl, `/maps/${city.id}.svg`);
    assert.ok(index.get(city.id));
  }
  for (const [query, key] of [['NYC', 'nyc'], ['SF', 'sf'], ['LA', 'la'], ['Philly', 'philly'], ['SLC', 'slc']]) {
    assert.equal(index.search(query)[0].id, PLAYABLE_GEO_NAMES[key].id, query);
  }
  const wrongRegion = { cities: index.catalog.cities.map((city) => city.id === PLAYABLE_GEO_NAMES.portland.id ? { ...city, region: 'Maine' } : city) };
  assert.throws(() => loadPlayableCities(wrongRegion, { portland: CITIES.portland }), /verification/);
});

test('the 42 worldwide city identities match catalog names, countries, regions and downtown coordinates', async () => {
  const index = await globalSearch();
  const cities = loadPlayableCities(index.catalog, WORLD_CITIES);
  assert.equal(cities.length, 42);
  assert.equal(new Set(cities.map(city => city.id)).size, 42);
  for (const city of cities) {
    assert.ok(index.search(city.name, 20).some(record => record.id === city.id), city.label);
    assert.ok(index.get(city.id).population >= 100_000);
  }
});
