export const MIN_WATER_AREA_SQUARE_METERS = 100_000;

const allowedTypes = new Set(['river', 'lake', 'reservoir', 'pond', 'water', 'sea', 'ocean']);
const excludedTypes = new Set([
  'canal', 'ditch', 'drain', 'drainage', 'basin', 'wastewater', 'sewage',
  'retention', 'detention', 'infiltration', 'tailings', 'water_hazard', 'fairway',
]);

// Overture normalizes most water types, but some industrial/artificial features
// remain generic water or reservoirs. Check their original OSM tags too.
export function isMajorWaterFeature(properties, geometryType) {
  if (!allowedTypes.has(properties.subtype)) return false;
  const tags = new Map(properties.source_tags ?? []);
  const classifications = [
    properties.class, tags.get('water'), tags.get('waterway'), tags.get('basin'),
    tags.get('reservoir_type'), tags.get('content'), tags.get('golf'),
  ];
  if (classifications.some((value) => excludedTypes.has(String(value ?? '').toLowerCase()))) return false;
  if (String(tags.get('nhd-shp:FTYPE') ?? '').toLowerCase() === 'canalditch') return false;
  const name = properties.names?.primary ?? '';
  if (/\b(?:canal|ditch|drain|drainage|tailings?|wastewater|sewage|retention|detention)\b/i.test(name)) return false;
  if (geometryType === 'LineString' || geometryType === 'MultiLineString') {
    // Some source creeks are normalized as rivers. Dry channels and narrow
    // tributaries add clutter even though they pass the river classification.
    if (properties.is_intermittent === true || /^yes$/i.test(String(tags.get('intermittent') ?? '').trim())) return false;
    if (/\b(?:creek|branch|brook|stream)\b/i.test(name)
      && Math.max(widthMeters(properties.width), widthMeters(tags.get('width'))) < 20) return false;
  }
  return true;
}

function widthMeters(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : 0;
  if (typeof value !== 'string') return 0;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|feet|foot|')?$/i);
  if (!match) return 0;
  const width = Number(match[1]);
  return /^(?:ft|feet|foot|')$/i.test(match[2] ?? '') ? width * 0.3048 : width;
}
