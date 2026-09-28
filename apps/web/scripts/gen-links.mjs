#!/usr/bin/env node
// CAMP-144: the URLs of campsites that are now shown on another page,
// frozen at build time as a redirect map.
//
// 🔴 The same reasoning as gen-gone.mjs, and it is worth repeating
// because the temptation is stronger here: the middleware runs on every
// request at the edge, and asking the API for "where does this URL go
// now" per request would put the backend in the request path of the
// whole site. The list changes when the reconciler runs, which is when
// the site is rebuilt anyway.
//
// 🔴 A 301, not a 410. The campsite is open; its page moved. See
// SpotsService.links for why this is the one redirect this project is
// willing to make.
//
// ⚠️ Same edge-bundle ceiling as the gone list, and this one is far
// bigger — 2 986 pairs of paths on the first run, about 190 KB. The cap
// below is deliberately close to that, so the day it is crossed somebody
// reads this comment instead of debugging a deploy.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'src', 'generated');
const MAX_BYTES = 512 * 1024;

const res = await fetch(`${API}/spots/links`).catch((e) => {
  throw new Error(`Could not reach the API at ${API}: ${e.message}`);
});
if (!res.ok) {
  // 🔴 Fails the build rather than writing an empty map. An empty map
  // means every folded URL becomes a 404 — the pages stop being built
  // either way, so the only thing lost is the redirect, and losing it
  // silently is how a thousand working URLs die unnoticed.
  throw new Error(`GET ${API}/spots/links returned ${res.status}`);
}

const links = await res.json();

// 🔴 Lowercased on the way in, because the middleware lowercases the
// path it looks up. A key that only matches a path nobody sends is a
// redirect that never fires, and nothing would report it.
const map = {};
for (const { from, to } of links) {
  if (!from || !to || from === to) continue;
  map[from.toLowerCase()] = to;
}

// 🔴 Not pretty-printed, unlike the gone list. Measured on the first
// run: 300 868 bytes indented against 288 923 compact — 12 KB of a 1 MB
// edge budget, for whitespace in a file no person reads. It is
// generated, gitignored and consumed by a Map constructor.
//
// (12 KB, not the 110 KB a first guess suggested: the paths themselves
// are almost the entire file, so the saving is small. It is taken
// because it is free, not because it solves the ceiling — 2 986 links
// already use 29% of the budget, and CAMP-128's feed will add more.)
const body = JSON.stringify(map) + '\n';
if (Buffer.byteLength(body) > MAX_BYTES) {
  throw new Error(
    `The redirect map is ${Math.round(Buffer.byteLength(body) / 1024)} KB. ` +
      'It is bundled into the edge middleware and has outgrown that — ' +
      'move it to a KV lookup.',
  );
}

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'spot-redirects.json'), body);
console.log(`redirect map: ${Object.keys(map).length} URL(s)`);
