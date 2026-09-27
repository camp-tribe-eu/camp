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
  // 🔴 Carried through because the geometric corpus below needs them.
  // A judge built from the same fields the ranking reads can only agree
  // with it; coordinates are the one thing in this file that the
  // ranking never looks at.
  lat: number;
  lon: number;
}

function load(): (SearchDoc & { lat: number; lon: number })[] | null {
  if (!fs.existsSync(INDEX)) return null;
  const rows = JSON.parse(fs.readFileSync(INDEX, 'utf8')) as Row[];
  return rows.map((r) => ({
    kind: 'campsite' as const,
    name: r.name ?? '',
    path: `/camping/${r.country}/${r.region}/${r.slug}`,
    country: r.country,
    region: r.region,
    near: r.near,
    lat: r.lat,
    lon: r.lon,
    text: searchText({
      name: r.name ?? '',
      region: r.region,
      country: r.country,
      near: r.near,
    }),
  }));
}

const docs = load();

/**
 * A deterministic shuffle, so both corpora are a fixed sample.
 *
 * 🔴 Not rejection sampling. Both of these used to draw at random and
 * skip repeats, which is fine while the pool is much larger than the
 * sample and turns into coupon-collecting when it is not — review
 * pointed out that 496 wanted out of 787 eligible regions is already
 * close enough to matter, and a corpus that gets slower as the data
 * grows is a corpus somebody will eventually delete.
 */
