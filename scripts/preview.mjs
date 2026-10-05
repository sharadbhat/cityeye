import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './static-files.mjs';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
try { await stat(resolve(root, 'index.html')); } catch {
  console.error('Production build is missing. Run npm run build first.');
  process.exit(1);
}
const server = createStaticServer({ directory: root });
const port = Number(process.env.PORT ?? 4173);
server.listen(port, '127.0.0.1', () => console.log(`CityEye is ready at http://localhost:${port}`));
