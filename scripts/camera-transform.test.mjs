import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraTransform } from './camera-transform.mjs';

const stages = [
  [366.67, 366.67, 66.67, 66.67],
  [313.33, 313.33, 173.33, 173.33],
  [200, 200, 400, 400],
  [0, 0, 800, 800],
  [0, 0, 800, 800],
];

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= 1e-10, `${actual} differs from ${expected}`);
}

function corners([x, y, width, height]) {
  return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
}

function assertProjectionEqual(source, target, points) {
  const transform = cameraTransform(source, target);
  for (const [worldX, worldY] of points) {
    const targetX = (worldX - target[0]) / target[2];
    const targetY = (worldY - target[1]) / target[3];
    const transformedX = targetX * transform.scaleX + transform.translateXPercent / 100;
    const transformedY = targetY * transform.scaleY + transform.translateYPercent / 100;
    close(transformedX, (worldX - source[0]) / source[2]);
    close(transformedY, (worldY - source[1]) / source[3]);
  }
}

test('all 25 stage camera transitions preserve world corner locations at animation start', () => {
  for (const source of stages) {
    for (const target of stages) {
      assertProjectionEqual(source, target, [...corners(source), ...corners(target)]);
    }
  }
});

test('stage 1 to stage 4 starts with the target content enlarged around its center', () => {
  const transform = cameraTransform(stages[0], stages[3]);
  close(transform.scaleX, 800 / 66.67);
  close(transform.scaleY, 800 / 66.67);
  close(transform.translateXPercent, -366.67 / 66.67 * 100);
  close(transform.translateYPercent, -366.67 / 66.67 * 100);
});

test('non-square viewports use independent horizontal and vertical scaling', () => {
  const source = [10, 20, 100, 50];
  const target = [-20, 5, 200, 150];
  assert.deepEqual(cameraTransform(source, target), {
    scaleX: 2, scaleY: 3, translateXPercent: -30, translateYPercent: -30,
  });
  assertProjectionEqual(source, target, [...corners(source), ...corners(target), [44, 31]]);
});

test('pan-only and identical camera transitions do not scale content', () => {
  assert.deepEqual(cameraTransform([100, 200, 400, 200], [200, 150, 400, 200]), {
    scaleX: 1, scaleY: 1, translateXPercent: 25, translateYPercent: -25,
  });
  assert.deepEqual(cameraTransform([100, 200, 400, 200], [100, 200, 400, 200]), {
    scaleX: 1, scaleY: 1, translateXPercent: 0, translateYPercent: 0,
  });
});

test('zero and negative dimensions are rejected for either camera', () => {
  for (const invalid of [[0, 0, 0, 1], [0, 0, 1, 0], [0, 0, -1, 1], [0, 0, 1, -1]]) {
    assert.throws(() => cameraTransform(invalid, stages[0]), RangeError);
    assert.throws(() => cameraTransform(stages[0], invalid), RangeError);
  }
});

test('missing, nonnumeric, and non-finite camera bounds are rejected', () => {
  for (const invalid of [null, {}, [0, 0, 1], [0, 0, 1, 1, 1], ['0', 0, 1, 1], [NaN, 0, 1, 1], [0, Infinity, 1, 1], [0, 0, 1, -Infinity]]) {
    assert.throws(() => cameraTransform(invalid, stages[0]), TypeError);
    assert.throws(() => cameraTransform(stages[0], invalid), TypeError);
  }
});
