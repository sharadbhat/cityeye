import { validateMapMetadata } from '../src/lib/map-controller.mjs';

/** Publish only our validated generator's flat SVG layers, not arbitrary SVGs. */
export function publicMapSvg(source) {
  const encoded = source.match(/<metadata>([\s\S]*?)<\/metadata>/)?.[1];
  if (!encoded) throw new Error('Map has no camera metadata.');
  const decoded = encoded.replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const config = validateMapMetadata(JSON.parse(decoded));
  const metadata = JSON.stringify(config).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return source
    .replace(/<metadata>[\s\S]*?<\/metadata>/, `<metadata>${metadata}</metadata>`)
    .replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<g\b[^>]*\bdata-layer="(?:country-clue|elevation-bands|contours)"[^>]*>[\s\S]*?<\/g>/g, '');
}
