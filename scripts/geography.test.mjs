import test from 'node:test';
import assert from 'node:assert/strict';
import { locationHint, formatDistanceKm } from '../src/lib/geography.mjs';

const point = (latitude, longitude) => ({ latitude, longitude });
const close = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('one degree on the equator is approximately 111.195 km, not a planar degree count', () => {
  close(locationHint(point(0, 0), point(0, 1)).distanceKm, 111.195);
  close(locationHint(point(0, 1), point(0, 0)).distanceKm, 111.195);
});

test('distance is symmetric, but direction points from the guess toward the answer', () => {
  const east = locationHint(point(0, 0), point(0, 1));
  const west = locationHint(point(0, 1), point(0, 0));
  assert.equal(east.direction, 'E');
  assert.equal(west.direction, 'W');
  close(east.bearingDegrees, 90);
  close(west.bearingDegrees, 270);
  close(east.distanceKm, west.distanceKm);
});

test('all eight compass directions match initial bearings around the origin', () => {
  const destinations = [[1, 0, 'N'], [1, 1, 'NE'], [0, 1, 'E'], [-1, 1, 'SE'], [-1, 0, 'S'], [-1, -1, 'SW'], [0, -1, 'W'], [1, -1, 'NW']];
  for (const [latitude, longitude, direction] of destinations) {
    const hint = locationHint(point(0, 0), point(latitude, longitude));
    assert.equal(hint.direction, direction);
    assert.ok(hint.bearingDegrees >= 0 && hint.bearingDegrees < 360);
  }
});

test('international date-line crossings take the short way', () => {
  const hint = locationHint(point(0, 179), point(0, -179));
  close(hint.distanceKm, 222.389853);
  assert.equal(hint.direction, 'E');
  assert.equal(locationHint(point(0, -179), point(0, 179)).direction, 'W');
});

test('longitude degrees become shorter at high latitudes', () => {
  const hint = locationHint(point(60, 0), point(60, 1));
  close(hint.distanceKm, 55.597, 0.01);
  assert.equal(hint.direction, 'E');
});

test('coincident and antipodal locations never invent a compass direction', () => {
  const same = locationHint(point(40, -112), point(40, -112));
  assert.equal(same.distanceKm, 0);
  assert.equal(same.direction, null);
  assert.equal(same.bearingDegrees, null);
  const antipodes = locationHint(point(0, 0), point(0, 180));
  close(antipodes.distanceKm, Math.PI * 6371);
  assert.equal(antipodes.direction, null);
  assert.ok(Number.isFinite(locationHint(point(10, 0), point(-10.000001, 179.999999)).distanceKm));
});

test('invalid or missing coordinates suppress the clue without producing NaN', () => {
  for (const invalid of [null, {}, point(NaN, 1), point(Infinity, 1), point(91, 1), point(0, 181), point('0', 0)]) {
    assert.equal(locationHint(invalid, point(0, 0)), null);
    assert.equal(locationHint(point(0, 0), invalid), null);
  }
});

test('distance formatting rounds kilometers and handles nearby cities', () => {
  assert.equal(formatDistanceKm(1240.6), '≈ 1,241 km');
  assert.equal(formatDistanceKm(0), '< 1 km');
  assert.equal(formatDistanceKm(0.99), '< 1 km');
  assert.equal(formatDistanceKm(1), '≈ 1 km');
  assert.equal(formatDistanceKm(NaN), null);
  assert.equal(formatDistanceKm(-1), null);
});
