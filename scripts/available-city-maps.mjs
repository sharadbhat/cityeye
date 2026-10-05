import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CITIES } from './cities.mjs';
import { validateCitySvg } from './validate-city-maps.mjs';

// Configuring a city must not make an absent/invalid SVG playable.
export async function availableCityMaps({ mapDirectory, definitions = CITIES, warn = console.warn }) {
  const available = {};
  for (const [id, city] of Object.entries(definitions)) {
    let svg;
    try { svg = await readFile(join(mapDirectory, `${id}-city-layered.svg`), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const validation = validateCitySvg(svg, id, city);
    if (validation.errors.length) {
      warn(`Not publishing ${id}: ${validation.errors.join(' ')}`);
      continue;
    }
    available[id] = city;
  }
  return available;
}
