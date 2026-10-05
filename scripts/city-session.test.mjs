import test from 'node:test';
import assert from 'node:assert/strict';
import { CITY_SESSION_KEY, createCitySession } from '../src/lib/city-session.mjs';

const cities = [1, 2, 3].map(id => ({ id, geonameId: id, key: String(id) }));
const first = () => 0;
function fixture(initial = null) {
  const values = new Map(initial === null ? [] : [[CITY_SESSION_KEY, initial]]);
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  return { values, storage, options: { getStorage: () => storage, random: first } };
}

test('each playable city is shown exactly once per cycle, before repeats are allowed', () => {
  const { options, values } = fixture();
  const session = createCitySession(options);
  assert.deepEqual(Array.from({ length: 3 }, () => session.next(cities).id), [1, 2, 3]);
  assert.deepEqual(JSON.parse(values.get(CITY_SESSION_KEY)), { version: 1, seenIds: [1, 2, 3], lastId: 3 });
  assert.equal(session.next(cities).id, 1);
  assert.deepEqual(JSON.parse(values.get(CITY_SESSION_KEY)).seenIds, [1]);
  assert.deepEqual([session.next(cities).id, session.next(cities).id], [2, 3]);
});

test('recreating the picker after refresh preserves shown cities and the last city', () => {
  const { options } = fixture();
  assert.equal(createCitySession(options).next(cities).id, 1);
  assert.equal(createCitySession(options).next(cities).id, 2);
  assert.equal(createCitySession(options).next(cities).id, 3);
  assert.equal(createCitySession(options).next(cities).id, 1);
});

test('the new cycle does not start with the last city, even across refresh', () => {
  const { options } = fixture(JSON.stringify({ version: 1, seenIds: [1, 2, 3], lastId: 1 }));
  assert.equal(createCitySession(options).next(cities).id, 2);
});

test('fresh tab storage starts an independent city history', () => {
  const tabOne = fixture();
  const tabTwo = fixture();
  createCitySession(tabOne.options).next(cities);
  assert.equal(createCitySession(tabOne.options).next(cities).id, 2);
  assert.equal(createCitySession(tabTwo.options).next(cities).id, 1);
});

test('malformed or unsupported saved history is ignored and repaired', () => {
  for (const initial of ['bad json', '{}', 'null', '{"version":2,"seenIds":[1],"lastId":1}',
    '{"version":1,"seenIds":["1"],"lastId":1}', '{"version":1,"seenIds":[1],"lastId":0}']) {
    const { options, values } = fixture(initial);
    assert.equal(createCitySession(options).next(cities).id, 1);
    assert.deepEqual(JSON.parse(values.get(CITY_SESSION_KEY)), { version: 1, seenIds: [1], lastId: 1 });
  }
});

test('unavailable storage or failed reads/writes preserve nonrepeating in-memory play', () => {
  for (const getStorage of [() => { throw new Error('Denied'); }, () => undefined,
    () => ({ getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Full'); } }),
    () => ({ getItem() { return null; }, setItem() { throw new Error('Full'); } })]) {
    const session = createCitySession({ getStorage, random: first });
    assert.deepEqual(Array.from({ length: 3 }, () => session.next(cities).id), [1, 2, 3]);
  }
});

test('removed IDs are pruned, added cities are playable before resetting the cycle', () => {
  const { options, values } = fixture(JSON.stringify({ version: 1, seenIds: [1, 2, 99, 2], lastId: 2 }));
  assert.equal(createCitySession(options).next(cities).id, 3);
  assert.deepEqual(JSON.parse(values.get(CITY_SESSION_KEY)).seenIds, [1, 2, 3]);
});

test('single-city and empty pools are safe; history updates only on actual selections', () => {
  const { options, values } = fixture();
  const session = createCitySession(options);
  assert.equal(session.next([]), null);
  assert.equal(values.size, 0);
  assert.equal(session.next([cities[0]]).id, 1);
  assert.equal(session.next([cities[0]]).id, 1);
  assert.throws(() => session.next([{ geonameId: 0 }]), /valid GeoNames/);
  values.set('unrelated', 'preserved');
  session.next(cities);
  assert.equal(values.get('unrelated'), 'preserved');
});
