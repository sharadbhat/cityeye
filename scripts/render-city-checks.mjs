#!/usr/bin/env node

/** Render PNG checks from the same geometry, theme, and cameras as the preview. */
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, MAJOR_CITY_IDS } from './cities.mjs';

const require = createRequire(import.meta.url);
const sharp = loadSharp();
const outputDirectory = fileURLToPath(new URL('../output/', import.meta.url));
const options = parseArguments(process.argv.slice(2));
const template = await readFile(new URL('./city-preview-template.html', import.meta.url), 'utf8');
const theme = mapTheme(template);
const size = 360;
const gap = 16;
const labelHeight = 34;
const headingHeight = 52;
const columns = Math.min(3, options.cities.length);
const rows = Math.ceil(options.cities.length / columns);
const width = gap + columns * (size + gap);
const height = headingHeight + gap + rows * (size + labelHeight + gap);
const composite = [];

await mkdir(outputDirectory, { recursive: true });
for (const [index, id] of options.cities.entries()) {
  const source = await readFile(join(outputDirectory, `${id}-city-layered.svg`), 'utf8');
  const left = gap + (index % columns) * (size + gap);
  const top = headingHeight + gap + Math.floor(index / columns) * (size + labelHeight + gap);
  const map = await renderMap(source, options.stage, size);
  const label = labelSvg(CITIES[id].label, size, labelHeight);
  composite.push({ input: map, left, top });
  composite.push({ input: Buffer.from(label), left, top: top + size });
  console.log(`Rendered ${CITIES[id].label}: stage ${options.stage}`);

  // Larger checks expose coastline, rail, and terrain details in dense coastal cities.
  if (['nyc', 'sf', 'chicago'].includes(id)) {
    const check = await renderMap(source, 4, 800);
    const file = join(outputDirectory, `${id}-stage-4-map-check.png`);
    await sharp(check).png().toFile(file);
    console.log(`Wrote ${file}`);
  }
}

const heading = `City maps · Stage ${options.stage} · ${options.stage >= 4 ? 'City-relative elevation' : 'Parks, transit, and major water'}`;
composite.push({
  input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${headingHeight}"><text x="${gap}" y="33" fill="#eff4ed" font-family="Arial, sans-serif" font-size="22" font-weight="700">${heading}</text></svg>`),
  left: 0,
  top: 0,
});
const output = options.output ?? join(outputDirectory, options.cities.length === 1
  ? `${options.cities[0]}-stage-${options.stage}-contact-sheet.png`
  : options.stage === 3 ? 'city-contact-sheet.png' : `city-stage-${options.stage}-contact-sheet.png`);
await mkdir(dirname(output), { recursive: true });
await sharp({ create: { width, height, channels: 4, background: '#151b18' } })
  .composite(composite).png().toFile(output);
console.log(`Wrote ${output} (${width} × ${height})`);

async function renderMap(source, stage, pixels) {
  const metadata = source.match(/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/)?.[1];
  if (!metadata) throw new Error('SVG is missing camera metadata.');
  const camera = JSON.parse(decodeXml(metadata)).cameras?.[stage];
  if (!Array.isArray(camera) || camera.length !== 4 || !camera.every(Number.isFinite)
    || camera[2] <= 0 || camera[3] <= 0) throw new Error(`SVG has no valid camera for stage ${stage}.`);

  let svg = source.replace(/<svg\b([^>]*)>/, (_match, attributes) => {
    const clean = attributes.replace(/\s(?:viewBox|width|height|id)="[^"]*"/g, '');
    return `<svg${clean} id="map" viewBox="${camera.join(' ')}" width="${pixels}" height="${pixels}">`;
  });
  svg = svg.replace(/<g\b([^>]*data-reveal-stage="(\d+)"[^>]*)>/g, (_match, attributes, revealStage) => {
    const visible = Number(revealStage) <= stage;
    const clean = attributes.replace(/\sclass="[^"]*"/g, '');
    return `<g${clean} class="${visible ? 'visible' : ''}"${visible ? '' : ' style="display:none"'}>`;
  });

  const bands = [...svg.matchAll(/<path\b[^>]*class="[^"]*\belevation-band\b[^>]*>/g)];
  const colors = elevationColors(bands.map(([tag]) => ({
    normalized: tag.match(/data-elevation-normalized="([^"]+)"/)?.[1],
    min: tag.match(/data-elevation-min="([^"]+)"/)?.[1],
    max: tag.match(/data-elevation-max="([^"]+)"/)?.[1],
  })));
  let bandIndex = 0;
  svg = svg.replace(/<path\b[^>]*class="[^"]*\belevation-band\b[^>]*>/g, (tag) => {
    const color = colors[bandIndex++];
    // Explicit fill also supports renderers that do not implement CSS variables.
    return tag.replace(/\sstyle="[^"]*"/, '').replace(/\/?\s*>$/, (ending) => ` style="--elevation-color:${color};fill:${color}"${ending}`);
  });

  svg = svg.replace(/(<svg\b[^>]*>)/, `$1<style>${theme}</style><rect x="${camera[0]}" y="${camera[1]}" width="${camera[2]}" height="${camera[3]}" fill="#f4f3ea"/>`);
  return sharp(Buffer.from(svg), { limitInputPixels: false }).png().toBuffer();
}

