import { WORLD_CITIES } from './world-cities.mjs';
import { normalizeCityQuery } from '../src/lib/city-search.mjs';

/** Verified identities for configured SVG maps; names alone are never answer keys. */
export const PLAYABLE_GEO_NAMES = {
  slc: { id: 5780993, name: 'Salt Lake City', region: 'Utah' },
  nyc: { id: 5128581, name: 'New York City', region: 'New York' },
  sf: { id: 5391959, name: 'San Francisco', region: 'California' },
  seattle: { id: 5809844, name: 'Seattle', region: 'Washington' },
  portland: { id: 5746545, name: 'Portland', region: 'Oregon' },
  dallas: { id: 4684888, name: 'Dallas', region: 'Texas' },
  austin: { id: 4671654, name: 'Austin', region: 'Texas' },
  houston: { id: 4699066, name: 'Houston', region: 'Texas' },
  provo: { id: 5780026, name: 'Provo', region: 'Utah' },
  nashville: { id: 4644585, name: 'Nashville', region: 'Tennessee' },
  miami: { id: 4164138, name: 'Miami', region: 'Florida' },
  la: { id: 5368361, name: 'Los Angeles', region: 'California' },
  denver: { id: 5419384, name: 'Denver', region: 'Colorado' },
  boston: { id: 4930956, name: 'Boston', region: 'Massachusetts' },
  philly: { id: 4560349, name: 'Philadelphia', region: 'Pennsylvania' },
  chicago: { id: 4887398, name: 'Chicago', region: 'Illinois' },
  ...Object.fromEntries(Object.entries(WORLD_CITIES).map(([key, city]) => [key, city.geoNames])),
};

export function loadPlayableCities(catalog, cities) {
  const records = catalog.cities ?? catalog;
  if (!Array.isArray(records)) throw new TypeError('Catalog must contain a cities array.');
  const byId = new Map(records.map((city) => [city.id, city]));
  return Object.entries(cities).map(([key, map]) => {
    const expected = PLAYABLE_GEO_NAMES[key];
    if (!expected) throw new Error(`Map ${key} has no verified GeoNames identity.`);
    const record = byId.get(expected.id);
    if (!record || record.countryCode !== (expected.countryCode ?? 'US') || record.region !== expected.region
      || normalizeCityQuery(record.name) !== normalizeCityQuery(expected.name)
      || distanceKilometers(record, map) > 15) throw new Error(`Map ${key} failed its GeoNames ID/name/region/coordinate verification.`);
    return {
      key, id: record.id, geonameId: record.id, label: map.label,
      name: expected.name, region: record.region, country: record.country, countryCode: record.countryCode,
      latitude: record.latitude, longitude: record.longitude,
      svgUrl: `/maps/${record.id}.svg`,
    };
  });
}

function distanceKilometers(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const deltaLatitude = radians(first.latitude - second.latitude);
  const deltaLongitude = radians(first.longitude - second.longitude);
  const amount = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(amount), Math.sqrt(Math.max(0, 1 - amount)));
}
