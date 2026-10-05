#!/usr/bin/env node

// Build an offline review page from the standalone, unstyled city SVG assets.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, MAJOR_CITY_IDS } from './cities.mjs';

const OUTPUT_DIRECTORY = fileURLToPath(new URL('../output/', import.meta.url));
const options = parseArguments(process.argv.slice(2));
const requested = options.cities ?? [...MAJOR_CITY_IDS, 'slc'];
const cityIds = [...new Set(requested)];
const missing = [];
const maps = [];

for (const id of cityIds) {
  if (!CITIES[id]) throw new Error(`Unknown city "${id}". Available cities: ${Object.keys(CITIES).join(', ')}`);
  const path = resolve(OUTPUT_DIRECTORY, `${id}-city-layered.svg`);
  let svg;
  try {
    svg = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    missing.push(id);
    continue;
  }
  if (!/<svg\b/.test(svg) || !/<metadata>[\s\S]*?<\/metadata>/.test(svg)) {
    throw new Error(`Invalid layered SVG: ${path}`);
  }
  maps.push({ id, label: CITIES[id].label, svg: svg.replace(/<\?xml[^>]*\?>\s*/g, '').trim() });
}

if (missing.length) {
  const message = `Missing generated SVGs: ${missing.join(', ')}`;
  if (options.requireAll) throw new Error(message);
  console.warn(`${message}. The preview will include the available cities.`);
}
if (!maps.length) throw new Error('No city SVGs are available. Generate a city map first.');

const template = await readFile(new URL('./city-preview-template.html', import.meta.url), 'utf8');
const choices = maps.map(({ id, label }) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join('\n          ');
const geometry = maps.map(({ id, label, svg }) => `<template data-city="${escapeHtml(id)}" data-label="${escapeHtml(label)}">\n${svg}\n</template>`).join('\n');
const output = options.output ?? resolve(OUTPUT_DIRECTORY, 'city-layer-preview.html');
const html = template.replace('<!-- CITY_OPTIONS -->', choices).replace('<!-- CITY_GEOMETRY -->', geometry);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html, 'utf8');
console.log(`Wrote ${output} (${maps.length} cities; ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(1)} MB).`);

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function parseArguments(args) {
  const parsed = { cities: null, output: null, requireAll: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--cities' && args[index + 1]) {
      const value = args[++index];
      parsed.cities = value === 'all' ? Object.keys(CITIES) : value.split(',').map((id) => id.trim()).filter(Boolean);
      if (!parsed.cities.length) throw new Error('--cities must contain at least one city ID.');
    } else if (argument === '--output' && args[index + 1]) {
      parsed.output = resolve(args[++index]);
    } else if (argument === '--require-all') {
      parsed.requireAll = true;
    } else if (argument === '--help') {
      console.log('Usage: node scripts/build-city-preview.mjs [--cities nyc,sf,...|all] [--output path] [--require-all]');
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }
  return parsed;
}