function elevationColors(bands) {
  const numeric = (value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const complete = ['normalized', 'min', 'max'].map((key) => bands.map((band) => numeric(band[key])))
    .filter((values) => values.every((value) => value !== null));
  const values = complete.find((candidate) => Math.max(...candidate) > Math.min(...candidate))
    ?? complete[0] ?? bands.map((_band, index) => index);
  if (!values.length) return [];
  const minimum = Math.min(...values);
  const range = Math.max(...values) - minimum;
  return values.map((value) => {
    const amount = range > 0 ? (value - minimum) / range : 0;
    const shade = Number((255 - 85 * amount).toFixed(4));
    return `rgb(${shade}, ${shade}, ${shade})`;
  });
}

function mapTheme(html) {
  const css = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/)?.[1];
  if (!css) throw new Error('Preview template has no CSS theme.');
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.trim().startsWith('#map '))
    .map(([, selector, declarations]) => `${selector.trim()}{${declarations.replace(/transition(?:-delay)?:[^;]*;?/g, '')}}`);
  if (!rules.length) throw new Error('Preview template has no map CSS rules.');
  return rules.join('\n');
}

function labelSvg(label, labelWidth, labelHeight) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${labelWidth}" height="${labelHeight}"><text x="2" y="24" fill="#eff4ed" font-family="Arial, sans-serif" font-size="19" font-weight="600">${escapeXml(label)}</text></svg>`;
}

function decodeXml(value) {
  return value.replace(/&#x([\da-f]+);|&#(\d+);|&(quot|apos|lt|gt|amp);/gi, (_match, hex, decimal, entity) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number(decimal));
    return { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' }[entity.toLowerCase()];
  });
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function parseArguments(args) {
  const result = { cities: [...MAJOR_CITY_IDS], output: null, stage: 3 };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--cities' && args[index + 1]) result.cities = args[++index].split(',').filter(Boolean);
    else if (argument === '--stage' && args[index + 1]) result.stage = Number(args[++index]);
    else if (argument === '--output' && args[index + 1]) result.output = args[++index];
    else if (argument === '--help') {
      console.log('Usage: node scripts/render-city-checks.mjs [--cities slc,nyc,...] [--stage 1..5] [--output path.png]');
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  if (!result.cities.length) throw new Error('At least one city is required.');
  if (!Number.isInteger(result.stage) || result.stage < 1 || result.stage > 5) throw new Error('--stage must be 1..5.');
  for (const id of result.cities) if (!CITIES[id]) throw new Error(`Unknown city: ${id}`);
  return result;
}

function loadSharp() {
  try { return require('sharp'); } catch (originalError) {
    for (const directory of (process.env.NODE_PATH ?? '').split(delimiter).filter(Boolean)) {
      try { return require(join(directory, 'sharp')); } catch { /* Try the next dependency root. */ }
    }
    throw new Error('sharp is unavailable. Set NODE_PATH to the bundled workspace node_modules directory.', { cause: originalError });
  }
}
