import { unpackCatalog } from './catalog-format.mjs';
import { createSearchIndex } from './city-search.mjs';
import { continentForCity } from './city-clues.mjs';

export function createStaticCityDirectory({ fetcher = (...args) => fetch(...args), baseUrl = './' } = {}) {
  let pending;
  const asset = path => `${baseUrl}${path}`;
  async function readJson(path) {
    const response = await fetcher(asset(path));
    if (!response.ok) throw new Error(`City data download failed (${response.status}).`);
    return response.json();
  }
  const load = () => pending ??= (async () => {
    const manifest = await readJson('data/game-data.json');
    if (manifest?.version !== 1 || !/^cities-[a-f0-9]{12}\.json$/.test(manifest.catalogFile)
      || !Array.isArray(manifest.playableIds) || !manifest.playableIds.length
      || manifest.playableIds.some(id => !Number.isSafeInteger(id) || id <= 0)
      || new Set(manifest.playableIds).size !== manifest.playableIds.length) throw new Error('Invalid playable city data.');
    const index = createSearchIndex(unpackCatalog(await readJson(`data/${manifest.catalogFile}`)));
    const playable = manifest.playableIds.map(id => {
      const record = index.get(id);
      if (!record) throw new Error(`Map ${id} is missing from the city directory.`);
      continentForCity(record);
      return { ...record, key: String(id), geonameId: id, label: record.name, svgUrl: asset(`maps/${id}.svg`) };
    });
    return { index, playable };
  })().catch(error => { pending = undefined; throw error; });
  return {
    loadPlayableCities: async () => (await load()).playable,
    search: async (query, limit = 8) => (await load()).index.search(query, limit),
  };
}

export const cityDirectory = createStaticCityDirectory({ baseUrl: import.meta.env?.BASE_URL ?? './' });
