// Curated for the current playable pool. Do not infer continents from longitude
// or assign an entire transcontinental country to one continent.
const COUNTRY_CONTINENTS = Object.freeze(Object.fromEntries([
  ['North America', ['US', 'CA', 'MX', 'CU', 'PA']],
  ['South America', ['BR', 'AR', 'CL', 'PE', 'CO']],
  ['Europe', ['GB', 'FR', 'ES', 'NL', 'PT', 'IT', 'SE', 'DE']],
  ['Africa', ['EG', 'ZA', 'KE', 'NG', 'MA']],
  ['Asia', ['JP', 'KR', 'CN', 'HK', 'SG', 'TH', 'IN', 'AE', 'NP']],
  ['Oceania', ['AU', 'NZ']],
].flatMap(([continent, codes]) => codes.map((code) => [code, continent]))));

// Istanbul spans the Bosphorus; Moscow is in European Russia.
// Sources: https://goturkiye.com/istanbul/bosphorus
// Oceania is our game grouping for Australia and New Zealand:
// https://education.nationalgeographic.org/resource/oceania-physical-geography/
const CITY_CONTINENTS = Object.freeze({ 745044: 'Europe / Asia', 524901: 'Europe' });

export function continentForCity(city) {
  const id = city?.geonameId ?? city?.id;
  if (Object.hasOwn(CITY_CONTINENTS, id)) return CITY_CONTINENTS[id];
  if (Object.hasOwn(COUNTRY_CONTINENTS, city?.countryCode)) return COUNTRY_CONTINENTS[city.countryCode];
  throw new Error(`No verified continent for city ${id ?? '(missing identity)'}.`);
}

export function geographyClue(city, stage) {
  if (!city || stage < 4) return null;
  if (stage === 4) return { label: 'Continent', value: continentForCity(city) };
  return { label: 'Country', value: city.country, continent: continentForCity(city) };
}
