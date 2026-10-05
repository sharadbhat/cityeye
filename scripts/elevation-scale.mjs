/** Eight relative bands preserve local relief without tinting absolute altitude. */
export function elevationScale(values, bandCount = 8) {
  if (!Number.isInteger(bandCount) || bandCount < 2 || bandCount > 32) {
    throw new Error('Elevation band count must be an integer from 2 to 32.');
  }
  const samples = values.flat().filter(Number.isFinite);
  if (!samples.length) return { minimum: null, maximum: null, bands: [], contours: [] };
  const minimum = Math.min(...samples);
  const maximum = Math.max(...samples);
  if (maximum === minimum) {
    return { minimum, maximum, bands: [{ lower: minimum, upper: maximum, amount: 0 }], contours: [] };
  }
  const step = (maximum - minimum) / bandCount;
  const boundaries = Array.from({ length: bandCount + 1 }, (_, index) =>
    index === bandCount ? maximum : minimum + step * index);
  return {
    minimum, maximum,
    bands: boundaries.slice(0, -1).map((lower, index) => ({
      lower, upper: boundaries[index + 1], amount: index / (bandCount - 1),
    })),
    contours: boundaries.slice(1, -1),
  };
}

// HGT voids include signed and unsigned sentinel values. This game uses
// terrestrial topography, so impossible land elevations must not set its range.
export function validElevation(value) {
  return Number.isFinite(value) && value >= -11000 && value <= 9000 ? value : NaN;
}

// Coastal DEM tiles also contain offshore depths. Water has its own map layer;
// use sea level for those samples so bathymetry cannot make all land look high.
export function topographicElevation(value) {
  return Math.max(0, validElevation(value));
}
