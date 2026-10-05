/**
 * Position SVG content rendered using targetCamera as it appeared in sourceCamera.
 * Apply translate(translateXPercent%, translateYPercent%) scale(scaleX, scaleY)
 * to the viewport-sized wrapper, using transform-origin: 0 0.
 */
export function cameraTransform(sourceCamera, targetCamera) {
  validateCamera(sourceCamera, 'sourceCamera');
  validateCamera(targetCamera, 'targetCamera');
  const [sourceX, sourceY, sourceWidth, sourceHeight] = sourceCamera;
  const [targetX, targetY, targetWidth, targetHeight] = targetCamera;
  return {
    scaleX: targetWidth / sourceWidth,
    scaleY: targetHeight / sourceHeight,
    translateXPercent: (targetX - sourceX) / sourceWidth * 100,
    translateYPercent: (targetY - sourceY) / sourceHeight * 100,
  };
}

function validateCamera(camera, name) {
  if (!Array.isArray(camera) || camera.length !== 4 || !camera.every(Number.isFinite)) {
    throw new TypeError(`${name} must contain four finite numeric bounds [x, y, width, height].`);
  }
  if (camera[2] <= 0 || camera[3] <= 0) {
    throw new RangeError(`${name} width and height must be positive.`);
  }
}
