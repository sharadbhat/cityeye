import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { extractZipEntry, MIN_CITY_POPULATION, parseCityRecords, parseCountries, parseRegions } from './build-city-catalog.mjs';

const line = (id, name, code = 'PPL', country = 'US', admin = 'OR', population = MIN_CITY_POPULATION) => [id, name, name.normalize('NFD').replace(/\p{M}/gu, ''), 'Alias,Another Alias', 45.5, -122.7, 'P', code, country, '', admin, '', '', '', population, '', '', 'America/Los_Angeles', '2026-10-04'].join('\t');

test('GeoNames parsing retains eligible cities and admin seats while excluding neighborhoods and historical/abandoned places', () => {
  const countries = parseCountries('#ISO\tISO3\nUS\tUSA\t840\tUS\tUnited States\n');
  const regions = parseRegions('US.OR\tOregon\tOregon\t5744337\n');
  const text = [line(1, 'City'), line(2, 'County Seat', 'PPLA2'), ...['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'].map((code, index) => line(index + 3, code, code))].join('\n');
  const parsed = parseCityRecords(text, countries, regions);
  assert.deepEqual(parsed.cities.map((city) => city.id), [1, 2]);
  assert.equal(parsed.cities[0].region, 'Oregon');
  assert.equal(parsed.cities[0].country, 'United States');
  assert.equal(parsed.cities[1].population, MIN_CITY_POPULATION);
  assert.deepEqual(parsed.cities[0].aliases, ['Alias', 'Another Alias']);
  assert.equal(Object.values(parsed.omitted).reduce((sum, amount) => sum + amount, 0), 5);
});

test('the population cutoff includes 100,000 and excludes smaller cities and administrative seats', () => {
  const parsed = parseCityRecords([
    line(1, 'Boundary City', 'PPL', 'US', 'OR', 100_000),
    line(2, 'Smaller City', 'PPL', 'US', 'OR', 99_999),
    line(3, 'Small Capital', 'PPLC', 'US', 'OR', 500),
    line(4, 'Unknown Population Seat', 'PPLA2', 'US', 'OR', 0),
    line(5, 'Larger City', 'PPL', 'US', 'OR', 200_000),
  ].join('\n'), new Map([['US', 'United States']]), new Map());
  assert.equal(MIN_CITY_POPULATION, 100_000);
  assert.deepEqual(parsed.cities.map((city) => city.id), [1, 5]);
  assert.equal(parsed.omittedPopulationCount, 3);
});

test('invalid coordinates and unknown country metadata fail before producing a catalog', () => {
  const countries = new Map([['US', 'United States']]);
  const regions = new Map();
  assert.throws(() => parseCityRecords(line(1, 'Bad country', 'PPL', 'XX'), countries, regions), /Invalid GeoNames/);
  assert.throws(() => parseCityRecords(line(1, 'Bad latitude').replace('\t45.5\t', '\t95.5\t'), countries, regions), /Invalid GeoNames/);
});

function zipFixture() {
  const filename = Buffer.from('cities500.txt');
  const content = Buffer.from('123456789');
  const compressed = deflateRawSync(content);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(0xcbf43926, 14); // Known CRC-32 of "123456789".
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(content.length, 22);
  header.writeUInt16LE(filename.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50);
  directory.writeUInt16LE(20, 4);
  directory.writeUInt16LE(20, 6);
  directory.writeUInt16LE(8, 10);
  directory.writeUInt32LE(0xcbf43926, 16);
  directory.writeUInt32LE(compressed.length, 20);
  directory.writeUInt32LE(content.length, 24);
  directory.writeUInt16LE(filename.length, 28);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50);
  footer.writeUInt16LE(1, 8);
  footer.writeUInt16LE(1, 10);
  footer.writeUInt32LE(directory.length + filename.length, 12);
  footer.writeUInt32LE(header.length + filename.length + compressed.length, 16);
  return Buffer.concat([header, filename, compressed, directory, filename, footer]);
}

test('built-in ZIP extraction verifies the expected filename and archive checksum', () => {
  const zip = zipFixture();
  assert.equal(extractZipEntry(zip, 'cities500.txt'), '123456789');
  assert.throws(() => extractZipEntry(zip, 'different.txt'), /does not contain/);
  const corrupted = Buffer.from(zip);
  const directory = corrupted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupted.writeUInt32LE(0, directory + 16);
  assert.throws(() => extractZipEntry(corrupted, 'cities500.txt'), /checksum/);
});
