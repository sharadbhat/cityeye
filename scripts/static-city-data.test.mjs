import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { packCatalog, unpackCatalog } from '../src/lib/catalog-format.mjs';
import { createStaticCityDirectory } from '../src/lib/city-directory.mjs';
import { createSearchIndex } from '../src/lib/city-search.mjs';
import { publicMapSvg } from './public-map.mjs';

const city = { id: 5780993, name: 'Salt Lake City', region: 'Utah', country: 'United States', countryCode: 'US', latitude: 40.76078, longitude: -111.89105, population: 215548, aliases: ['SLC'] };
const catalog = { source: { license: 'CC BY 4.0' }, cities: [city] };
const manifest = { version: 1, catalogFile: 'cities-0123456789ab.json', playableIds: [city.id] };

test('compact static catalog preserves identity, coordinates, aliases and attribution', () => {
  assert.deepEqual(unpackCatalog(packCatalog(catalog)), catalog);
  assert.throws(() => unpackCatalog({ version: 2 }), /Unsupported/);
  const malformed = packCatalog(catalog);
  malformed.cities[0][4] = 200;
  assert.throws(() => unpackCatalog(malformed), /Invalid/);
});

test('static directory shares one download across boot and searches, uses repository base path', async () => {
  const requests = [];
  const directory = createStaticCityDirectory({ baseUrl: '/guess-the/', fetcher: async url => {
    requests.push(url);
    return { ok: true, json: async () => url.endsWith('game-data.json') ? manifest : packCatalog(catalog) };
  } });
  const [playable, suggestions] = await Promise.all([directory.loadPlayableCities(), directory.search('SLC')]);
  assert.deepEqual(requests, ['/guess-the/data/game-data.json', '/guess-the/data/cities-0123456789ab.json']);
  assert.equal(playable[0].svgUrl, '/guess-the/maps/5780993.svg');
  assert.equal(playable[0].key, '5780993');
  assert.equal(suggestions[0].id, playable[0].id);
  await directory.search('salt');
  await directory.loadPlayableCities();
  assert.equal(requests.length, 2, 'Typing and new rounds never make API requests.');
});

test('static directory retries a failed load and rejects invalid manifest paths/identities', async () => {
  let fail = true;
  const directory = createStaticCityDirectory({ fetcher: async url => {
    if (fail) { fail = false; return { ok: false, status: 503 }; }
    return { ok: true, json: async () => url.endsWith('game-data.json') ? manifest : packCatalog(catalog) };
  } });
  await assert.rejects(directory.loadPlayableCities(), /503/);
  assert.equal((await directory.loadPlayableCities()).length, 1);
  for (const invalid of [{ ...manifest, catalogFile: '../secret.json' }, { ...manifest, playableIds: ['5780993'] }, { ...manifest, playableIds: [city.id, city.id] }]) {
    const broken = createStaticCityDirectory({ fetcher: async () => ({ ok: true, json: async () => invalid }) });
    await assert.rejects(broken.loadPlayableCities(), /Invalid/);
  }
});

test('public SVG keeps cameras/streets but removes city, country, coordinate metadata and terrain', async () => {
  const source = await readFile(new URL('../output/slc-city-layered.svg', import.meta.url), 'utf8');
  const published = publicMapSvg(source);
  const metadata = JSON.parse(published.match(/<metadata>([\s\S]*?)<\/metadata>/)[1].replaceAll('&quot;', '"'));
  assert.deepEqual(Object.keys(metadata), ['cameras']);
  assert.equal(Object.keys(metadata.cameras).length, 5);
  assert.doesNotMatch(published, /country-clue|elevation-bands|data-layer="contours"|United States|cityKey|latitude|longitude/);
  assert.match(published, /data-layer="downtown-roads"/);
  assert.equal(publicMapSvg(published), published, 'Publishing is idempotent.');
});

test('browser search preserves worldwide results after compact catalog round trip', async () => {
  const full = JSON.parse(await readFile(new URL('../data/city-catalog.json', import.meta.url), 'utf8'));
  const original = createSearchIndex(full);
  const start = performance.now();
  const packed = createSearchIndex(unpackCatalog(packCatalog(full)));
  assert.ok(performance.now() - start < 5000, 'Catalog initialization must remain bounded.');
  for (const query of ['NYC', 'SF', 'Philly', 'São Paulo', 'sao paulo', 'München', 'Tokyo', 'Portland Oregon', 'London']) {
    assert.deepEqual(packed.search(query), original.search(query), query);
  }
});

test('prepared website uses ID-only maps and an ID-only manifest', async () => {
  const prepared = JSON.parse(await readFile(new URL('../public/data/game-data.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(prepared).sort(), ['catalogFile', 'playableIds', 'version']);
  const files = await readdir(new URL('../public/maps/', import.meta.url));
  assert.ok(files.length > 0);
  assert.ok(files.every(file => /^\d+\.svg$/.test(file)), 'No city-named maps may ship.');
  for (const id of prepared.playableIds) assert.ok(files.includes(`${id}.svg`));
});
