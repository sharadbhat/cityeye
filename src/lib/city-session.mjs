import { chooseCity } from './game.mjs';

export const CITY_SESSION_KEY = 'cityeye:played-cities:v1';

const validId = id => Number.isSafeInteger(id) && id > 0;

/** Remember shown cities for this tab, with an in-memory fallback if storage is blocked. */
export function createCitySession({ getStorage = () => globalThis.sessionStorage, random = Math.random } = {}) {
  let storage;
  let seen = new Set();
  let lastId = null;
  try {
    storage = getStorage();
    const saved = JSON.parse(storage?.getItem(CITY_SESSION_KEY) ?? 'null');
    if (saved?.version === 1 && Array.isArray(saved.seenIds) && saved.seenIds.every(validId)
      && (saved.lastId === null || validId(saved.lastId))) {
      seen = new Set(saved.seenIds);
      lastId = saved.lastId;
    }
  } catch {
    // Invalid data or unavailable storage must not prevent playing.
  }

  return {
    next(cities) {
      if (!Array.isArray(cities) || !cities.length) return null;
      const ids = new Set(cities.map(city => city.geonameId));
      if (![...ids].every(validId)) throw new TypeError('Playable cities must have valid GeoNames IDs.');
      seen = new Set([...seen].filter(id => ids.has(id)));
      let unseen = cities.filter(city => !seen.has(city.geonameId));
      if (!unseen.length) {
        seen.clear();
        unseen = cities;
      }
      const city = chooseCity(unseen, lastId, random);
      lastId = city.geonameId;
      seen.add(lastId);
      try {
        storage?.setItem(CITY_SESSION_KEY, JSON.stringify({ version: 1, seenIds: [...seen], lastId }));
      } catch {
        // Keep the in-memory history when browser storage is unavailable or full.
      }
      return city;
    },
  };
}