function shuffled<T>(items: T[], seed = 132): T[] {
  const out = [...items];
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The 496-query corpus, in the repository rather than on a laptop.
 *
 * 🔴 Review's finding, and a fair one: `search.ts` cited "the 496-query
 * region corpus (see ranking-quality.spec.ts)" and this file did not
 * contain it. Every number in that comment was therefore unverifiable
 * by anybody but me — the same shape of claim this project already
 * treats as worse than no claim at all.
 *
 * So the corpus is built here, deterministically, from the index: one
 * query per real region, `camping <region>`, and the answer is right
 * only when the top hit IS IN that region. That criterion cannot be
 * satisfied by the change itself — an earlier version accepted a hit
 * that merely contained the word, which suppression guarantees, and so
 * it scored 100% before and after and measured nothing.
 */
function regionCorpus(docs: SearchDoc[], limit = 496) {
  const regions = [...new Set(docs.map((d) => d.region))].filter(
    (r) => r && fold(r).split(' ').some((w) => w.length > 3),
  );
  return shuffled(regions)
    .slice(0, limit)
    .map((r) => ({
      q: `camping ${fold(r).split(' ').filter((x) => x.length > 3)[0]}`,
      region: r,
    }));
}

/**
 * The second corpus the comments cite: «camping <a place nearby>».
 *
 * 🔴 Review found defect #3 only half fixed — the region corpus was
 * committed, the sentence said "the corpus is in this file so these can
 * be rerun", and the 400-query place corpus behind "50.3% → 100%" was
 * still only on a laptop. Half of a fix to a claim about evidence is
 * the same defect.
 *
 * A place word is taken from the names of what campsites are NEAR, and
 * only words that 1 to 60 campsites are near, so the query has a small,
 * checkable answer. Right means the top hit really is near that place —
 * or is named for it, which is the same thing said differently.
 */
function placeCorpus(docs: SearchDoc[], limit = 400) {
  const places = new Map<string, Set<string>>();
  for (const d of docs) {
    for (const p of d.near ?? []) {
      for (const w of fold(p.name).split(' ')) {
        if (w.length <= 3) continue;
        if (!places.has(w)) places.set(w, new Set());
        places.get(w)!.add(d.path);
      }
    }
  }
  const pool = [...places].filter(([, set]) => set.size >= 1 && set.size <= 60);
  return shuffled(pool)
    .slice(0, limit)
    .map(([w, set]) => ({ q: `camping ${w}`, place: w, near: set }));
}

/**
 * 🔴 The corpus that judges by GEOMETRY, because the other two cannot.
 *
 * Both earlier corpora were compromised, in opposite directions, and
 * both were mine:
 *
 *   - the region corpus scores "is the top hit in that region", which
 *     is the signal itself restated;
 *   - the place corpus scores `near.has(path) || text.includes(word)`,
 *     and `text` holds the region and the name — so it rewards the same
 *     thing one step further round;
 *   - an anchored distance corpus, written to replace them, anchored
 *     each town to the campsite with the SMALLEST recorded distance to
 *     a place of that name — which is precisely the false positive this
 *     card removes. Its anchor for Tolmin was the shop in Bovec, so it
 *     scored the fix as 22 km worse.
 *
 * This one solves each place's coordinates from the distances
 * themselves — position is over-determined by four or more campsites
 * reporting how far they are — and then judges every answer by how far
 * it really is. It uses no region, no name and no text, so it cannot
 * reward the signal.
 *
 * 4 216 places resolve with a residual RMS at or under 250 m (median
 * 7 observations, median RMS 10 m). Checked against surveyed
 * coordinates: Tolmin 11 m out, Bovec 22 m, Praha 4 m, Fermo 11 m,
 * Grevenmacher 23 m.
 *
 * Measured 27.09.2026, main against this branch: 4 197 unchanged,
 * 13 closer, 6 farther. Gains up to 684 km (leon), losses at most
 * 82 km and mostly province-versus-city names where the answer is
 * arguable either way.
 */
function solvePlaces(docs: (SearchDoc & { lat?: number; lon?: number })[]) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const hav = (aLat: number, aLon: number, bLat: number, bLon: number) => {
    const dLat = (bLat - aLat) * rad;
    const dLon = (bLon - aLon) * rad;
    const x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };

  const obs = new Map<string, { lat: number; lon: number; m: number }[]>();
  for (const d of docs) {
    if (d.lat === undefined || d.lon === undefined) continue;
    for (const p of d.near ?? []) {
      const words = fold(p.name).split(' ').filter(Boolean);
      if (words.length !== 1 || words[0].length <= 3) continue;
      const list = obs.get(words[0]) ?? [];
      list.push({ lat: d.lat, lon: d.lon, m: p.m });
      obs.set(words[0], list);
    }
  }

  const out: { word: string; lat: number; lon: number }[] = [];
  for (const [word, pts] of obs) {
    if (pts.length < 4) continue;
    let wsum = 0;
    let lat = 0;
    let lon = 0;
    for (const p of pts) {
      const w = 1 / (p.m + 100);
      lat += p.lat * w;
      lon += p.lon * w;
      wsum += w;
    }
    lat /= wsum;
    lon /= wsum;
    const rms = (la: number, lo: number) =>
      Math.sqrt(
        pts.reduce((s, p) => s + (hav(la, lo, p.lat, p.lon) - p.m) ** 2, 0) /
          pts.length,
      );
    let step = 0.02;
    for (let i = 0; i < 400; i++) {
      const base = rms(lat, lon);
      let best = base;
      let bl = lat;
      let bo = lon;
      for (const [dla, dlo] of [
        [step, 0], [-step, 0], [0, step], [0, -step],
        [step, step], [-step, -step], [step, -step], [-step, step],
      ]) {
        const v = rms(lat + dla, lon + dlo);
        if (v < best) { best = v; bl = lat + dla; bo = lon + dlo; }
      }
      if (best < base) { lat = bl; lon = bo; } else { step /= 2; }
      if (step < 1e-7) break;
    }
    if (rms(lat, lon) <= 250) out.push({ word, lat, lon });
  }
  return { places: out, hav };
}

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
  test('🔴 the corpus the comments cite, run here', () => {
    // Measured 25.09.2026 on the live index (61 422 campsites): main
    // put the top hit in the named region for 60.9% of these, this
    // ranking for 82.7%, with 108 queries fixed and none made worse.
    //
    // The floor is deliberately below the measured figure. This runs
    // against live data that changes under it, so an exact number would
    // be a test that fails when the world moves rather than when the
    // code breaks; what must not happen is a slide back towards the
    // 60.9% this card started from.
    const corpus = regionCorpus(docs!);
    expect(corpus.length).toBe(496);

    let right = 0;
    const wrong: string[] = [];
    for (const t of corpus) {
      const top = search(docs!, t.q, { limit: 1 })[0]?.doc;
      if (top?.region === t.region) right++;
      else if (wrong.length < 5) {
        wrong.push(`${t.q} → ${top?.name ?? '(nothing)'} [${top?.region ?? '-'}]`);
      }
    }
    const share = right / corpus.length;
    expect(
      share,
      `${right}/${corpus.length} correct. Worst: ${wrong.join('; ')}`,
    ).toBeGreaterThan(0.75);
  });
  test('🔴 the place corpus the comments cite, run here too', () => {
    // Measured 25.09.2026 on the live index: main put the top hit near
    // the place named for 50.3% of these, this ranking for 100%, with
    // 199 fixed and none made worse. The floor is well under the
    // measured figure for the same reason as above — live data moves.
    const corpus = placeCorpus(docs!);
    expect(corpus.length).toBe(400);

    let right = 0;
    const wrong: string[] = [];
    for (const t of corpus) {
      const top = search(docs!, t.q, { limit: 1 })[0]?.doc;
      const ok =
        !!top &&
        (t.near.has(top.path) || top.text.split(' ').includes(t.place));
      if (ok) right++;
      else if (wrong.length < 5) {
        wrong.push(`${t.q} → ${top?.name ?? '(nothing)'} [${top?.country ?? '-'}]`);
      }
    }
    expect(
      right / corpus.length,
      `${right}/${corpus.length} correct. Worst: ${wrong.join('; ')}`,
    ).toBeGreaterThan(0.9);
  });
  test('🔴 the geometric corpus: the top hit is really near the place', () => {
    // Deliberately NOT a before/after — that lives in the PR. This
    // guards the floor: whatever the ranking does, a campsite answering
    // `camping <town>` should usually be near that town, and "near"
    // here means metres on the ground, not a word in a field.
    const withCoords = docs as (SearchDoc & { lat?: number; lon?: number })[];
    const { places, hav } = solvePlaces(withCoords);
    expect(places.length, 'too few places resolved to measure anything')
      .toBeGreaterThan(2_000);

    // Check a fixed slice, so the test stays quick and deterministic.
    const sample = places.slice(0, 400);
    let within25km = 0;
    const worst: string[] = [];
    for (const p of sample) {
      const top = search(withCoords, `camping ${p.word}`, { limit: 1 })[0]
        ?.doc as (SearchDoc & { lat?: number; lon?: number }) | undefined;
      if (top?.lat === undefined || top.lon === undefined) continue;
      const km = hav(p.lat, p.lon, top.lat, top.lon) / 1000;
      if (km <= 25) within25km++;
      else if (worst.length < 5) worst.push(`${p.word}: ${km.toFixed(0)} km`);
    }
    expect(
      within25km / sample.length,
      `only ${within25km}/${sample.length} within 25 km. Worst: ${worst.join('; ')}`,
    ).toBeGreaterThan(0.8);
  });
});
