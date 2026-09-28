import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { EXONYMS, fold, search, searchText, type SearchDoc } from '@/lib/search';

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

  test('🔴 CAMP-140: `camping tolmin` answers in Tolmin, and says Tolmin', () => {
    // The card's acceptance, in one assertion.
    //
    // CAMP-137 got the first half: the region key put `Kamp Siber`
    // first, in the region `tolmin`. The sentence under it went on
    // saying «489 m from Kmetijska zadruga Tolmin» — a co-operative
    // FROM Tolmin with a shop in Bovec, true and useless — because the
    // ordering key and the label were one number.
    //
    // 🔴 Both halves, deliberately. Asserting only the label would pass
    // if the split leaked into the sort and the right campsite stopped
    // coming first; asserting only the region is the test that already
    // existed and that this card did not need.
    const [top] = search(docs!, 'camping tolmin', { limit: 1 });
    expect(top, 'camping tolmin returns nothing').toBeDefined();
    expect(
      top.doc.region,
      `top hit is ${top.doc.name} [${top.doc.region}/${top.doc.country}]`,
    ).toBe('tolmin');
    expect(
      fold(top.label?.name ?? ''),
      `labelled "${top.label?.name}", ordered on ${top.metres} m from "${top.nearest}"`,
    ).toBe('tolmin');
  });

  test('🔴 CAMP-140: the label never reaches the ordering key', () => {
    // 🔴 The guard that would catch the change that was reverted.
    //
    // `label.m` is the distance to the best-NAMED place and `metres` is
    // the distance to the NEAREST one. The first may be any size; the
    // second is a minimum over the same set, so it can never be the
    // larger of the two. If a later change lets the label decide the
    // ordering, that inequality is the first thing to break — and with
    // it goes the page's one rule about numbers, which is that a
    // distance is printed only when it is the one the row was sorted
    // on (`isNearest`).
    //
    // Measured 28.09.2026 on the live index, main against this branch,
    // over the 500-query geometric corpus below: every one of the 500
    // answers identical, whole page identical on all 500 (path, metres
    // and score for 20 rows), 23 queries over 25 km before and 23
    // after. The label diverges from the nearest match on 268 of 4 724
    // result lines, 5.7%.
    const { places } = solvePlaces(docs as (SearchDoc & { lat?: number; lon?: number })[]);
    const sample = Array.from({ length: 200 }, (_, i) =>
      places[Math.floor((i * places.length) / 200)],
    );
    const wrong: string[] = [];
    let labelled = 0;
    let diverged = 0;
    for (const p of sample) {
      for (const h of search(docs!, `camping ${p.word}`, { limit: 20 })) {
        if (h.label === undefined) {
          // A hit with no label has no distance either: they come from
          // the same walk over the same places.
          if (h.metres !== undefined) wrong.push(`${p.word}: metres with no label`);
          continue;
        }
        labelled++;
        if (h.metres === undefined) {
          wrong.push(`${p.word}: label with no metres`);
        } else if (h.label.m < h.metres) {
          wrong.push(
            `${p.word}: labelled ${h.label.name} at ${h.label.m} m, nearer than the ` +
              `${h.metres} m it was ordered on`,
          );
        } else if (h.label.isNearest !== (h.label.m === h.metres)) {
          wrong.push(
            `${p.word}: isNearest ${h.label.isNearest} with ${h.label.m} m against ${h.metres} m`,
          );
        }
        if (!h.label.isNearest) diverged++;
      }
    }
    // 🔴 An empty loop is a pass that measured nothing. And a branch
    // where nothing ever diverges is a branch where this card did not
    // ship: the whole point is that the two answers differ sometimes.
    expect(labelled, 'no labelled hits at all').toBeGreaterThan(1_000);
    expect(diverged, 'the label never differs from the nearest match').toBeGreaterThan(0);
    expect(wrong.slice(0, 5)).toEqual([]);
  });

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
  test('🔴 the geometric floor: what search OFFERS is in the right place', () => {
    // 🔴 Read the title carefully: this guards the candidate set, NOT
    // the order. It was first written as a ranking guard and it was
    // decoration — measured, it passes on main, it passes with the
    // region key deleted, and it passes when the result list is
    // REVERSED so the worst candidate is shown first. Anything that
    // survives that is not testing an ordering.
    //
    // The reason is arithmetic rather than bad luck: for most places
    // every document that matches at all is already within 25 km, so
    // any permutation of the same candidates clears the bar. The 19
    // answers this card actually moves are 0.45% of the corpus.
    //
    // What it DOES guard is the matching rule CAMP-132 introduced:
    // force `required` back to every term and this drops to 64%, with
    // 128 queries returning nothing at all. That is worth a test — a
    // search that answers `camping <town>` with something in the wrong
    // country is broken in a way no unit fixture would show — so it is
    // kept, under a name that says what it is.
    //
    // 🔴 And the honest note this file owes its next reader: the only
    // test here that can tell this branch from main is the region
    // corpus above, and that one scores "is the top hit in the region
    // the query named", which is the signal restated. The independent
    // judge cannot see the change; the circular one can. The before and
    // after live in the pull request, measured with this same geometry.
    const withCoords = docs as (SearchDoc & { lat?: number; lon?: number })[];
    const { places, hav } = solvePlaces(withCoords);
    expect(places.length, 'too few places resolved to measure anything')
      .toBeGreaterThan(2_000);

    // Spread across the whole list, not the first N. The index arrives
    // ordered by country, so a prefix is the alphabetically-first
    // countries — measured, `slice(0, 400)` was at/be/cy/cz/de and
    // contained not one of the cases this card is about.
    const step = Math.ceil(places.length / 400);
    const sample = places.filter((_, i) => i % step === 0);
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

  test('🔴 CAMP-136: an English city name lands on that city, in metres', () => {
    // 🔴 Judged by the geometry, because everything else here is
    // circular for this card.
    //
    // The region corpus scores "is the top hit in the region the query
    // named" — and the exonym table's whole effect is to make campsites
    // in `napoli` and `roma` match, so that corpus would applaud itself.
    // The place corpus scores against `text`, which is the very field
    // the alias now reaches. Both are blind here in the useful
    // direction and flattering in the useless one.
    //
    // `solvePlaces` is not: it resolves each place's real coordinates
    // from the distances four or more campsites record to it, and knows
    // nothing of names, regions or scores. It resolves the LOCAL word —
    // `nurnberg`, `sevilla` — and then this asks where searching the
    // ENGLISH word puts the reader. Measured 27.09.2026 against main:
    //
    //   brunswick  (nothing) →   2 km      nuremberg  338 km →  22 km
    //   dunkirk      325 km  →   2 km      ostend     757 km →   3 km
    //   genoa        709 km  →   9 km      seville  1 408 km →   2 km
    //   mantua       418 km  →   2 km
    //
    // 🔴 Only 8 of the 22 entries can be judged this way at all, and
    // `cologne` is the eighth. The solver needs a place whose name is a
    // single word with four or more sightings, and «München»,
    // «Firenze», «Warszawa» never appear alone — they are always
    // «Grafing bei München», «Firenze Rovezzano». So this is a floor
    // under seven cities, not a report card on all twenty-two; the rest
    // are in the pull request, measured the only way they can be.
    const withCoords = docs as (SearchDoc & { lat?: number; lon?: number })[];
    const { places, hav } = solvePlaces(withCoords);
    const at = new Map(places.map((p) => [p.word, p]));

    // 🔴 `cologne` is named here rather than quietly filtered out.
    //
    // It is the one entry whose top hit this card does NOT move: «La
    // Cologne» is a stream in the Somme with a campsite 294 m from it,
    // Köln's nearest is 1 688 m from «Köln-Dellbrück», the two spellings
    // score the same and the shorter walk wins. 306 km before, 306 km
    // after. It stays in the table because it takes `cologne` from 3
    // hits, all French, to 21 with 18 of them in Köln — and it stays
    // out of this assertion because freezing a defect in a test is how
    // it stops being a defect anybody remembers.
    const KNOWN_WRONG = new Set(['cologne']);

    const judged: string[] = [];
    const failed: string[] = [];
    for (const [english, local] of EXONYMS) {
      const p = at.get(local);
      if (!p || KNOWN_WRONG.has(english)) continue;
      const top = search(docs!, english, { limit: 1 })[0]?.doc as
        | (SearchDoc & { lat?: number; lon?: number })
        | undefined;
      const km =
        top?.lat === undefined || top.lon === undefined
          ? Number.POSITIVE_INFINITY
          : hav(p.lat, p.lon, top.lat, top.lon) / 1000;
      judged.push(`${english} ${km.toFixed(0)} km`);
      if (km > 50) {
        failed.push(
          `${english} → ${top?.name ?? '(nothing)'} [${top?.country ?? '-'}], ` +
            `${km.toFixed(0)} km from ${local}`,
        );
      }
    }

    // 🔴 An empty loop is a failure, not a pass. If the index moves
    // under this and no local word resolves any more, the assertion
    // below would be vacuously true and this test would go on being
    // green while measuring nothing.
    expect(
      judged.length,
      `only ${judged.length} of ${EXONYMS.size} entries could be judged geometrically`,
    ).toBeGreaterThanOrEqual(5);
    expect(failed, `judged: ${judged.join(', ')}`).toEqual([]);
  });

  test('🔴 CAMP-136: the English name reaches everything the local name reaches', () => {
    // 🔴 Recall, not ranking, and the two need separate guards.
    //
    // This is the card's own sentence made checkable: «naples 0
    // campsites, napoli 37». Every campsite the local spelling finds
    // must also be found by the English one, because the alias adds a
    // spelling rather than choosing between them. Reordering cannot
    // satisfy it and reordering cannot break it, which is what makes it
    // worth having next to the geometry above.
    //
    // Measured 27.09.2026, what main misses of the local spelling's own
    // answers: rome 277 of 277, venice 174 of 175, ostend 44 of 44,
    // naples 37 of 37 — and, for five of the twenty-two, nothing at
    // all, because main's fuzzy band already returned those documents
    // and merely buried them. So this test is silent about `genoa`,
    // `lisbon`, `milan`, `nuremberg` and `seville`; the geometric test
    // above covers three of those five and the country check below the
    // other two.
    const missing: string[] = [];
    for (const [english, local] of EXONYMS) {
      const big = { limit: 1_000_000 };
      const found = new Set(
        search(docs!, english, big).map((h) => h.doc.path),
      );
      const want = search(docs!, local, big).map((h) => h.doc.path);
      expect(want.length, `${local} finds nothing to compare against`)
        .toBeGreaterThan(0);
      const lost = want.filter((p) => !found.has(p));
      if (lost.length > 0) {
        missing.push(`${english} misses ${lost.length}/${want.length} of ${local}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('🔴 CAMP-136: and the first answer is in the right country', () => {
    // 🔴 The weakest of the three guards, and the only one that reaches
    // all of them.
    //
    // A country is not a signal this ranking optimises for — CAMP-131
    // measured the country contributing 6 matches in 4 277 and took it
    // out of the region key — so «which country did the reader land
    // in» is close to an outside opinion. It is not geometry, and
    // `milan` and `lisbon` are here because geometry cannot reach them:
    // «Milano» and «Lisboa» never appear as a place name on their own,
    // so `solvePlaces` never resolves them.
    //
    // On main these answer: milan → de («Zum Roten Milan», a pub in
    // Brandenburg), lisbon → fr («Le Lison»), genoa → fr, seville → fr,
    // bruges → fr, vienna → de, hague → fr, ostend → cz, padua → ee,
    // munich → at, athens → be, gothenburg → pl, dunkirk → nl, warsaw
    // and brunswick → nothing at all.
    const EXPECTED: Record<string, string> = {
      athens: 'gr', bruges: 'be', brunswick: 'de', dunkirk: 'fr',
      florence: 'it', genoa: 'it', gothenburg: 'se', hague: 'nl',
      lisbon: 'pt', mantua: 'it', milan: 'it', munich: 'de',
      naples: 'it', nuremberg: 'de', ostend: 'be', padua: 'it',
      rome: 'it', seville: 'es', venice: 'it', vienna: 'at',
      warsaw: 'pl',
    };
    // 🔴 `cologne` is the one entry with no line here. Its top hit is
    // and stays French — see the geometric test above for why, and the
    // comment over the table for why the entry is kept anyway. Writing
    // `cologne: 'fr'` would turn a defect into a requirement.
    expect(
      [...EXONYMS.keys()].filter((k) => !(k in EXPECTED)),
      'an entry with no expected country — add it, or say why not',
    ).toEqual(['cologne']);

    const wrong: string[] = [];
    for (const [english, cc] of Object.entries(EXPECTED)) {
      const top = search(docs!, english, { limit: 1 })[0]?.doc;
      if (top?.country !== cc) {
        wrong.push(
          `${english} → ${top?.name ?? '(nothing)'} [${top?.country ?? '-'}], wanted ${cc}`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });
});
