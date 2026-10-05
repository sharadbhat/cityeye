import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { createGzip } from 'node:zlib';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

/** Local static preview only. No city search API or answer-checking backend. */
export function createStaticServer({ directory, mount = '/' }) {
  const root = resolve(directory);
  if (!/^\/(?:[\w-]+\/)*$/.test(mount)) throw new Error('Mount must be a trailing-slash path.');
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    let file;
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (!pathname.startsWith(mount)) throw new Error('Outside site mount');
      const relative = pathname.slice(mount.length) || 'index.html';
      file = resolve(root, relative);
      if (!file.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end(); return; }
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
    } catch { response.writeHead(404); response.end('Not found'); return; }
    response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', extname(file) === '.html' || file.endsWith(`${sep}game-data.json`) ? 'no-cache' : 'public, max-age=3600');
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => response.destroy());
    if (/\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
      response.setHeader('Content-Encoding', 'gzip');
      response.setHeader('Vary', 'Accept-Encoding');
      const gzip = createGzip();
      gzip.on('error', () => response.destroy());
      stream.pipe(gzip).pipe(response);
    } else stream.pipe(response);
  });
}
