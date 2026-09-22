#!/usr/bin/env node
// CAMP-73: the list of URLs that must now answer 410, frozen at build time.
//
// 🔴 Frozen, not queried. The middleware that serves the 410 runs on
// every request at the edge; calling our API from there would put the
// backend in the request path of the whole site, which is exactly what
// CAMP-31 and CAMP-39 went out of their way to avoid. The list changes
// once a week, with the import, and the site is rebuilt then anyway.
//
// ⚠️ Ceiling. This ends up bundled into the middleware, and edge
// runtimes cap that bundle (1 MB on Cloudflare Workers). A path is
// roughly 50 bytes, so tens of thousands fit — but if we ever get there,
// the list belongs in a KV store rather than in the bundle. The script
// refuses to write a file large enough to be a problem rather than
// letting a deploy fail for a reason nobody will connect to this.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'src', 'generated');
const MAX_BYTES = 256 * 1024;

const res = await fetch(`${API}/spots/gone`).catch((e) => {
  throw new Error(`Could not reach the API at ${API}: ${e.message}`);
});
if (!res.ok) {
  // 🔴 Fails the build. Writing an empty list here would silently turn
  // every gone campsite back into a 404 — a regression with no symptom
  // anyone would notice until a crawl report months later.
  throw new Error(`GET ${API}/spots/gone returned ${res.status}`);
}

const gone = await res.json();
const paths = gone.map((g) => g.path);
const body = JSON.stringify(paths, null, 2) + '\n';

// 🔴 Two files, one fetch, so they cannot disagree.
//
// The /gone page first got its own copy by calling the API itself, and
// Next served that call from its fetch cache — the middleware answered
// 410 for a campsite the page could not name, because the two had asked
// the same question at different times. The page now reads what this
// script wrote, in the same run that produced the middleware's list.

if (Buffer.byteLength(body) > MAX_BYTES) {
  throw new Error(
    `The gone list is ${Math.round(Buffer.byteLength(body) / 1024)} KB. ` +
      'It is bundled into the edge middleware and has outgrown that — ' +
      'move it to a KV lookup.',
  );
}

mkdirSync(out, { recursive: true });
// Only the paths for the middleware: it is bundled for the edge and has
// no use for names or distances.
writeFileSync(path.join(out, 'gone-paths.json'), body);
writeFileSync(path.join(out, 'gone.json'), JSON.stringify(gone, null, 2) + '\n');
console.log(`gone list: ${paths.length} path(s)`);
