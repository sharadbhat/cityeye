import CITY_EXPANSION from '../data/world-city-expansion.json' with { type: 'json' };

// Verified GeoNames identities; map centers are placed in downtown, not metro centroids.
const city = (label, country, countryCode, id, name, region, latitude, longitude) => ({
  label, country, countryCode, latitude, longitude,
  radii: [2_500, 6_500, 15_000, 30_000],
  transitRailNames: [],
  geoNames: { id, name, region, countryCode },
});

export const WORLD_CITIES = {
  vancouver: city('Vancouver', 'Canada', 'CA', 6173331, 'Vancouver', 'British Columbia', 49.2827, -123.1207),
  toronto: city('Toronto', 'Canada', 'CA', 6167865, 'Toronto', 'Ontario', 43.6532, -79.3832),
  montreal: city('Montréal', 'Canada', 'CA', 6077243, 'Montréal', 'Quebec', 45.5088, -73.5673),
  'mexico-city': city('Mexico City', 'Mexico', 'MX', 3530597, 'Mexico City', 'Mexico City', 19.4326, -99.1332),
  havana: city('Havana', 'Cuba', 'CU', 3553478, 'Havana', 'Havana', 23.137, -82.356),
  'panama-city': city('Panama City', 'Panama', 'PA', 3703443, 'Panama City', 'Panamá', 8.9824, -79.5199),
  london: city('London', 'United Kingdom', 'GB', 2643743, 'London', 'England', 51.5085, -0.1257),
  paris: city('Paris', 'France', 'FR', 2988507, 'Paris', 'Île-de-France', 48.8566, 2.3522),
  barcelona: city('Barcelona', 'Spain', 'ES', 3128760, 'Barcelona', 'Catalonia', 41.3874, 2.1686),
  amsterdam: city('Amsterdam', 'The Netherlands', 'NL', 2759794, 'Amsterdam', 'North Holland', 52.3731, 4.8922),
  lisbon: city('Lisbon', 'Portugal', 'PT', 2267057, 'Lisbon', 'Lisbon', 38.713, -9.1395),
  rome: city('Rome', 'Italy', 'IT', 3169070, 'Rome', 'Lazio', 41.8955, 12.4823),
  stockholm: city('Stockholm', 'Sweden', 'SE', 2673730, 'Stockholm', 'Stockholm', 59.3294, 18.0687),
  berlin: city('Berlin', 'Germany', 'DE', 2950159, 'Berlin', 'State of Berlin', 52.5208, 13.4095),
  moscow: city('Moscow', 'Russia', 'RU', 524901, 'Moscow', 'Moscow', 55.752, 37.6178),
  istanbul: city('Istanbul', 'Turkey', 'TR', 745044, 'Istanbul', 'Istanbul', 41.0138, 28.9497),
  rio: city('Rio de Janeiro', 'Brazil', 'BR', 3451190, 'Rio de Janeiro', 'Rio de Janeiro', -22.9064, -43.1822),
  'sao-paulo': city('São Paulo', 'Brazil', 'BR', 3448439, 'São Paulo', 'São Paulo', -23.5505, -46.6333),
  'buenos-aires': city('Buenos Aires', 'Argentina', 'AR', 3435910, 'Buenos Aires', 'Buenos Aires F.D.', -34.6037, -58.3816),
  santiago: city('Santiago', 'Chile', 'CL', 3871336, 'Santiago', 'Santiago Metropolitan', -33.4372, -70.6506),
  lima: city('Lima', 'Peru', 'PE', 3936456, 'Lima', 'Lima Province', -12.0464, -77.0428),
  bogota: city('Bogotá', 'Colombia', 'CO', 3688689, 'Bogotá', 'Bogota D.C.', 4.5981, -74.0758),
  cairo: city('Cairo', 'Egypt', 'EG', 360630, 'Cairo', 'Cairo', 30.0444, 31.2357),
  'cape-town': city('Cape Town', 'South Africa', 'ZA', 3369157, 'Cape Town', 'Western Cape', -33.9258, 18.4232),
  johannesburg: city('Johannesburg', 'South Africa', 'ZA', 993800, 'Johannesburg', 'Gauteng', -26.2041, 28.0473),
  nairobi: city('Nairobi', 'Kenya', 'KE', 184745, 'Nairobi', 'Nairobi County', -1.2864, 36.8172),
  lagos: city('Lagos', 'Nigeria', 'NG', 2332459, 'Lagos', 'Lagos', 6.4541, 3.3947),
  casablanca: city('Casablanca', 'Morocco', 'MA', 2553604, 'Casablanca', 'Casablanca-Settat', 33.5945, -7.62),
  tokyo: city('Tokyo', 'Japan', 'JP', 1850147, 'Tokyo', 'Tokyo', 35.6812, 139.7671),
  osaka: city('Osaka', 'Japan', 'JP', 1853909, 'Osaka', 'Osaka', 34.6938, 135.5011),
  seoul: city('Seoul', 'South Korea', 'KR', 1835848, 'Seoul', 'Seoul', 37.566, 126.9784),
  shanghai: city('Shanghai', 'China', 'CN', 1796236, 'Shanghai', 'Shanghai', 31.2304, 121.4737),
  'hong-kong': city('Hong Kong', 'Hong Kong', 'HK', 1819729, 'Hong Kong', '', 22.2819, 114.1582),
  singapore: city('Singapore', 'Singapore', 'SG', 1880252, 'Singapore', '', 1.2897, 103.8501),
  bangkok: city('Bangkok', 'Thailand', 'TH', 1609350, 'Bangkok', 'Bangkok', 13.754, 100.5014),
  mumbai: city('Mumbai', 'India', 'IN', 1275339, 'Mumbai', 'Maharashtra', 18.956, 72.8371),
  dubai: city('Dubai', 'United Arab Emirates', 'AE', 292223, 'Dubai', 'Dubai', 25.1972, 55.2744),
  kathmandu: city('Kathmandu', 'Nepal', 'NP', 1283240, 'Kathmandu', 'Bagmati Province', 27.7017, 85.3206),
  sydney: city('Sydney', 'Australia', 'AU', 2147714, 'Sydney', 'New South Wales', -33.8679, 151.2073),
  melbourne: city('Melbourne', 'Australia', 'AU', 2158177, 'Melbourne', 'Victoria', -37.814, 144.9633),
  brisbane: city('Brisbane', 'Australia', 'AU', 2174003, 'Brisbane', 'Queensland', -27.4679, 153.0281),
  auckland: city('Auckland', 'New Zealand', 'NZ', 2193733, 'Auckland', 'Auckland', -36.8485, 174.7635),

  // Second worldwide batch: 42 additions bring the complete pool to 100.
  'washington-dc': city('Washington, D.C.', 'United States', 'US', 4140963, 'Washington', 'District of Columbia', 38.89511, -77.03637),
  'san-diego': city('San Diego', 'United States', 'US', 5391811, 'San Diego', 'California', 32.71571, -117.16472),
  atlanta: city('Atlanta', 'United States', 'US', 4180439, 'Atlanta', 'Georgia', 33.749, -84.38798),
  'las-vegas': city('Las Vegas', 'United States', 'US', 5506956, 'Las Vegas', 'Nevada', 36.17497, -115.13722),
  calgary: city('Calgary', 'Canada', 'CA', 5913490, 'Calgary', 'Alberta', 51.05011, -114.08529),
  guadalajara: city('Guadalajara', 'Mexico', 'MX', 4005539, 'Guadalajara', 'Jalisco', 20.67738, -103.34749),
  madrid: city('Madrid', 'Spain', 'ES', 3117735, 'Madrid', 'Madrid', 40.4165, -3.70256),
  munich: city('Munich', 'Germany', 'DE', 2867714, 'Munich', 'Bavaria', 48.13743, 11.57549),
  vienna: city('Vienna', 'Austria', 'AT', 2761369, 'Vienna', 'Vienna', 48.20849, 16.37208),
  prague: city('Prague', 'Czechia', 'CZ', 3067696, 'Prague', 'Prague', 50.08804, 14.42076),
  budapest: city('Budapest', 'Hungary', 'HU', 3054643, 'Budapest', 'Budapest', 47.49835, 19.04045),
  warsaw: city('Warsaw', 'Poland', 'PL', 756135, 'Warsaw', 'Mazovia', 52.22977, 21.01178),
  copenhagen: city('Copenhagen', 'Denmark', 'DK', 2618425, 'Copenhagen', 'Capital Region', 55.67594, 12.56553),
  oslo: city('Oslo', 'Norway', 'NO', 3143244, 'Oslo', 'Oslo', 59.91273, 10.74609),
  helsinki: city('Helsinki', 'Finland', 'FI', 658225, 'Helsinki', 'Uusimaa', 60.16952, 24.93545),
  athens: city('Athens', 'Greece', 'GR', 264371, 'Athens', 'Attica', 37.98376, 23.72784),
  zurich: city('Zürich', 'Switzerland', 'CH', 2657896, 'Zürich', 'Zurich', 47.372, 8.541),
  dublin: city('Dublin', 'Ireland', 'IE', 2964574, 'Dublin', 'Leinster', 53.3498, -6.2603),
  beijing: city('Beijing', 'China', 'CN', 1816670, 'Beijing', 'Beijing', 39.9075, 116.39723),
  taipei: city('Taipei', 'Taiwan', 'TW', 1668341, 'Taipei', 'Taiwan', 25.0478, 121.517),
  manila: city('Manila', 'Philippines', 'PH', 1701668, 'Manila', 'National Capital Region', 14.6042, 120.9822),
  jakarta: city('Jakarta', 'Indonesia', 'ID', 1642911, 'Jakarta', 'Jakarta', -6.21462, 106.84513),
  'kuala-lumpur': city('Kuala Lumpur', 'Malaysia', 'MY', 1735161, 'Kuala Lumpur', 'Kuala Lumpur', 3.1412, 101.68653),
  hanoi: city('Hanoi', 'Vietnam', 'VN', 1581130, 'Hanoi', 'Hanoi', 21.0245, 105.84117),
  'ho-chi-minh-city': city('Ho Chi Minh City', 'Vietnam', 'VN', 1566083, 'Ho Chi Minh City', 'Ho Chi Minh City (HCMC)', 10.7769, 106.7009),
  'new-delhi': city('New Delhi', 'India', 'IN', 1261481, 'New Delhi', 'Delhi', 28.6315, 77.2167),
  bengaluru: city('Bengaluru', 'India', 'IN', 1277333, 'Bengaluru', 'Karnataka', 12.97194, 77.59369),
  karachi: city('Karachi', 'Pakistan', 'PK', 1174872, 'Karachi', 'Sindh', 24.8608, 67.0104),
  dhaka: city('Dhaka', 'Bangladesh', 'BD', 1185241, 'Dhaka', 'Dhaka Division', 23.7104, 90.40744),
  riyadh: city('Riyadh', 'Saudi Arabia', 'SA', 108410, 'Riyadh', 'Riyadh Region', 24.6905, 46.6853),
  doha: city('Doha', 'Qatar', 'QA', 290030, 'Doha', 'Baladiyat ad Dawhah', 25.28545, 51.53096),
  'abu-dhabi': city('Abu Dhabi', 'United Arab Emirates', 'AE', 292968, 'Abu Dhabi', 'Abu Dhabi', 24.493, 54.368),
  'addis-ababa': city('Addis Ababa', 'Ethiopia', 'ET', 344979, 'Addis Ababa', 'Addis Ababa', 9.02497, 38.74689),
  accra: city('Accra', 'Ghana', 'GH', 2306104, 'Accra', 'Greater Accra', 5.55602, -0.1969),
  dakar: city('Dakar', 'Senegal', 'SN', 2253354, 'Dakar', 'Dakar', 14.6937, -17.44406),
  tunis: city('Tunis', 'Tunisia', 'TN', 2464470, 'Tunis', 'Tunis Governorate', 36.81897, 10.16579),
  quito: city('Quito', 'Ecuador', 'EC', 3652462, 'Quito', 'Pichincha', -0.22985, -78.52495),
  medellin: city('Medellín', 'Colombia', 'CO', 3674962, 'Medellín', 'Antioquia', 6.245, -75.57151),
  montevideo: city('Montevideo', 'Uruguay', 'UY', 3441575, 'Montevideo', 'Montevideo Department', -34.90328, -56.18816),
  salvador: city('Salvador', 'Brazil', 'BR', 3450554, 'Salvador', 'Bahia', -12.9714, -38.5108),
  perth: city('Perth', 'Australia', 'AU', 2063523, 'Perth', 'Western Australia', -31.95224, 115.8614),
  wellington: city('Wellington', 'New Zealand', 'NZ', 2179537, 'Wellington', 'Wellington Region', -41.28664, 174.77557),
};

// Fixed identities/centers, not a population-ranked selection on every run.
// Appending leaves all existing definitions and generation fingerprints intact.
const geonameIds = new Set(Object.values(WORLD_CITIES).map(entry => entry.geoNames.id));
for (const entry of CITY_EXPANSION) {
  if (Object.hasOwn(WORLD_CITIES, entry.key) || geonameIds.has(entry.id)) {
    throw new Error(`Duplicate city in expansion: ${entry.key} (${entry.id}).`);
  }
  WORLD_CITIES[entry.key] = city(entry.label, entry.country, entry.countryCode, entry.id, entry.name, entry.region, entry.latitude, entry.longitude);
  geonameIds.add(entry.id);
}

export const WORLD_CITY_IDS = Object.keys(WORLD_CITIES);
