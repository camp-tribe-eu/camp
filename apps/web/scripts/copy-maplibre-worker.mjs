#!/usr/bin/env node
// CAMP-31: put MapLibre's worker where the browser can actually fetch it.
//
// 🔴 Why this exists. maplibre-gl 6 is ESM-only and spawns its parser in
// a module worker: `new Worker(url, { type: 'module' })`, where the url
// is resolved through `import.meta.url`. Next's bundler does not rewrite
// that, so the browser asks for a path that does not exist, gets the
// HTML 404 page back, and refuses it with "non-JavaScript MIME type of
// text/html".
//
// The symptom is not an obvious crash. The map appears, the controls
// work, raster layers even render — and every VECTOR layer is silently
// missing, because parsing vector tiles is exactly what the worker does.
// It looks like a styling problem, or like the data failed to load.
//
// So the two files are copied next to each other in public/ and the app
// points `setWorkerUrl` at them. They must stay siblings: the worker
// imports './maplibre-gl-shared.mjs' by relative path.
//
// Copied per build rather than committed, so they cannot drift from the
// installed version after an upgrade.

import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.dirname(require.resolve('maplibre-gl/dist/maplibre-gl-worker.mjs'));
const out = path.join(here, '..', 'public', 'maplibre');

mkdirSync(out, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(path.join(dist, file), path.join(out, file));
}
console.log('maplibre worker copied to public/maplibre/');
