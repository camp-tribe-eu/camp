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
// bigger. The cap below is 512 KB and stops a deploy before the bundle
// itself is in trouble.
//
// 🔴 MEASURED, WITH THE DATE, because the number here was wrong for
// months. It said "2 986 links already use 56% of the cap", which was
// true on the first run and nowhere near true afterwards:
//
//     first run              2 986 pairs   288 923 bytes   55.1%
//     12.10.2026             4 439 pairs   419 354 bytes   80.0%
//
// A path is roughly 95 bytes once both sides are counted, so the room
// left on that date was about 1 100 more pairs. One ordinary run of the
// reconciler has added more than that: CAMP-274 made 1 457 links in one
// pass. Which is why the size is now printed on EVERY build and warned
// about from 75%, instead of appearing for the first time in the run
// that refuses to deploy.

import { mkdirSync, writeFileSync } from 'node:fs';
import { enforceEdgeBudget } from './edge-budget.mjs';
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
// because it is free, not because it solves the ceiling — see the
// measured share at the top of this file, which is where that number
// now lives so there is one of it.)
const body = JSON.stringify(map) + '\n';
enforceEdgeBudget('redirect map', body, MAX_BYTES);

mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'spot-redirects.json'), body);
console.log(`redirect map: ${Object.keys(map).length} URL(s)`);
