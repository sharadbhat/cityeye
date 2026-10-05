import assert from 'node:assert/strict';
import test from 'node:test';
import { elevationScale, validElevation, topographicElevation } from './elevation-scale.mjs';

test('low relief at high absolute altitude starts white and uses all eight bands', () => {
  const scale = elevationScale([[220, 230], [222, 229]]);
  assert.equal(scale.bands.length, 8);
  assert.equal(scale.bands[0].lower, 220);
  assert.equal(scale.bands[0].amount, 0);
  assert.equal(scale.bands.at(-1).upper, 230);
  assert.equal(scale.bands.at(-1).amount, 1);
  assert.equal(scale.contours.length, 7);
  scale.bands.forEach((band, index) => {
    assert.ok(band.lower < band.upper);
    if (index) {
      assert.equal(scale.bands[index - 1].upper, band.lower);
      assert.ok(scale.bands[index - 1].amount < band.amount);
    }
  });
});

test('color normalization is independent of the city absolute altitude', () => {
  assert.deepEqual(elevationScale([0, 200]).bands.map(({ amount }) => amount),
    elevationScale([1500, 1700]).bands.map(({ amount }) => amount));
});

test('constant elevation creates one white band and no contours', () => {
  assert.deepEqual(elevationScale([1700, 1700]).bands, [{ lower: 1700, upper: 1700, amount: 0 }]);
  assert.deepEqual(elevationScale([1700]).contours, []);
});

test('missing data is ignored and an empty grid has no bands', () => {
  assert.deepEqual(elevationScale([NaN, undefined, Infinity]).bands, []);
  assert.equal(elevationScale([[NaN, 10], [20, NaN]]).minimum, 10);
  assert.equal(elevationScale([[NaN, 10], [20, NaN]]).maximum, 20);
});

test('void/sentinel/impossible terrestrial elevations cannot inflate relief', () => {
  for (const value of [-32768, 32767, -11001, 9001, NaN, Infinity]) assert.ok(Number.isNaN(validElevation(value)));
  for (const value of [-86, 0, 220, 4400]) assert.equal(validElevation(value), value);
  assert.equal(elevationScale([2, 45, validElevation(32767)]).maximum, 45);
});

test('offshore depths use sea level instead of shifting all coastal land into dark bands', () => {
  const scale = elevationScale([-618, -300, 0, 4, 48].map(topographicElevation));
  assert.equal(scale.minimum, 0);
  assert.equal(scale.maximum, 48);
  assert.equal(scale.bands[0].lower, 0);
  assert.equal(scale.bands[0].upper, 6);
  assert.equal(scale.bands[0].amount, 0);
  assert.ok(Number.isNaN(topographicElevation(32767)));
});
