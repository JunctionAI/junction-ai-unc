/** Writes frozen Content receiver JSON for Nguyen. Simulated only. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const jiti = require('jiti')(import.meta.url);
const f = jiti(join(root, 'src/lib/n8n/contentReceiverFixtures.ts'));
const dir = join(root, 'docs/integration/receivers/content-search-shadow.v1');
await mkdir(dir, { recursive: true });
const dump = (name, value) => writeFile(join(dir, name), JSON.stringify(value, null, 2) + '\n');
await dump('published-versus-proposed.json', f.CONTENT_RECEIVER_STATUS);
await dump('needs.empty-serp.json', f.frozenNeedsEmpty());
await dump('authority.http.json', f.frozenAuthorityHttp());
await dump('authority.errors.json', f.frozenAuthorityErrors());
for (const routineId of f.CONTENT_ROUTINE_LIST) {
  for (const market of f.CONTENT_MARKETS_LIST) {
    const prefix = `${routineId}-${market}`;
    await dump(`${prefix}.request.json`, f.frozenRequest(routineId, market));
    await dump(`${prefix}.authority-200.json`, f.frozenAuthoritySuccess(routineId, market));
    await dump(`${prefix}.response.json`, f.frozenResponse(routineId, market));
  }
}
console.log(JSON.stringify({ status: 'WROTE', dir: 'docs/integration/receivers/content-search-shadow.v1', class: 'simulated_frozen_example' }));
