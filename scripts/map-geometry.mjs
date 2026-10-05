// Keep complete polygon rings so SVG even-odd fills preserve islands and holes.
// Overture downloads filter feature bounding boxes, not the geometry itself.
const LATITUDE_METERS_PER_DEGREE = 110_574;
const LONGITUDE_METERS_PER_DEGREE = 111_320;

export function geometryParts(geometry, bounds) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const clipBounds = bounds ? validateBounds(bounds) : null;
  if (geometry.type === 'LineString' || geometry.type === 'MultiLineString') {
    const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
    return lines.map(normalizeRing).filter((line) => line.length >= 2)
      .map((line) => ({ geometry: line, holes: [], isArea: false }));
  }
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.flatMap((rings) => {
    if (!Array.isArray(rings) || !rings.length) return [];
    const outer = prepareRing(rings[0], clipBounds);
    if (!outer.length) return [];
    const holes = rings.slice(1).map((ring) => prepareRing(ring, clipBounds)).filter((ring) => ring.length);
    return [{ geometry: outer, holes, isArea: true }];
  });
}

function validateBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
    || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
    throw new Error('Geometry bounds must be [west, south, east, north] with positive spans.');
  }
  return bounds;
}

function normalizeRing(coordinates) {
  if (!Array.isArray(coordinates)) return [];
  const points = coordinates.map((coordinate) => {
    const values = Array.isArray(coordinate) ? coordinate
      : typeof coordinate === 'string' ? coordinate.trim().split(/\s+/) : [];
    return { lon: Number(values[0]), lat: Number(values[1]) };
  });
  // Reject malformed geometry rather than joining across its missing vertices.
  return points.every((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat)) ? points : [];
}

function prepareRing(coordinates, bounds) {
  let points = deduplicateRing(normalizeRing(coordinates));
  if (points.length < 3) return [];
  if (bounds) points = clipRing(points, bounds);
  points = deduplicateRing(points);
  if (points.length < 3 || polygonAreaSquareMeters(points) <= 1e-6) return [];
  return [...points, { ...points[0] }];
}

function samePoint(first, second) {
  return Math.abs(first.lon - second.lon) < 1e-12 && Math.abs(first.lat - second.lat) < 1e-12;
}

function deduplicateRing(points) {
  const result = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  if (result.length > 1 && samePoint(result[0], result.at(-1))) result.pop();
  return result;
}

// Sutherland-Hodgman clipping may join disconnected pieces along the boundary.
// Those zero-area bridges remain valid when rendered with SVG fill-rule=evenodd.
function clipRing(points, [west, south, east, north]) {
  const edges = [
    { inside: (point) => point.lon >= west, intersection: (first, second) => crossLongitude(first, second, west) },
    { inside: (point) => point.lon <= east, intersection: (first, second) => crossLongitude(first, second, east) },
    { inside: (point) => point.lat >= south, intersection: (first, second) => crossLatitude(first, second, south) },
    { inside: (point) => point.lat <= north, intersection: (first, second) => crossLatitude(first, second, north) },
  ];
  for (const edge of edges) {
    if (!points.length) break;
    const output = [];
    let first = points.at(-1);
    let firstInside = edge.inside(first);
    for (const second of points) {
      const secondInside = edge.inside(second);
      if (firstInside !== secondInside) output.push(edge.intersection(first, second));
      if (secondInside) output.push(second);
      first = second;
      firstInside = secondInside;
    }
    points = output;
  }
  return points;
}

function crossLongitude(first, second, longitude) {
  const ratio = (longitude - first.lon) / (second.lon - first.lon);
  return { lon: longitude, lat: first.lat + ratio * (second.lat - first.lat) };
}

function crossLatitude(first, second, latitude) {
  const ratio = (latitude - first.lat) / (second.lat - first.lat);
  return { lon: first.lon + ratio * (second.lon - first.lon), lat: latitude };
}

export function polygonAreaSquareMeters(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  const origin = points[0];
  const latitude = points.reduce((total, point) => total + point.lat, 0) / points.length;
  const longitudeScale = LONGITUDE_METERS_PER_DEGREE * Math.cos(latitude * Math.PI / 180);
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const first = points[index];
    const second = points[(index + 1) % points.length];
    const firstX = (first.lon - origin.lon) * longitudeScale;
    const firstY = (first.lat - origin.lat) * LATITUDE_METERS_PER_DEGREE;
    const secondX = (second.lon - origin.lon) * longitudeScale;
    const secondY = (second.lat - origin.lat) * LATITUDE_METERS_PER_DEGREE;
    doubledArea += firstX * secondY - secondX * firstY;
  }
  return Math.abs(doubledArea) / 2;
}

export function netAreaSquareMeters(element) {
  const outerArea = polygonAreaSquareMeters(element.geometry);
  const holesArea = (element.holes ?? []).reduce((total, ring) => total + polygonAreaSquareMeters(ring), 0);
  return Math.max(0, outerArea - holesArea);
}
