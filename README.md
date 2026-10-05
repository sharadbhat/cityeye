# CityEye

A React city-guessing game using the progressive maps below. Each round picks
one of the available generated cities at random. Cities shown are tracked in
`sessionStorage` for the current tab, including across refreshes, and do not repeat
until every available city has been shown. Then a new cycle starts, avoiding an
immediate repeat when possible. Closing the tab ends this history. If browser
storage is blocked, history still works in memory until refresh. Guess
from a worldwide GeoNames autocomplete directory. An incorrect guess advances
one stage; five attempts give you a chance at every stage, including the final
country clue. Duplicate guesses don't consume an attempt. Correct guesses win.
The Skip button reveals the next clue and consumes one attempt, recording a
"Skipped" history entry without distance/direction. It is disabled at stage 5,
so the final clue remains guessable. Skips and guesses share the five attempts.
A fifth unsuccessful attempt or "Reveal the city" ends the round and shows the answer.
Each wrong guess includes an approximate great-circle distance in kilometers
and an initial compass bearing from the guessed city's coordinates toward
the correct city's coordinates. These are city-center clues, not driving
distances. Directions and arrows appear in the guess history; no direction is
invented for coincident or antipodal coordinates.

## Run the game

Requires Node.js 22.12 or newer. From the repository root:

```sh
npm install
npm run catalog
npm run dev
```

Open `http://127.0.0.1:5173/`. The city-directory download is only needed once.
It caches GeoNames source files under `output/source/geonames/`; subsequent
catalog builds use the cache. Use `npm run catalog -- --refresh` to download
fresh data. Generated global data and copied app maps are excluded from Git.
`data/playable-cities.json` maps the SVGs to verified GeoNames IDs, separately
from the global guess directory. Suggestions require a recorded population
of at least 100,000, including administrative seats. The current catalog has
5,850 cities across 171 countries/territories; counts can change on refresh.
The source is GeoNames' `cities15000` export, the closest available city export
below our threshold. `parseCityRecords` applies the 100,000-person cutoff during
catalog generation, before writing JSON or preparing the website's search index.
Smaller cities and capitals are not included in the published directory.
The cutoff is defined by `MIN_CITY_POPULATION` in `scripts/build-city-catalog.mjs`.
After rebuilding the catalog, run `npm run prepare:app` and refresh the browser
to load the newly prepared static data.

The autocomplete searches names, alternate spellings, diacritics, and curated
NYC/SF/LA/Philly/SLC abbreviations. Suggestions show region and country to
disambiguate identical names. Select with the mouse or arrow keys and Enter;
press Enter again or click "Guess" to submit. Suggestions are not
restricted to cities in the answer pool.

```sh
npm test
npm run build
npm start
```

The production preview runs at `http://localhost:4173/` (or `PORT` with
`npm start`, using `scripts/preview.mjs`). These are static file servers, not app backends. Development,
preview, and production bind to loopback by default; nothing is published.

### GitHub Pages / static hosting

Run `npm run build`, then deploy **the contents of `dist/`** to GitHub Pages.
No API, Node runtime, database, or server-side city catalog is needed on the
host. Vite uses `base: '/cityeye/'` for the repository's Pages URL,
`https://sharadbhat.github.io/cityeye/`. Scripts, maps, data, fonts, and the
home link use that prefix. A custom-domain root would require a different base.
Do not deploy `output/`, `data/`, or the repository source as the website.
If using a build workflow, the checkout needs the generated source SVGs and
catalog before `npm run build`; alternatively publish an already-built `dist/`
artifact. Build-time generation still uses Node and geographic downloads;
playing the deployed game does not.

`.github/workflows/deploy.yml` runs on pushes to `main` and can also be started
manually from Actions. It sets up Node.js 22, installs dependencies, generates
the filtered city directory, builds the website, and uploads/deploys `dist/`
using GitHub's official Pages actions. It does not push a `gh-pages` branch.
In repository Settings → Pages → Build and deployment, select **GitHub Actions**
as the Source before running this workflow. Commit/push the workflow change;
local edits alone do not start a GitHub deployment.

