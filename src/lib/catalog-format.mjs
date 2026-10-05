export function packCatalog(catalog) {
  const regions = [...new Set(catalog.cities.map(city => city.region))];
  const countries = [...new Map(catalog.cities.map(city => [city.countryCode, city.country])).entries()];
  const regionIds = new Map(regions.map((name, index) => [name, index]));
  const countryIds = new Map(countries.map(([code], index) => [code, index]));
  return {
    version: 1, source: catalog.source, regions, countries,
    // id, name, region index, country index, latitude, longitude, population, aliases
    cities: catalog.cities.map(city => [city.id, city.name, regionIds.get(city.region), countryIds.get(city.countryCode),
      city.latitude, city.longitude, city.population, city.aliases ?? []]),
  };
}

export function unpackCatalog(packed) {
  if (packed?.version !== 1 || !Array.isArray(packed.cities) || !Array.isArray(packed.regions) || !Array.isArray(packed.countries)) {
    throw new Error('Unsupported static city catalog.');
  }
  return {
    source: packed.source,
    cities: packed.cities.map(row => {
      const [id, name, regionIndex, countryIndex, latitude, longitude, population, aliases] = row;
      const country = packed.countries[countryIndex];
      if (!Number.isSafeInteger(id) || id <= 0 || typeof name !== 'string' || !country
        || typeof packed.regions[regionIndex] !== 'string' || !Array.isArray(aliases)
        || !Number.isFinite(latitude) || Math.abs(latitude) > 90
        || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Invalid static city record.');
      return { id, name, region: packed.regions[regionIndex], countryCode: country[0], country: country[1], latitude, longitude, population, aliases };
    }),
  };
}
