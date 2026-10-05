import assert from 'node:assert/strict';
import { test } from 'node:test';
import { joinRoadSegments } from './road-paths.mjs';

const point = (x, y = 0) => ({ lon: x, lat: y });
const road = (points, highway = 'residential') => ({ tags: { highway }, geometry: points });
const edges = (groups) => groups.flatMap(({ lines }) => lines).reduce((total, line) => total + line.length - 1, 0);

test('joins a chain including reversed segments without losing geometry', () => {
  const groups = joinRoadSegments([road([point(0), point(1)]), road([point(2), point(1)]), road([point(2), point(3)])]);
  assert.deepEqual(groups[0].lines, [[point(0), point(1), point(2), point(3)]]);
  assert.equal(edges(groups), 3);
});

test('preserves all branches at a junction', () => {
  const groups = joinRoadSegments([road([point(0), point(1)]), road([point(1), point(2)]), road([point(1), point(1, 1)])]);
  assert.equal(groups[0].lines.length, 3);
  assert.equal(edges(groups), 3);
});

test('preserves a closed loop and separates different road styles', () => {
  const groups = joinRoadSegments([road([point(0), point(1)]), road([point(1), point(1, 1)]), road([point(1, 1), point(0)]), road([point(1), point(2)], 'motorway')]);
  assert.equal(groups[0].lines.length, 1);
  assert.deepEqual(groups[0].lines[0][0], groups[0].lines[0].at(-1));
  assert.equal(groups[1].kind, 'motorway');
  assert.equal(edges(groups), 4);
});

test('does not bridge disconnected roads or turn a short open line into a loop', () => {
  const groups = joinRoadSegments([road([point(0), point(.00001)]), road([point(2), point(3)])]);
  assert.equal(groups[0].lines.length, 2);
  assert.deepEqual(groups[0].lines[0], [point(0), point(.00001)]);
  assert.equal(edges(groups), 2);
});
