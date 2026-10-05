export function normalizeCityQuery(value) {
  return String(value ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replaceAll('ß', 'ss').replaceAll('æ', 'ae').replaceAll('œ', 'oe').replaceAll('ø', 'o').replaceAll('ł', 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Prefix buckets keep each search out of the complete worldwide array. */
export function createSearchIndex(catalog) {
  const records = catalog.cities ?? catalog;
  if (!Array.isArray(records)) throw new TypeError('Catalog must contain a cities array.');
  const unique = new Map();
  for (const city of records) {
    if (!Number.isSafeInteger(city.id) || city.id <= 0) throw new TypeError('Catalog city IDs must be positive GeoNames integers.');
    const previous = unique.get(city.id);
    if (!previous || previous.population < city.population) unique.set(city.id, city);
  }
  const items = [...unique.values()].map((city) => ({
    city,
    names: [...new Set([city.name, ...(city.aliases ?? [])].map(normalizeCityQuery).filter(Boolean))],
    context: normalizeCityQuery([city.region, city.country, city.countryCode].join(' ')),
  }));
  const buckets = new Map();
  items.forEach((item, index) => {
    const prefixes = new Set(item.names.flatMap((name) => [name, ...name.split(' ')]).flatMap((term) => [term.slice(0, 1), term.slice(0, 2), term.slice(0, 3)]));
    for (const prefix of prefixes) {
      if (!buckets.has(prefix)) buckets.set(prefix, []);
      buckets.get(prefix).push(index);
    }
  });
  const search = (query, limit = 8) => {
    const normalized = normalizeCityQuery(String(query ?? '').slice(0, 100));
    if (!normalized) return [];
    const requested = Number(limit);
    const maximum = Number.isFinite(requested) ? Math.max(1, Math.min(20, Math.floor(requested))) : 8;
    const firstToken = normalized.split(' ')[0];
    const candidates = buckets.get(firstToken.slice(0, Math.min(3, firstToken.length))) ?? [];
    const matches = [];
    for (const index of candidates) {
      const item = items[index];
      let rank = Infinity;
      for (const name of item.names) {
        if (name === normalized) rank = Math.min(rank, 0);
        else if (name.startsWith(normalized)) rank = Math.min(rank, 1);
        else if (name.split(' ').some((word) => word.startsWith(normalized))) rank = Math.min(rank, 2);
        else if (normalized.startsWith(`${name} `) && matchesContext(item.context, normalized.slice(name.length + 1))) rank = Math.min(rank, 1);
        else if (`${name} ${item.context}`.startsWith(normalized)) rank = Math.min(rank, 2);
      }
      if (Number.isFinite(rank)) matches.push({ item, rank });
    }
    matches.sort((first, second) => first.rank - second.rank
      || second.item.city.population - first.item.city.population
      || first.item.city.name.localeCompare(second.item.city.name)
      || first.item.city.id - second.item.city.id);
    return matches.slice(0, maximum).map(({ item }) => {
      const { id, name, region, country, countryCode, latitude, longitude, population, aliases } = item.city;
      return { id, name, region, country, countryCode, latitude, longitude, population, aliases };
    });
  };
  return { catalog, search, get: (id) => unique.get(Number(id)) ?? null };
}

function matchesContext(context, qualification) {
  const words = context.split(' ');
  return words.some((_word, index) => words.slice(index).join(' ').startsWith(qualification));
}
