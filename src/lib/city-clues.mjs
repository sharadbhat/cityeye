// Curated for the current playable pool. Do not infer continents from longitude
// or assign an entire transcontinental country to one continent.
const COUNTRY_CONTINENTS = Object.freeze(Object.fromEntries([
  ['North America', ['US', 'CA', 'MX', 'CU', 'PA', 'CR', 'SV', 'GT', 'HN', 'NI', 'PR', 'DO', 'JM', 'HT', 'BS']],
  ['South America', ['BR', 'AR', 'CL', 'PE', 'CO', 'EC', 'UY', 'BO', 'PY', 'VE', 'SR']],
  ['Europe', ['GB', 'FR', 'ES', 'NL', 'PT', 'IT', 'SE', 'DE', 'AT', 'CZ', 'HU', 'PL', 'DK', 'NO', 'FI', 'GR', 'CH', 'IE', 'BE', 'RO', 'BG', 'RS', 'HR', 'SI', 'SK', 'BA', 'AL', 'MK', 'LT', 'LV', 'EE', 'UA', 'IS']],
  ['Africa', ['EG', 'ZA', 'KE', 'NG', 'MA', 'ET', 'GH', 'SN', 'TN', 'TZ', 'UG', 'RW', 'ZM', 'ZW', 'MZ', 'AO', 'BW', 'NA', 'DZ', 'CI', 'CM', 'CD', 'MG', 'MU', 'LY', 'SD']],
  ['Asia', ['JP', 'KR', 'CN', 'HK', 'SG', 'TH', 'IN', 'AE', 'NP', 'TW', 'PH', 'ID', 'MY', 'VN', 'PK', 'BD', 'SA', 'QA', 'LK', 'KH', 'LA', 'MM', 'IL', 'JO', 'LB', 'OM', 'BH', 'UZ', 'AM', 'MN']],
  ['Oceania', ['AU', 'NZ', 'PG']],
].flatMap(([continent, codes]) => codes.map((code) => [code, continent]))));

// Istanbul spans the Bosphorus; Moscow is in European Russia.
// Sources: https://goturkiye.com/istanbul/bosphorus
// Oceania is our game grouping for Australia and New Zealand:
// https://education.nationalgeographic.org/resource/oceania-physical-geography/
// Caucasus grouping follows UN M49 (Western Asia); cities in Turkey, Russia,
// and Kazakhstan stay explicit so a country's other cities aren't inferred.
// https://unstats.un.org/unsd/methodology/m49/
const CITY_CONTINENTS = Object.freeze({
  745044: 'Europe / Asia', 524901: 'Europe', 498817: 'Europe', // Istanbul, Moscow, Saint Petersburg
  323786: 'Asia', 311046: 'Asia', 323777: 'Asia', // Ankara, İzmir, Antalya
  1526384: 'Asia', 1526273: 'Asia', // Almaty, Astana
  611717: 'Asia', 587084: 'Asia', // Tbilisi, Baku
});

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
