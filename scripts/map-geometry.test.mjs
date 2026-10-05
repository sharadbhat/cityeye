import test from 'node:test';
import assert from 'node:assert/strict';
import { geometryParts, netAreaSquareMeters, polygonAreaSquareMeters } from './map-geometry.mjs';

const rectangle = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const polygon = (...rings) => ({ type: 'Polygon', coordinates: rings });
const bounds = [-74.1, 40.6, -73.8, 40.9];
const coordinates = (ring) => ring.map(({ lon, lat }) => [lon, lat]);

test('an ocean polygon enclosing the viewport is clipped even with no vertex inside', () => {
  const [part] = geometryParts(polygon(rectangle(-180, -80, 180, 80)), bounds);
  assert.equal(part.isArea, true);
  assert.deepEqual(part.holes, []);
  assert.equal(part.geometry.length, 5);
  assert.deepEqual(new Set(coordinates(part.geometry).map(String)), new Set(rectangle(...bounds).map(String)));
});

test('polygon holes are retained as separate closed rings', () => {
  const hole = rectangle(-74.05, 40.65, -73.95, 40.75);
  const [part] = geometryParts(polygon(rectangle(-74.2, 40.5, -73.7, 41), hole), bounds);
  assert.deepEqual(coordinates(part.holes[0]), hole);
  assert.deepEqual(part.geometry[0], part.geometry.at(-1));
  assert.deepEqual(part.holes[0][0], part.holes[0].at(-1));
});

test('multipolygon components stay separate and outside pieces are dropped', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [
    [rectangle(-74.2, 40.55, -74.0, 40.7)],
    [rectangle(-73.9, 40.8, -73.7, 41)],
    [rectangle(-73.5, 41, -73.4, 41.1)],
  ] };
  const parts = geometryParts(geometry, bounds);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].geometry.reduce((max, point) => Math.max(max, point.lon), -Infinity), -74);
  assert.equal(parts[1].geometry.reduce((min, point) => Math.min(min, point.lon), Infinity), -73.9);
});

test('a polygon wholly outside the viewport is removed', () => {
  assert.deepEqual(geometryParts(polygon(rectangle(-73.5, 41, -73.4, 41.1)), bounds), []);
});

test('a hole crossing an edge is clipped and a hole outside is removed', () => {
  const [part] = geometryParts(polygon(
    rectangle(-74.2, 40.5, -73.7, 41),
    rectangle(-74.2, 40.7, -74.0, 40.8),
    rectangle(-73.75, 40.65, -73.72, 40.7),
  ), bounds);
  assert.equal(part.holes.length, 1);
  assert.ok(part.holes[0].every((point) => point.lon >= bounds[0] && point.lon <= bounds[2]));
  assert.deepEqual(new Set(coordinates(part.holes[0]).map(String)), new Set(rectangle(-74.1, 40.7, -74.0, 40.8).map(String)));
});

test('net area subtracts holes and stays precise for small far-from-origin shapes', () => {
  const [part] = geometryParts(polygon(
    rectangle(-111.891, 40.7608, -111.8909, 40.7609),
    rectangle(-111.89098, 40.76082, -111.89092, 40.76088),
  ));
  const expectedOuter = 0.0001 ** 2 * 111_320 * Math.cos(40.76084 * Math.PI / 180) * 110_574;
  assert.ok(Math.abs(polygonAreaSquareMeters(part.geometry) - expectedOuter) / expectedOuter < 1e-8);
  assert.ok(Math.abs(netAreaSquareMeters(part) / polygonAreaSquareMeters(part.geometry) - 0.64) < 1e-6);
  assert.equal(polygonAreaSquareMeters([...part.geometry].reverse()), polygonAreaSquareMeters(part.geometry));
});

test('unclosed polygons are closed and legacy coordinate strings are normalized', () => {
  const [part] = geometryParts(polygon(['0 0', '1 0', '1 1', '0 1']), [0, 0, 2, 2]);
  assert.equal(part.geometry.length, 5);
  const lines = geometryParts({ type: 'MultiLineString', coordinates: [['-75 40', '-73 42'], [[0, 1], [2, 3]]] }, bounds);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].isArea, false);
  assert.deepEqual(lines[0].geometry[0], { lon: -75, lat: 40 });
});

test('non-convex clipped pieces retain their combined area across boundary bridges', () => {
  // An upside-down U connected above the viewport becomes two disjoint columns.
  const [part] = geometryParts(polygon([[0, 0], [1, 0], [1, 3], [3, 3], [3, 0], [4, 0], [4, 4], [0, 4], [0, 0]]), [0, 0, 4, 2]);
  const expected = polygonAreaSquareMeters(geometryParts(polygon(rectangle(0, 0, 1, 2)))[0].geometry)
    + polygonAreaSquareMeters(geometryParts(polygon(rectangle(3, 0, 4, 2)))[0].geometry);
  // Local latitude scaling can differ slightly because clipped bridge vertices
  // weight the ring mean; the geometric degree-area remains four square degrees.
  assert.ok(Math.abs(polygonAreaSquareMeters(part.geometry) / expected - 1) < 0.0002);
});
