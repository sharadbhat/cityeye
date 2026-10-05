import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './static-files.mjs';

test('static host serves ID assets under a repository subpath with no API', async () => {
  const server = createStaticServer({ directory: fileURLToPath(new URL('../public/', import.meta.url)), mount: '/guess-the/' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/guess-the/data/game-data.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    const manifest = await response.json();
    const map = await fetch(`${base}/guess-the/maps/${manifest.playableIds[0]}.svg`);
    assert.equal(map.status, 200);
    assert.equal(map.headers.get('content-type'), 'image/svg+xml');
    assert.match(await map.text(), /<svg/);
    const catalog = await fetch(`${base}/guess-the/data/${manifest.catalogFile}`);
    assert.equal(catalog.status, 200);
    assert.ok((await catalog.json()).cities.length > 5000);
    assert.equal((await fetch(`${base}/api/playable-cities`)).status, 404);
    assert.equal((await fetch(`${base}/guess-the/api/cities?q=Tokyo`)).status, 404);
    assert.equal((await fetch(`${base}/guess-the/maps/slc-city-layered.svg`)).status, 404);
    assert.equal((await fetch(`${base}/guess-the/%2e%2e%2fpackage.json`)).status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
