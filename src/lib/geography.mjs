const EARTH_RADIUS_KM = 6371;
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const DIRECTION_NAMES = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
const radians = (degrees) => degrees * Math.PI / 180;
const distanceFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function validLocation(location) {
  return Number.isFinite(location?.latitude) && Math.abs(location.latitude) <= 90
    && Number.isFinite(location?.longitude) && Math.abs(location.longitude) <= 180;
}

/** Great-circle distance and initial bearing FROM the guess TOWARD the answer. */
export function locationHint(from, to) {
  if (!validLocation(from) || !validLocation(to)) return null;
  const latitude1 = radians(from.latitude);
  const latitude2 = radians(to.latitude);
  const deltaLatitude = latitude2 - latitude1;
  const deltaLongitude = radians(to.longitude - from.longitude);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;
  const a = Math.max(0, Math.min(1, haversine));
  const distanceKm = EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const east = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const north = Math.cos(latitude1) * Math.sin(latitude2)
    - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);
  // Coincident and exactly antipodal points have no unique initial direction.
  if (Math.hypot(east, north) < 1e-12) {
    return { distanceKm, bearingDegrees: null, direction: null, directionName: null };
  }
  const bearingDegrees = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  const index = Math.round(bearingDegrees / 45) % 8;
  return { distanceKm, bearingDegrees, direction: DIRECTIONS[index], directionName: DIRECTION_NAMES[index] };
}

export function formatDistanceKm(distanceKm) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;
  return distanceKm < 1 ? '< 1 km' : `≈ ${distanceFormat.format(distanceKm)} km`;
}
