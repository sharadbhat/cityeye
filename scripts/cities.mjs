import { WORLD_CITIES } from './world-cities.mjs';

/**
 * City centers sit in each downtown so the first reveal shows its street grid.
 * Commuter-rail names supplement Overture's transit classes. Keep these specific
 * to passenger operators: generic railroad/subdivision names also match freight.
 */
const city = (label, latitude, longitude, transitRailNames = []) => ({
  label,
  country: "United States",
  latitude,
  longitude,
  radii: [2_500, 6_500, 15_000, 30_000],
  transitRailNames,
});

export const CITIES = {
  slc: city("Salt Lake City", 40.7608, -111.891, ["TRAX", "FrontRunner"]),
  nyc: city("New York City", 40.7128, -74.006, [
    "Long Island Rail Road",
    "LIRR",
    "Metro-North",
    "Metro North",
    "NJ Transit",
    "New Jersey Transit",
  ]),
  sf: city("San Francisco", 37.789, -122.401, ["Caltrain"]),
  seattle: city("Seattle", 47.6062, -122.3321, ["Sounder"]),
  portland: city("Portland, Oregon", 45.5189, -122.6793, [
    "Westside Express Service",
    "WES Commuter Rail",
  ]),
  dallas: city("Dallas", 32.7802, -96.8005, [
    "Trinity Railway Express",
    "DART Silver Line",
  ]),
  austin: city("Austin", 30.2672, -97.7431, [
    "CapMetro",
    "Capital Metro",
    "MetroRail",
  ]),
  houston: city("Houston", 29.7604, -95.3698),
  provo: city("Provo", 40.2338, -111.6585, ["TRAX", "FrontRunner"]),
  nashville: {
    ...city("Nashville", 36.1627, -86.7816, ["WeGo Star", "Music City Star"]),
    transitOverlay: {
      file: "nashville-transit.geojson",
      downloader: "download-nashville-transit.py",
      attribution: "WeGo Public Transit official GTFS",
      url: "https://www.wegotransit.com/googleexport/google_transit.zip",
    },
  },
  miami: city("Miami", 25.7743, -80.1937, ["Tri-Rail", "Tri Rail"]),
  la: city("Los Angeles", 34.0522, -118.2437, ["Metrolink"]),
  denver: city("Denver", 39.7452, -104.9921, [
    "RTD",
    "Regional Transportation District",
    "University of Colorado A Line",
    "East Rail Line",
    "Gold Line",
    "North Metro Rail Line",
  ]),
  boston: city("Boston", 42.3601, -71.0589, ["MBTA"]),
  philly: city("Philadelphia", 39.9526, -75.1636, ["SEPTA"]),
  chicago: city("Chicago", 41.8832, -87.6324, ["Metra"]),
  ...WORLD_CITIES,
};

export const MAJOR_CITY_IDS = [
  "nyc",
  "sf",
  "seattle",
  "portland",
  "dallas",
  "austin",
  "houston",
  "provo",
  "nashville",
  "miami",
  "la",
  "denver",
  "boston",
  "philly",
  "chicago",
];

export const ORIGINAL_CITY_IDS = ['slc', ...MAJOR_CITY_IDS];
