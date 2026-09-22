// CAMP-39: which pages Lighthouse actually visits.
//
// 🔴 Computed from the built sitemap, not typed out. The URL list was
// hard-coded and broke twice when deduplication elected different
// winners and the slugs moved — a config pinned to a slug tests today's
// import rather than the site. The sitemap is the site's own answer to
// "which pages matter", so it is the right source.
//
// One page of each kind: the home page, the index, a country hub, a
// region hub and two campsites — enough to catch a template regression,
// few enough to keep CI quick.

const { readFileSync, existsSync } = require('node:fs');

const ORIGIN = 'http://localhost:3000';
const BUILT = '.next/server/app';

function locs(file) {
  if (!existsSync(file)) return [];
  return [...readFileSync(file, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => new URL(m[1]).pathname,
  );
}

const hubs = locs(`${BUILT}/sitemaps/hubs.xml.body`);
const spots = locs(`${BUILT}/sitemaps/campsites-0.xml.body`);

const pick = [
  '/',
  '/camping',
  hubs.find((p) => /^\/camping\/[a-z]{2}$/.test(p)),
  hubs.find((p) => /^\/camping\/[a-z]{2}\/[^/]+$/.test(p)),
  spots[0],
  spots[Math.floor(spots.length / 2)],
].filter(Boolean);

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'npm run start -- -p 3000',
      startServerReadyPattern: 'Ready in',
      url: [...new Set(pick)].map((p) => `${ORIGIN}${p}`),
      numberOfRuns: 3,
    },
    assert: {
      assertions: {
        'categories:accessibility': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.9 }],
        'categories:best-practices': ['warn', { minScore: 0.9 }],
        'categories:performance': ['warn', { minScore: 0.8 }],
      },
    },
    upload: { target: 'filesystem', outputDir: './.lighthouseci' },
  },
};
