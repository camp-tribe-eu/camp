#!/usr/bin/env node
// CAMP-73: start every build from current data.
//
// 🔴 Why this is necessary, found the hard way.
//
// Every page fetches from the API with `next: { revalidate: 86400 }`,
// and Next keeps those responses in .next/cache between builds. Inside
// one build that is exactly what we want: 289 campsite pages ask for the
// same index once instead of 289 times.
//
// Across builds it is wrong, and it is wrong silently. A campsite was
// marked as dropped from OpenStreetMap, the build ran, and the site came
// out contradicting itself: the middleware answered 410 at that URL
// while the sitemap still listed it and the map still drew its point —
// because the list of gone campsites is produced by a script that
// fetches directly, and everything else came out of a cache written
// before the campsite disappeared.
//
// That is not a stale-data inconvenience. A sitemap that advertises a
// URL we answer 410 for is us asking Google to crawl something we are
// telling it to forget, and it would have been found months later in a
// crawl report, if at all.
//
// The import runs weekly and the site is rebuilt after it, so a build is
// a snapshot of the data at that moment. Nothing about that is helped by
// remembering what the API said yesterday.

import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = path.join(here, '..', '.next', 'cache', 'fetch-cache');

rmSync(cache, { recursive: true, force: true });
console.log('fetch cache cleared — this build reads current data');
