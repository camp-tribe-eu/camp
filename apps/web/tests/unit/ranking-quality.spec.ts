import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { fold, search, searchText, type SearchDoc } from '@/lib/search';

// CAMP-132 — a measurement, not an opinion.
//
// 🔴 Why this exists.
//
// Search ranking is the one part of this project where "it feels
// better" is easy to say and impossible to check. CAMP-131 improved it
// and broke one query while fixing ninety-seven — a trade that is only
// defensible because somebody counted. Every change after it has to
// show the same arithmetic.
//
// 🔴 It runs against the REAL index, not a fixture.
//
// The defect this card is about only exists at scale: "camping" is an
// exact word in 31% of campsites and "bovec" in 0.04%, and a fixture of
// fifty invented documents cannot reproduce that distribution. The file
// is cached beside the test; without it the suite skips rather than
// pretending to measure something.
//
//   curl -H "x-build-token: $TOKEN" localhost:3001/spots/search-index \
//     -o <scratchpad>/search-index.json
//
// The path comes from RANKING_INDEX so CI and a laptop can differ.

const INDEX =
  process.env.RANKING_INDEX ??
  path.join(
    process.env.TMPDIR ?? '/tmp',
    'claude-501/-Users-george-Documents-UTD-Claude------Camping',
    '89858e8b-4a6c-4c23-9782-7ef21e28cd10/scratchpad/search-index.json',
  );

interface Row {
  name: string | null;
  country: string;
  region: string;
  slug: string;
  near: { name: string; m: number }[];
}

function load(): SearchDoc[] | null {
  if (!fs.existsSync(INDEX)) return null;
  const rows = JSON.parse(fs.readFileSync(INDEX, 'utf8')) as Row[];
  return rows.map((r) => ({
    kind: 'campsite' as const,
    name: r.name ?? '',
    path: `/camping/${r.country}/${r.region}/${r.slug}`,
    country: r.country,
    region: r.region,
    near: r.near,
    text: searchText({
      name: r.name ?? '',
      region: r.region,
      country: r.country,
      near: r.near,
    }),
  }));
}

const docs = load();

test.describe('ranking quality, measured on the live index', () => {
  test.skip(
    docs === null,
    `no index cached at ${INDEX} — see the comment at the top of this file`,
  );

  test('🔴 a two-word query is not decided by the common word', () => {
    // 🔴 What "correct" means here, and why the obvious assertion is a
    // trap.
    //
    // The first version of this test asserted the top hit was Slovenian
    // — and it passed while the answer was still wrong. `Glamping
    // VIRJE` is Slovenian, so the test went green, but the campsite a
    // reader typing `camping bovec` is looking for is **Camp Bovec**,
    // and it was not in the results at all: it does not contain the
    // word "camping" ("Camp" is not "camping"), so an AND over terms
    // excluded it before ranking ever ran. Measured on the live index:
    // 22 campsites are genuinely near Bovec and NOT ONE of them
    // contains "camping" exactly.
    //
    // So the assertion has to name the real answer: the top hit must be
    // a campsite that is actually near Bovec, or actually called it.
    const hits = search(docs!, 'camping bovec', { limit: 5 });
    expect(hits.length, 'no results at all').toBeGreaterThan(0);

    const nearBovec = (d: SearchDoc) =>
      d.text.split(' ').includes('bovec') ||
      (d.near ?? []).some((p) => fold(p.name).split(' ').includes('bovec'));

    const truth = docs!.filter(nearBovec);
    expect(truth.length, 'the index knows of no campsite near Bovec').
      toBeGreaterThan(0);

    const first = hits[0];
    expect(
      nearBovec(first.doc),
      `first result is ${first.doc.name} [${first.doc.country}], which is ` +
        `not near Bovec; top 5: ${hits
          .map((h) => `${h.doc.name} [${h.doc.country}]`)
          .join(' | ')}`,
    ).toBe(true);
  });

  test('a one-word place query still finds that place', () => {
    for (const [q, cc] of [
      ['bovec', 'si'],
      ['bled', 'si'],
      ['zadar', 'hr'],
    ] as const) {
      const hits = search(docs!, q, { limit: 3 });
      expect(hits.length, `${q}: nothing`).toBeGreaterThan(0);
      expect(
        hits[0].doc.country,
        `${q}: first is ${hits[0].doc.name} [${hits[0].doc.country}]`,
      ).toBe(cc);
    }
  });
});
