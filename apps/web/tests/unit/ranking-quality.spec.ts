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
});