The official deployment instructions are at
[Vite: GitHub Pages](https://vite.dev/guide/static-deploy.html#github-pages).

Only one SVG is fetched and mounted per round. React manages game state;
`CityMap` owns the inline SVG and its compositor-based camera transition.
The compact worldwide catalog downloads once (currently about 2.14 MB before
HTTP compression); names, aliases, regions and coordinates are indexed locally.
Typing uses prefix buckets and the best eight matches, with no per-keystroke
network requests. `public/data/game-data.json` lists only playable numeric IDs
and a content-hashed catalog filename. All deployed maps are named
`public/maps/<GeoNames-ID>.svg`, matching guess identities. Their metadata
contains only cameras: city/country/source-coordinate clues, terrain, and the
old SVG country label are removed during publication. Geography labels are
gated React overlays instead. City-named working SVGs remain under `output/`
for generator caches/validation, and are **not deployed**.

IDs remove obvious filename spoilers, not determined cheating: GeoNames IDs
can be looked up, and all answers/rules must be available to a fully client-side
game. This is not a cheat-proof competitive service. Fonts have system
fallbacks when offline.

## Progressive map assets

One React-ready, unstyled SVG per city, with five progressively wider reveals.
The generated assets are in `output/`; `output/city-layer-preview.html` is an
offline review page with a city selector and five stage buttons.

## Generate

Requires Node.js and `uv`/`uvx`. The downloader uses the official `overturemaps`
Python package through `uvx`; the SVG generation code is JavaScript.

### Unattended worldwide batch (42 new cities)

From the repository root, run:

```sh
npm run generate:world
```

Leave the terminal open and keep the computer awake. This generates all 42
international cities in `scripts/world-cities.mjs`, one at a time to limit
memory use. It needs internet access and disk space for the geographic source
caches; large cities can take a while. No accounts, API keys, or interactive
prompts are required. Node.js, `uvx`, and the app's npm dependencies must already
be installed (`npm install`); `uvx` automatically prepares the pinned Python
downloader on first use.

The runner:

- Checks all 42 GeoNames identities against the 100,000-population catalog.
- Prepares a missing city catalog automatically and retries transient setup and
  publication errors. A completed batch can be republished without new downloads.
- Retries each failed city up to three times with backoff; continues to the next
  city after a permanent failure instead of stopping the whole batch.
- Limits each city attempt to 45 minutes and terminates timed-out downloads.
- Writes maps atomically, validates all five layers/cameras, and requires usable
  street geometry, parks, and elevation. Missing transit/major water is reported
  as a warning, not invented geometry.
- Saves progress after every city/attempt. Rerunning the same command resumes
  by skipping validated maps with matching generation fingerprints. Changed
  city settings/generation code or invalid outputs trigger regeneration.
- Repairs corrupt source caches by moving them aside for diagnosis.
- Prevents two batches from writing the same outputs at once.
- Publishes only valid generated maps, copies SVGs into the React app before
  registering their playable identities, and builds `dist/` automatically. The existing
  16 cities remain available; a fully successful batch adds 42, for 58 total.

Outputs are `output/<city>-city-layered.svg`,
`output/world-generation-report.json`, and per-city logs under
`output/logs/world-cities/`. Source data is cached under `output/source/`.
The script exits with a nonzero status if any city or publication fails. The
report names failures and warnings; rerun the same command to retry unfinished
cities. Ctrl+C cancels active downloads and preserves finished maps.

After the batch finishes, refresh the browser so the prepared static
playable-city list and suggestion index reload.
The script deliberately does not kill or restart your running servers.

Optional commands (direct Node invocation also avoids PowerShell/npm argument
forwarding differences):

```sh
node scripts/generate-world-cities.mjs --dry-run
node scripts/generate-world-cities.mjs --jobs 2
node scripts/generate-world-cities.mjs --cities london,paris
node scripts/generate-world-cities.mjs --attempts 5 --timeout-minutes 60
node scripts/generate-world-cities.mjs --force
```

The dataset release and Python package version are pinned in
`scripts/map-source.mjs`. If an old release is removed by Overture, the runner
fails its preflight before attempting all 42 cities; update that file to a
supported release before rerunning. The offline HTML preview is separate: after
generation, use `node scripts/build-city-preview.mjs --cities all` to rebuild it.

### Original US batch

```sh
node scripts/generate-cities.mjs --jobs 2
node scripts/build-city-preview.mjs --require-all
```

The batch defaults to NYC, San Francisco, Seattle, Portland (Oregon), Dallas,
Austin, Houston, Provo, Nashville, Miami, Los Angeles, Denver, Boston,
Philadelphia, and Chicago. SLC remains available in the preview.

```sh
node scripts/generate-city-map-svg.mjs --city nyc
node scripts/generate-cities.mjs --cities sf,seattle --jobs 2
```

The source-data and elevation downloads are cached under `output/source/`.
These caches are large and are not needed by the website. A cached rerun does
not need to download the data again. The Overture release is pinned in
`scripts/map-source.mjs`; update it for a future fresh-data run if
that release is no longer hosted. `output/cities.json` records the last batch.

## SVG contract

All geometry uses the same 800 × 800 regional coordinate space. Read the SVG's
JSON `<metadata>` for five **1-based** `cameras`, then animate `viewBox` between
those camera values. Toggle each group's visibility when its
`data-reveal-stage` is reached. Later stages retain earlier layers.

The React game applies `src/lib/reveal-stages.mjs` before rendering: water
reveals at stage 1, parks/transit at stage 2, and regional roads/rail at stage 3. This overrides the earlier
order stored in generated SVGs without changing their geometry or invalidating
the running world-generation batch. The standalone offline preview still uses
the original SVG reveal attributes. In-game terrain is omitted; continent and
country labels are HTML overlays, gated at stages 4 and 5 respectively. The
country is shown above the retained continent label. `src/lib/city-clues.mjs` defines verified
continent assignments, including city-specific transcontinental exceptions.
The table below describes the React game.

| Stage | New context | Radius |
| --- | --- | --- |
| 1 | Downtown street grid and major water features | 2.5 km |
| 2 | More streets, parks, and passenger rail/transit | 6.5 km |
| 3 | Wider regional road and rail network | 15 km |
| 4 | Continent clue, with the wider regional map | 30 km |
| 5 | Country clue, with continent beneath it | 30 km |

The combined SVG has semantic classes but no embedded theme or paint styles.
Inline it in React (rather than using an `<img>`) to control its layers and
apply website CSS. `scripts/city-preview-template.html` contains a sample
theme and camera animation. Zoom uses a 360 ms HTML-wrapper transform with a
static SVG camera during motion; newly revealed layers fade in after the zoom.
Reverse and interrupted zooms preserve their camera alignment. Fixed-pixel
stroke widths settle at the final camera (strokes scale temporarily during the
compositor animation). Elevation paths expose
`data-elevation-normalized` for a white-to-gray palette: the lowest band is 0
(white) and the highest is 1. Eight bands adapt to each city's local elevation
range rather than fixed absolute altitude; constant terrain stays white.
Invalid DEM samples are excluded, and offshore negative values use sea level
so underwater depths do not skew the topographic shading. Roads are stitched
into compound paths and use non-scaling strokes.

Water areas must be at least 100,000 m². Canal, ditch, drain, industrial basin,
seasonal line, and narrow creek/branch/brook/stream features are excluded.
This is a source-tag-based heuristic, not a guarantee of complete hydrology.

Public transit is passenger rail, not bus routes. Coverage follows Overture's
rail classes and passenger-operator names; Nashville additionally uses its
official WeGo Star GTFS shapes because its railway is shared with freight.

## Check

```sh
node --test scripts/road-paths.test.mjs scripts/map-geometry.test.mjs scripts/water-features.test.mjs scripts/elevation-scale.test.mjs scripts/camera-transform.test.mjs scripts/city-preview.test.mjs
node scripts/validate-city-maps.mjs
```

`scripts/render-city-checks.mjs` uses `sharp` to create a stage-3 contact sheet
and larger stage-4 PNG checks without creating extra SVG assets. Install
`sharp` or set `NODE_PATH` to a runtime that provides it before running.

## Attribution

Map data: [Overture Maps](https://overturemaps.org/) and
[OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
Elevation: USGS SRTM. Nashville passenger-rail overlay:
[WeGo Public Transit official GTFS](https://www.wegotransit.com/googleexport/google_transit.zip).
Keep the source attribution visible in any published map. Per-city source
links are also recorded in SVG metadata.

City names and alternate names: [GeoNames](https://www.geonames.org/),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The directory is
derived from the [cities15000 export](https://download.geonames.org/export/dump/readme.txt),
filtered to cities with a recorded population of at least 100,000 and excluding
neighborhood, historical, and abandoned feature codes. Population refers to
the GeoNames record, not a metro-area population; unknown populations are excluded.
