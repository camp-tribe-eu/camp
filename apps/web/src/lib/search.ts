// CAMP-67: searching the site.
//
// 🔴 Where this runs, and why it is not an API call.
//
// The card proposes PostgreSQL full-text search, and that was written
// before the architecture settled: the whole web app now runs with the
// backend switched off (CAMP-39), and the map already solved the same
// problem by building a static file at build time (CAMP-31). A live
// search endpoint would mean a publicly reachable API, a CORS allowlist
// and a site that stops working the moment the API does — to answer a
// question we can answer from a file.
//
// So Postgres still produces the index, with PostGIS supplying the
// coordinates; the browser queries it. The card's staged plan is intact:
// no new dependency, no cost. Its MeiliSearch trigger becomes something
// measurable rather than a feeling — the build fails when the index
// outgrows a download (see app/data/search/index.json/route.ts).
//
// 🔴 Folding happens HERE, once, for both the index and the query.
//
// A reader typing "kamp kovac" must find "Kamp Kovač". That means the
// query has to be folded in the browser no matter where the index is
// built — so folding it a second time in SQL would be the same rule in
// two languages, which is the duplication that bit us on the map
// filters. One implementation, used on both sides, cannot disagree.

/**
 * Characters NFD does not decompose, measured against our own data.
 *
 * NFD handles č, š, ž and ć correctly — verified on the 145 accented
 * campsite names we hold. It does NOT touch `đ`, because that is a
 * distinct letter rather than d-plus-a-mark, and two Croatian campsites
 * depend on it. The rest of this list is the same class of letter in
 * languages our market list reaches.
 */
const LETTERS: Record<string, string> = {
  đ: 'd',
  Đ: 'd',
  ø: 'o',
  Ø: 'o',
  ł: 'l',
  Ł: 'l',
  ß: 'ss',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  ð: 'd',
  Ð: 'd',
  þ: 'th',
  Þ: 'th',
};

/** Lower-case, strip accents, and reduce anything else to a space. */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) out += LETTERS[ch] ?? ch;
  return out
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const terms = (query: string): string[] =>
  fold(query).split(' ').filter(Boolean);

/**
 * Levenshtein distance, capped.
 *
 * Capped because the answer "further apart than we care about" is the
 * only one we ever act on, and stopping early turns a quadratic walk
 * over a 1000-entry index into something a keystroke can afford.
 */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length];
}

/**
 * How many edits we forgive in a word of this length.
 *
 * 🔴 Zero for very short words on purpose. At three letters almost
 * everything is within one edit of everything else — "krk" would match
 * "park" — and a search that answers with anything is worse than one
 * that answers with nothing.
 */
export function tolerance(term: string): number {
  if (term.length <= 3) return 0;
  if (term.length <= 6) return 1;
  return 2;
}

// 🔴 CAMP-129 needs the country's NAME, not its code: the haystack has
// always held "France" rather than "fr", because that is what a reader
// types. Imported so the recipe below has exactly one definition.
import { countryName } from './api';

/**
 * CAMP-129: the string a query is matched against, defined ONCE.
 *
 * 🔴 It used to be shipped. `text` is `name` + `region` + the country's
 * name + the names of what is near — every one of which is already in
 * the same row. Measured 25.09.2026 on the live index: 2 436 KB of
 * 6 940 KB, 39%, spent sending the same words a second time.
 *
 * So it is derived on read. The catch is that a recipe used in two
 * places drifts, and a drift here is a search that quietly stops
 * matching what it used to — so there is one function, called by the
 * writer and by the reader, and the index route round-trips every chunk
 * through packIndex/unpackIndex on every build, comparing `text` field
 * by field.
 *
 * 🔴 That check was lost when the single file was split, and this
 * comment went on claiming it ran — for a while nothing under src/app
 * imported `unpackIndex` at all. Review caught it. A comment describing
 * a guard that does not exist is worse than no guard, because it stops
 * anyone looking for one.
 */
export function searchText(doc: {
  name: string;
  region: string;
  country: string;
  near: { name: string }[];
}): string {
  return fold(
    [
      doc.name,
      doc.region.replace(/-/g, ' '),
      countryName(doc.country),
      ...doc.near.map((n) => n.name),
    ].join(' '),
  );
}

export interface SearchDoc {
  /** `campsite` today; `route` and `guide` when those exist. */
  kind: 'campsite';
  name: string;
  path: string;
  /** Country code and region slug, for the line under the result. */
  country: string;
  region: string;
  /** Everything worth matching against, already folded. */
  text: string;
  /**
   * Places this campsite is near, with the distance in metres. This is
   * what makes "campsites near Bovec" order by distance rather than by
   * name — the numbers come from the context computed in CAMP-33.
   */
  near: { name: string; m: number }[];
}

export interface SearchHit {
  doc: SearchDoc;
  score: number;
  /**
   * Metres to the place the query named, when it named one. Present
   * only then, and it is what the ordering uses.
   */
  metres?: number;
  /**
   * WHICH place that was.
   *
   * 🔴 Shown to the reader, because the match may be fuzzy and
   * «436 m from what you searched» was then a false sentence. Naming
   * the place makes it true in every case and lets the reader see a
   * wrong match instantly.
   */
  nearest?: string;
}

/**
 * What a term match is worth, before rarity weighting.
 *
 * The bands are deliberately far apart so that a weaker kind of match
 * can never outrank a stronger one by accumulating: within one term, an
 * exact word beats any number of fuzzy ones.
 *
 * 🔴 Named because `search` has to recognise an exact match in two
 * separate decisions — whether to count it towards document frequency,
 * and whether the term still needs an edit distance — and comparing
 * against a bare `100` in two places is how they drift apart. They
 * already did once: one of them said `PREFIX` where it meant
 * `EXACT_WORD`, and a third copy of the same condition existed further
 * down and had to be deleted.
 */
const EXACT_WORD = 100;
const PREFIX = 60;

/**
 * When a word stops being a requirement and becomes a preference.
 *
 * 🔴 Both numbers are measured, not chosen. Swept over the 496-query
 * region corpus (see tests/unit/ranking-quality.spec.ts for what that
 * corpus is), counting queries whose top hit is NOT in the region named:
 *
 *   1%   2%   5%   10%   20%   40%
 *   86   86   86    86    86   200
 *
 * 🔴 These were 69/187 in an earlier version of this comment — numbers
 * from a corpus that lived on a laptop, cited above a sentence claiming
 * the corpus was in the spec file. Review caught the mismatch: the
 * table had never been re-measured against the corpus that is actually
 * committed. Same shape, different numbers, and the shape was never the
 * part in doubt.
 *
 * Anywhere below a fifth of the index gives the same answer, because
 * the words it catches are the same handful. At 40% it stops catching
 * `camping` — which is in 31.3% — so the word becomes a requirement
 * again and the result falls back towards the 181 this card started
 * from. The number has to sit below that 31.3% and above anything a
 * real place name reaches; 5% is the middle of a flat range, not a
 * tuned value.
 *
 * The absolute floor exists for small indexes. A share alone would call
 * every word in a two-document fixture "common" and stop requiring any
 * of them, which would quietly turn the AND off wherever the index is
 * small — including during the first seconds of a page load, while the
 * chunks are still arriving.
 */
const COMMON_SHARE = 0.05;
const COMMON_FLOOR = 50;

function strongScore(words: string[], term: string): number {
  // 🔴 The caller splits, not this function.
  //
  // It used to do `doc.text.split(' ')` itself, which meant splitting
  // every document once PER TERM. The pass below scores every term
  // against every document, so a three-word query split 61 422 strings
  // three times over. Splitting once per document and reusing the array
  // measured 196 ms → 157 ms for `camping les pins` while that was the
  // only saving; deferring the edit distance took the same query the
  // rest of the way down, to 36 ms.
  if (words.includes(term)) return EXACT_WORD;
  if (words.some((w) => w.startsWith(term))) return PREFIX;
  return 0;
}

/**
 * The near-miss band: 30 for one edit, 20 for two.
 *
 * 🔴 Separate from the above because it is usually not needed at all.
 *
 * This is the expensive half — an edit distance against every word of
 * every document — and the suppression rule below means its answer is
 * thrown away whenever the term matched something properly. So it is
 * only ever run for a term that matched NOTHING exactly or by prefix,
 * which is the case it exists for: a reader who mistyped.
 *
 * That makes the common case much cheaper than the pass it replaces,
 * despite visiting every document for every term. Measured on the live
 * index against main: `camping bovec` 124 ms → 50 ms, `bled` 72 ms →
 * 26 ms, `camping les pins` 108 ms → 36 ms.
 *
 * 🔴 It is NOT cheaper when it runs, and it runs more often than the
 * word "mistyped" suggests.
 *
 * When a term does need the edit distance, this second loop splits
 * every document's text a second time: review measured `bovek` about
 * 20% slower than main (the absolute milliseconds are machine-specific
 * and are deliberately not quoted here — two machines disagreed by 2x
 * on the same ratio).
 *
 * 🔴 The obvious fix does not work, so do not spend the afternoon on
 * it: keeping the split from the first pass and reusing it here was
 * measured at about 10% back (`kovak` 140 ms → 129 ms) in exchange for
 * holding 61 422 arrays of words alive for the length of every
 * keystroke. The cost is the edit distance itself, not the splitting.
 * Something that made this genuinely cheap would have to compare fewer
 * words — an index by first letter or by length — which is a different
 * change with its own measurements.
 *
 * And the branch is not rare. It is taken whenever no document contains
 * the term EXACTLY — which includes every half-typed word, not just
 * every wrong one. Review measured 13 254 intermediate keystrokes drawn
 * from real campsite names: 63.1% of them land on a term with no exact
 * match. So in a search box the expensive path is the majority, and
 * per keystroke this ranking costs roughly three quarters of what main
 * costs rather than the quarter that the fully-typed queries above
 * suggest.
 *
 * That is the trade, stated plainly: correctness first. The earlier
 * version of this comment claimed "every query that is spelled
 * correctly pays a third of what it used to", which was measured on
 * finished words and is false for the keystrokes that precede them.
 */
function fuzzyScore(words: string[], term: string): number {
  const allowed = tolerance(term);
  if (allowed === 0) return 0;

  let best = 0;
  for (const w of words) {
    // Only compare against words of a plausible length.
    if (Math.abs(w.length - term.length) > allowed) continue;
    const d = editDistance(w, term, allowed);
    if (d <= allowed) best = Math.max(best, 40 - d * 10);
  }
  return best;
}

/**
 * The nearest place a query named, and WHICH place it was.
 *
 * 🔴 The name comes back too, because the distance alone was being
 * shown as «436 m from what you searched» — and the match may be
 * fuzzy, so "what you searched" was sometimes a different real place.
 * Measured on the live index: 74 of 332 distances shown across 24 real
 * queries came from a fuzzy match. Searching `aire` put "55 m from what
 * you searched" beside a campsite whose nearby place is the river **La
 * Vire**; `camping bled` showed 14 410 m from "Superette Camping Terra
 * Verdon", matched on the word «camping».
 *
 * Forgiving a typo when ORDERING is right — somebody typing `bovek`
 * means Bovec, and the spec below says so. Claiming a distance from
 * "what you searched" is a different act: it is a statement about the
 * world. So the place is named, and the reader can see at once when the
 * match was not what they meant.
 */
function nearestNamed(
  doc: SearchDoc,
  ts: string[],
): { m: number; name: string } | undefined {
  // 🔴 The NEAREST match, as it always was.
  //
  // CAMP-137 briefly ranked these by how much of the place's name the
  // query explained, so that "499 m from Tolmin" would be shown instead
  // of "273 m from Kmetijska Zadruga Tolmin Trgovina Market Bovec".
  // That is a real improvement to the sentence and it was reverted,
  // because `m` is also the ordering key: choosing a better-named place
  // means choosing a LARGER number, and review measured the damage —
  // `camping fermo` promoted a campsite six times farther from Fermo,
  // `camping praha` moved the answer from 7.8 km to 24.5 km, and
  // `castellon` began showing a bigger distance to a one-edit fuzzy
  // match than to an exact one, inverting the bands this file calls
  // inviolable.
  //
  // Naming the place well and ordering by distance want two different
  // numbers out of this function, and giving them one is what went
  // wrong. CAMP-140 carries the split.
  let closest: { m: number; name: string } | undefined;
  for (const place of doc.near) {
    const words = fold(place.name).split(' ');
    const named = ts.some(
      (t) =>
        words.includes(t) ||
        words.some((w) => w.startsWith(t)) ||
        (tolerance(t) > 0 &&
          words.some((w) => editDistance(w, t, tolerance(t)) <= tolerance(t))),
    );
    if (named && (closest === undefined || place.m < closest.m)) {
      closest = { m: place.m, name: place.name };
    }
  }
  return closest;
}

export interface SearchOptions {
  limit?: number;
}

/**
 * 🔴 The card's acceptance criterion, in one function.
 *
 *   "запит із одруківкою знаходить потрібне" — the fuzzy band above.
 *   "пошук по назві місця повертає результати, відсортовані за
 *    відстанню, а не алфавітом" — when the query names a place a
 *    campsite is near, the ordering key becomes metres.
 *
 * Every term that narrows the answer must match. A second word is meant
 * to narrow, which is why this was an AND over all of them — but a word
 * in 31.3% of the index narrows nothing, and requiring it threw away the
 * right answer: `camping bovec` could not reach "Camp Bovec", because
 * "Camp" is not "camping". So common words became preferences and rare
 * words stayed requirements.
 *
 * Measured on the live index (61 422 campsites, 25.09.2026), by query
 * rather than by total — the corpus is in tests/unit/ranking-quality
 * .spec.ts so these can be rerun:
 *
 *   496 region queries, top hit must BE in the region named
 *                                   60.9% → 82.7%, 108 fixed, 0 worse
 *   400 place queries, top hit must be near the place named
 *                                   50.3% → 100%, 199 fixed, 0 worse
 *
 * 🔴 Not "no query made worse" in general — review built a wider corpus
 * (every region with at least five campsites, 562 of them) and found
 * one: `camping tolmin` used to answer with a campsite in Tolmin and
 * now answers with `Camp Bovec`, 40 km away, because a shop 273 m from
 * it is called "Kmetijska Zadruga Tolmin Trgovina Market Bovec". On
 * that corpus the trade is 42 better against 1 worse. The cause is
 * `nearestNamed` matching a term against any place name, which
 * CAMP-131 documented and this change made matter more often.
 */
export function search(
  docs: SearchDoc[],
  query: string,
  { limit = 20 }: SearchOptions = {},
): SearchHit[] {
  const ts = terms(query);
  if (ts.length === 0) return [];

  // 🔴 The pass collects everything the ranking needs to know.
  //
  // Per-term scores are kept rather than summed on the spot, because
  // summing immediately makes every word weigh the same — the defect
  // this card is about. Alongside them it counts, for each term, how
  // many documents contain it EXACTLY (its document frequency) and the
  // best score any document reached. Those two numbers decide
  // everything below, and neither can be known until the pass is over —
  // which is also why there is no early break on a term that fails.
  //
  // Only the cheap half runs here: an exact word or a prefix. The edit
  // distance is deferred, because whether it is needed at all is one of
  // the things this pass is working out.
  const scores: number[][] = new Array(docs.length);
  const exact = new Array<number>(ts.length).fill(0);
  const best = new Array<number>(ts.length).fill(0);

  for (let d = 0; d < docs.length; d++) {
    const words = docs[d].text.split(' ');
    const row = new Array<number>(ts.length);
    for (let i = 0; i < ts.length; i++) {
      const s = strongScore(words, ts[i]);
      if (s === EXACT_WORD) exact[i]++;
      if (s > best[i]) best[i] = s;
      row[i] = s;
    }
    scores[d] = row;
  }

  // 🔴 This one line is the whole near-miss rule.
  //
  // `tolerance()` allows one edit on a four-letter word, so `bleu`
  // matches `bled`. That is right when the reader mistyped and wrong
  // when they did not: measured on the live index, `bled` matched 99
  // documents, and of the 20 a reader is shown, 15 were not Slovenian —
  // 10 of them French sites beside places like "Segré-en-Anjou Bleu".
  // Once some document contains the word exactly, the near misses are
  // not competing with it; they are noise. So they are never computed.
  //
  // A genuine typo is untouched, because then no document contains the
  // word exactly and this is true.
  //
  // 🔴 EXACT_WORD, not PREFIX, and review had to find that twice. A
  // prefix is a guess about a word the reader has not finished typing;
  // it does not prove the word exists as typed. While this read
  // `best[i] < PREFIX`, ONE incidental word among 61 422 documents that
  // merely started with the typo switched near misses off for that
  // term: `kovak` returned six campsites on main including `Camp
  // Kovač`, and one here, because a Hungarian site called `Kovakő Camp`
  // prefixes it. The suite did not notice — the test that asserts
  // exactly this query runs against three documents, none of them
  // `kovakő`, which is the fixture-sized blind spot this file keeps
  // finding.
  //
  // (There was a second copy of this condition, a `floor` applied after
  // the pass, and review proved it could never change an outcome:
  // whenever it rose, this gate had already stopped the fuzzy scores
  // from existing, so it partitioned {0, 60, 100} exactly as `>= 1`
  // does. It was deleted. A comment explaining a guard that does not
  // guard is the thing this file warns about two screens up.)
  const needsFuzzy = ts.map(
    (t, i) => best[i] !== EXACT_WORD && tolerance(t) > 0,
  );
  if (needsFuzzy.some(Boolean)) {
    for (let d = 0; d < docs.length; d++) {
      const words = docs[d].text.split(' ');
      for (let i = 0; i < ts.length; i++) {
        // 🔴 Fill in a blank; never overwrite a real score.
        //
        // This read `if (needsFuzzy[i])` and clobbered the value. It was
        // safe only while this pass ran exclusively for terms nothing
        // matched at all — and the moment the gate above was widened to
        // "no EXACT match", a term could arrive here with prefix
        // matches already scored 60, which a fuzzy 30 then erased.
        // Measured: `kovak` returned all six hits tied on one score,
        // so `Kovakő Camp` — the only one that really starts with the
        // word — ranked level with five near misses instead of above
        // them.
        if (needsFuzzy[i] && scores[d][i] === 0) {
          scores[d][i] = fuzzyScore(words, ts[i]);
        }
      }
    }
  }

  const n = docs.length;

  // 🔴 A word in a third of the index cannot be a requirement.
  //
  // This is the heart of the card, and the first attempt got it wrong:
  // weighting `camping` down still left it a REQUIREMENT, so every
  // campsite that does not contain the word was thrown away before
  // ranking ever ran. Measured on the live index: 22 campsites are
  // genuinely near Bovec, and not one of them contains "camping" —
  // "Camp Bovec" is "camp". So `camping bovec` could not return the
  // right answer at any weighting, because the right answer was not in
  // the running.
  //
  // A common word therefore becomes a preference, not a filter: it adds
  // score when present and excludes nothing. The rare word still has to
  // match, which is what makes a second word narrow the answer.
  const common = exact.map(
    (df) => df / n > COMMON_SHARE && df >= COMMON_FLOOR,
  );
  // If EVERY word is common the query has nothing rare to stand on, so
  // they all stay required — otherwise `camping aire` would answer with
  // most of the index. The absolute floor does the same job for a small
  // index, where a share means nothing: in a fixture of two documents
  // every word is in 50% of them and none of them narrows anything.
  const allCommon = common.every(Boolean);
  const required = common.map((c) => allCommon || !c);


  // 🔴 And a word that narrows the answer is worth more than one that
  // does not.
  //
  // The classic inverse document frequency, measured over the whole
  // index. On its own this changed almost nothing — measured across 896
  // queries it moved one — because the documents it should have
  // promoted were being filtered out first. It matters now: among the
  // campsites that do match `bovec`, it is what stops one that merely
  // also says "camping" from outranking one that is actually in Bovec.
  const weight = exact.map((df) => Math.max(1, Math.log((n + 1) / (df + 1))));

  const matched: { doc: SearchDoc; scores: number[] }[] = [];
  for (let d = 0; d < docs.length; d++) {
    const row = scores[d];
    // 🔴 Redundant today, and kept on purpose — measured, not assumed.
    //
    // `required` can never be all-false (if every term is common they
    // all become required again), so a document matching nothing already
    // fails the loop below, and removing this line changes no result on
    // 308 queries. It stays as the one line that still holds if somebody
    // later makes every term optional — at which point, without it, an
    // empty-handed document would match everything. Unlike the `floor`
    // this replaced, it is labelled as what it is rather than described
    // as the thing doing the work.
    let ok = row.some((s) => s > 0);
    for (let i = 0; ok && i < row.length; i++) {
      if (row[i] === 0 && required[i]) ok = false;
    }
    if (ok) matched.push({ doc: docs[d], scores: row });
  }

  // 🔴 Folded once per document, not once per keystroke per document.
  //
  // The first version folded the region, the country name and the
  // campsite name inside this map — three `fold()` calls, a `split` and
  // a `Set` for every matched document, on every keystroke. Review
  // measured 1.5-1.9x on the short prefixes that make up most of what a
  // reader types: `cam` 73 ms → 136 ms. A region slug is already
  // lower-case ASCII, so the fold is nearly free, but doing it 61 422
  // times per keystroke is not.
  const regionCache = new Map<string, Set<string>>();
  const wordsOf = (region: string) => {
    let w = regionCache.get(region);
    if (w === undefined) {
      w = new Set(fold(region).split(' ').filter(Boolean));
      regionCache.set(region, w);
    }
    return w;
  };

  const hits = matched.map(({ doc, scores }) => {
    const regionWords = wordsOf(doc.region);
    let total = 0;
    for (let i = 0; i < scores.length; i++) total += scores[i] * weight[i];
    const place = nearestNamed(doc, ts);
    // 🔴 The REGION, and nothing else.
    //
    // This counted the campsite's own name and country too, and review
    // measured what that does: `camping piaseczno` left a campsite 41 m
    // from Piaseczno for "Resort Piaseczno" — a different Piaseczno,
    // 528 km away, in another region. Having the word in your own NAME
    // is not being in the place; it is the same coincidence as a shop
    // named after a town, one level closer in. The country is worse
    // still: it contributed 6 of 4 277 matches and narrows nothing.
    //
    // A region is different in kind. It is the only one of the three
    // that means "the campsite is inside the area the reader named".
    //
    // 🔴 Only words that NARROW earn a point — and the first version of
    // this comment claimed that rule could never fire. It was wrong.
    //
    // I removed the filter saying "no region is called camping", which
    // is true and beside the point. Six words are BOTH above the 5%
    // threshold and words of a region slug — as an exact word over
    // `doc.text`, which is what `exact[]` above counts:
    //
    //   de 40.5%   la 17.0%   saint 7.6%   du 5.7%   l 5.4%   d 5.1%
    //
    // — pas-de-calais, bouches-du-rhone, la-rioja, seine-saint-denis,
    // cote-d-or, val-d-oise. 2 257 campsites, 3.7% of the index, sit in
    // such a region. Without the filter they collect a point for the
    // word "du", and `camping du lac` stops answering with the campsite
    // 0 m from a lake of that name and answers with Bouches-du-Rhône,
    // 1.5 km from anything.
    //
    // (A count of "31 of 3 503 queries change" stood here. It was a
    // number I took from a review rather than measured, and a later
    // pass put it at 34. Removed rather than corrected: a figure I did
    // not produce is a figure I cannot defend.)
    //
    // 🔴 `!common[i]`, not `required[i]`. The two differ exactly where
    // it matters: when EVERY word of the query is common, `allCommon`
    // makes them all required again — a sensible rule for deciding what
    // must match, and the wrong one here. Measured, `camping saint`
    // then collected a point for "saint" and answered with
    // Seine-Saint-Denis and no distance at all, in place of a campsite
    // 0 m from a place actually called Saint-something. The two forms
    // differ on 12 of 3 503 realistic queries, every one of them a
    // query whose every word is common, and `!common[i]` matches main
    // on all of them.
    //
    // (`camping seine` was offered here as a second example and does
    // not belong: "seine" is 0.6% of the index, so the two forms are
    // identical there and the 16 m → 567 m move comes from `own`
    // existing at all. Review caught it.)
    //
    // Being required is about whether a word must appear. Being common
    // is about whether it identifies anything — and a word in 5% of the
    // index identifies no region, whatever the query around it looks
    // like.
    let own = 0;
    for (let i = 0; i < ts.length; i++) {
      if (!common[i] && regionWords.has(ts[i])) own++;
    }
    return {
      doc,
      score: total,
      metres: place?.m,
      nearest: place?.name,
      // Carried only as far as the sort below, then dropped.
      own,
    };
  });

  return hits
    .sort((a, b) => {
      // 🔴 HOW WELL it matches first, then how close it is.
      //
      // This was the other way round, and distance alone decided. So a
      // weak fuzzy match 416 m from something always beat a perfect
      // match 878 m away — measured on the live index, searching "bled"
      // put a French aire first, because the place beside it is called
      // "Segré-en-Anjou Bleu" and "Bleu" is one letter from "bled". The
      // Slovenian Camping Bled came fourth.
      //
      // The scores already say which is which: an exact word is 100, a
      // prefix 60, a one-letter typo 30. Distance was overruling all of
      // it.
      //
      // 🔴 The original reasoning is kept, not discarded. Its comment
      // said: ordering by distance when the query named no place would
      // be sorting on a number that answers a different question. True
      // — and still true, because distance now only separates results
      // that match EQUALLY WELL.
      //
      // Measured on the live index rather than assumed: `bovec` returns
      // 27 hits scoring {100: 24, 30: 3}, and not one of the 20 shown
      // positions moves under this change. The 24 that name Bovec
      // exactly are still ordered by how close they are to it — which
      // is the whole point of having the distance — and the three that
      // merely resemble it now sit below them instead of jumping the
      // queue on a short walk.
      //
      // (An earlier version of this comment claimed «"campsites near
      // Bovec" all score the same». Both halves were wrong: that
      // literal query returns nothing, because every term must match,
      // and `bovec` alone does not score uniformly. The conclusion held
      // and the evidence was invented.)
      if (b.score !== a.score) return b.score - a.score;
      // 🔴 No `anyNamedPlace` gate. It was here, it read as a guard, and
      // it never guarded anything: it is false only when EVERY hit has
      // `metres === undefined`, and in exactly that case both sides
      // below are +Infinity and the comparison is already a no-op.
      // Proved algebraically, then measured — removing it changed 0 of
      // 39 real queries and 0 of 200 000 randomised hit-sets, against
      // this comparator and against the previous one. A line that
      // cannot change an outcome misleads about what protects what.
      // 🔴 CAMP-137: being IN the place you named beats being near
      // something whose name contains the word.
      //
      // Distance was the only thing separating equal scores, and it
      // answers a different question: "how far is the nearest thing
      // whose name contains your word". Measured on the live index,
      // `camping tolmin` returned `Camp Bovec`, forty kilometres from
      // Tolmin, because a shop 273 m from it is called "Kmetijska
      // Zadruga **Tolmin** Trgovina Market Bovec" — a cooperative FROM
      // Tolmin running a store IN Bovec. The word is there; the town is
      // not.
      //
      // 🔴 The first attempt scored how much of the place's NAME the
      // query explained, and it broke five other queries to fix this
      // one. That measure punishes long real names: "València - La Font
      // de Sant Lluís" IS Valencia, and it lost to "Valencia de
      // Alcántara" in Portugal for having six words instead of three.
      // `camping gard` went to Sweden, because *gård* is an ordinary
      // Swedish word and "Coop Ludvika Gård" matched it exactly.
      //
      // What every one of those cases had in common — including Tolmin
      // — is that the right answer was the campsite IN the region the
      // reader named, and the wrong one merely had a neighbour with the
      // word in its name. So that is what is compared: how many of the
      // query's words the document matches in its own REGION, rather
      // than through something nearby.
      //
      // The region alone, and this sentence used to say "region,
      // country or name". The code was corrected and the sentence was
      // not, which is the shape of mistake this file exists to catch:
      // the name is the coincidence one level in (`Resort Piaseczno`,
      // 528 km from the Piaseczno the reader meant) and the country
      // contributed 6 matches in 4 277.
      //
      // 🔴 The price, named and measured on THIS commit: compared
      // before distance, a campsite inside the region with no recorded
      // distance to anything outranks one just outside it standing next
      // to the town. The "· N m from X" line therefore disappears from
      // the top result on 5 of the 19 answers that change across the
      // 4 216-place geometric corpus, and on 14 of 27 across a wider
      // corpus of multi-word queries. `brda`, `rezeknes` and `limburg`
      // are the visible cases: the region wins and the line goes.
      //
      // The rarity filter above removes part of that class and not
      // most of it — 26 of 60 before it, 14 of 27 after, and no change
      // at all on the geometric corpus. An earlier version of this
      // comment quoted the pre-filter number and claimed "most", two
      // paragraphs below a sentence about exactly that mistake.
      //
      // What remains is the genuine ambiguity between a town and the
      // region named after it. CAMP-140 is where it is fixed.
      if (b.own !== a.own) return b.own - a.own;
      // 🔴 `quality` is NOT a sort key, and was.
      //
      // Sorting on it re-created the defect it was meant to remove, one
      // rung lower: `camping fermo` promoted a campsite 13 592 m from
      // Fermo over one 2 263 m from "Porto San Giorgio-Fermo", because
      // one word of one beat two words of four. It also inverts the
      // score bands this file calls inviolable — a one-edit fuzzy match
      // at 30 x 1/1 outranks an exact word at 100 x 2/8 — and review
      // found `castellon` doing exactly that, showing the reader a
      // larger distance to a weaker match.
      //
      // It does not survive at all: `nearestNamed` went back to main's
      // nearest-match-wins, because `m` is both the ordering key and the
      // number the reader is shown, and one function cannot serve both.
      // CAMP-140 splits them. Nothing tested `quality` as a sort key,
      // and removing it left all 287 tests green — which is how it got
      // in.
      const am = a.metres ?? Number.POSITIVE_INFINITY;
      const bm = b.metres ?? Number.POSITIVE_INFINITY;
      if (am !== bm) return am - bm;
      // Deterministic tiebreak — the same lesson as the map's ORDER BY.
      return a.doc.path.localeCompare(b.doc.path);
    })
    .slice(0, limit)
    // `own` orders the list; it does not describe a result.
    .map(({ own, ...hit }) => (void own, hit));
}

// ---------------------------------------------------------------------
// CAMP-107: the same index, half the bytes.
//
// 🔴 Nothing is dropped. This is the file format, not the contents.
//
// The index passed its 1.5 MB ceiling the moment the rest of France
// landed — 10 519 campsites, 2 230 KB. Measured on that real file, the
// breakdown was:
//
//   JSON keys   ~680 KB   "kind":"name":"path":"country":"region":…
//                         repeated 10 519 times
//   path         530 KB   "/camping/fr/lot/camping-du-lac" — every byte
//                         of which is already in country, region, slug
//   kind         103 KB   the string "campsite", 10 519 times, on a file
//                         where nothing else exists yet
//
// So more than half the file was structure repeating itself. Packing to
// arrays with the two derivable fields removed brings it to 1 184 KB —
// 79% of the same ceiling, with the same information. Measured, not
// estimated: the numbers above come from the built file.
//
// 🔴 This does NOT retire CAMP-67. The ceiling still exists and still
// fails the build; it now fails at roughly 20 000 campsites instead of
// 10 000. Compressing the format buys one more country, not a different
// design. When it fires again the answer is a search service, and the
// error message says so.
//
// `search()` and every type above are untouched: the packing happens on
// write and the unpacking on read, so nothing downstream knows.

/**
 * Country codes, region names and place names: each stored once in its
 * own table and referenced by index. See `PackedIndex`.
 */
/**
 * The slug a campsite's name would produce, or null when it would not.
 *
 * 🔴 The same trick as `searchText`, measured on France: 16 807 of
 * 23 645 slugs (71%) are exactly this, so storing them all costs 613 KB
 * where storing only the exceptions costs 153 KB.
 *
 * 🔴 It is a PREDICTION, never a source of truth. The API assigns a slug
 * once and CAMP-87 forbids moving it, so two campsites called "Camping
 * Municipal" get `camping-municipal` and `camping-municipal-2` — the
 * second is not derivable and must be carried. The packer writes the
 * slug whenever it differs by so much as a character, so it cannot guess
 * wrong; it can only fail to save.
 *
 * Must match `slugify` in apps/api/src/osm/import-spots.ts, which is
 * where a campsite's slug is actually assigned — including its cut at
 * 80 characters.
 */
export function slugFromName(name: string): string | null {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug === '' ? null : slug;
}

export interface PackedIndex {
  /**
   * Format version, so an old cached file cannot be read as a new one.
   *
   * 🔴 3 since CAMP-138 moved place names into a shared table. Version 2
   * carried `near` as `[{name, m}, …]`; version 3 carries it as
   * `[[placeIdx, m], …]`, plus the table `p` those indices point into.
   *
   * 🔴 A version 2 file has no `p` AT ALL — its top-level keys are
   * `v,c,r,d` — and that decides what reading one as version 3 does.
   * `unpackIndex` evaluates `packed.p[e[0]]`, which is
   * `undefined[undefined]`, and throws on the first row. Measured on all
   * 29 chunks `main`'s packer produces from the live index, fed to this
   * reader with the gate below deleted: **29 threw, 0 rows returned**,
   * every one `TypeError: Cannot read properties of undefined (reading
   * 'undefined')`.
   *
   * 🔴 So this gate is NOT what stands between a reader and a quietly
   * wrong page, and the first version of this comment said it was.
   *
   * It claimed 868 rows came back with all 3 081 nearby places holding
   * `{name: undefined, m: undefined}` and the haystack silently
   * shortened. Every one of those numbers was real — and measured
   * against a hand-written copy of this function that said
   * `packed.p?.[e[0]]`. One optional-chaining operator, swallowing
   * precisely the missing table that distinguishes the two formats, so
   * the corpus and the reader were both lookalikes of the thing under
   * test. Review caught it. The shipped reader never behaved that way,
   * and a measurement of a reimplementation is a measurement of nothing.
   *
   * What the gate is actually worth is still worth having: it turns an
   * incidental `TypeError` from the middle of a `.map()` into a NAMED
   * refusal that says which format arrived — which `site-search.tsx`
   * catches and counts as a failed part, rather than letting an
   * unlabelled type error decide how the page behaves. See
   * `unpackIndex` for why no version 2 branch is offered beside it.
   */
  v: 3;
  c: string[];
  r: string[];
  /**
   * Place names, each stored once.
   *
   * 🔴 This is the whole card. Measured on the live index 27.09.2026:
   * 207 994 nearby-place entries hold only 33 778 distinct names, so
   * every name was written 6.16 times on average. Storing each once and
   * referencing it takes the index from 8 984 521 to 5 201 286 raw
   * bytes — 8.98 MB → 5.20 MB, −42.1% — and 29 files to 28, because
   * France now needs two pieces instead of three.
   */
  p: string[];
  /**
   * `[name, countryIdx, regionIdx, slug | 0, near?]`
   *
   * `text` is derived, `slug` is 0 when it is exactly what the name
   * produces — which it is for 71% of rows — and `near` is
   * `[placeIdx, metres]` pairs into `p`.
   */
  d: (string | number | [number, number][])[][];
}

export function packIndex(docs: SearchDoc[]): PackedIndex {
  // 🔴 A Map beside each table, not `indexOf` over it.
  //
  // `indexOf` was fine for the two tables that existed: 27 countries and
  // 794 regions, scanned 61 422 times. The place table is 33 778 names
  // looked up 207 994 times, and a linear scan over it is quadratic in
  // exactly the thing this card makes bigger. Measured on the live
  // index, packing all 28 chunks once — which is one of the several
  // passes a build makes:
  //
  //   Map       46 ms        indexOf      315 ms      6.8x
  //
  // and the same docs packed as ONE group, where the table reaches its
  // full 33 778 rather than a country's worth:
  //
  //   Map       34 ms        indexOf    3 800 ms      112x
  //
  // The per-chunk number is the one we pay today and the whole-index
  // number is what it grows into, since a chunk is capped at 1.5 MB
  // while the table behind it is not.
  //
  // 🔴 The indices are identical to `indexOf`'s — both hand out
  // positions in first-seen order — and that is asserted rather than
  // assumed: packing 5 000 live rows both ways produces byte-identical
  // JSON. This changes what a lookup costs, not what it answers.
  const table = () => {
    const list: string[] = [];
    const at = new Map<string, number>();
    return {
      list,
      idx(value: string): number {
        const found = at.get(value);
        if (found !== undefined) return found;
        at.set(value, list.length);
        list.push(value);
        return list.length - 1;
      },
    };
  };
  const c = table();
  const r = table();
  const p = table();

  const d = docs.map((doc) => {
    // 🔴 The slug is recovered from the path rather than carried
    // separately, because the path is what the rest of the app uses and
    // a second source for the same string is a second thing to get
    // wrong. `/camping/<country>/<region>/<slug>` — the last segment.
    const slug = doc.path.slice(doc.path.lastIndexOf('/') + 1);
    const row: (string | number | [number, number][])[] = [
      doc.name,
      c.idx(doc.country),
      r.idx(doc.region),
      // 🔴 0, not an empty string: an empty string is a legitimate slug
      // to be wrong about, and `''` beside `'0'` in a hand-read file is
      // a mistake waiting to happen. A number says "derive it"; a string
      // says "here it is".
      slugFromName(doc.name) === slug ? 0 : slug,
    ];
    // 🔴 The saving this line was written for is gone, and the line is
    // still right.
    //
    // It said "only 3% of campsites have anything near them recorded,
    // so an empty array on every other row is 10 000 copies of []".
    // That was true when it was written and is not any more: CAMP-33's
    // context pass finished, and as of 25.09.2026 all 61 422 campsites
    // have something near them — 207 994 entries, 3.4 each. So this
    // omits nothing today.
    //
    // It stays because the shape it guards against is still possible —
    // a fresh import, a country loaded before its context — and a row
    // that ends early is what `unpackIndex` already expects. Kept as a
    // cheap invariant, not as a saving it no longer makes.
    if (doc.near.length > 0) {
      row.push(doc.near.map((n) => [p.idx(n.name), n.m] as [number, number]));
    }
    return row;
  });

  return { v: 3, c: c.list, r: r.list, p: p.list, d };
}

export function unpackIndex(packed: PackedIndex): SearchDoc[] {
  // 🔴 Version 3 ONLY, and version 2 is refused along with the rest.
  //
  // A browser can be holding a version 2 chunk when this ships, and
  // reading it would be easy: `v` says which format it is, so a second
  // branch here could unpack it correctly. That is deliberately not
  // done, for two reasons that are about this file's URLs rather than
  // about the formats.
  //
  // 🔴 The version is the only staleness signal these URLs have.
  //
  // 🔴 And the durable half of that is the URL, not any cache header.
  // `/data/search/<id>.json` carries no content hash, so one build's
  // body and the next are the same address whatever the caching policy
  // turns out to be. The route asks for `max-age=3600` and `next start`
  // honours it; what production does is NOT established — CAMP-90
  // records that Cloudflare Pages never runs Next's header logic, the
  // generated `public/_headers` sets no `Cache-Control` for these paths
  // at all, and the host is still unsettled. So reason from "some cache
  // may hold an old body at this address", which is true everywhere,
  // rather than from an hour nobody has measured in production.
  //
  // The table of contents catches a stale chunk only when the COUNT
  // changed, which is the check in site-search.tsx. Measured on this
  // change: 26 of the 27 countries keep both their id and their
  // campsite count, so for 26 of them that check stays silent and the
  // version number is the only thing left saying "this file predates
  // the deploy". (France is the one that does not: it goes from three
  // pieces to two, so `fr-1` grows from 7 882 rows to 11 823 and `fr-3`
  // stops existing — the count check and a 404 cover those.) Accepting
  // v2 would spend that signal for a transition window we cannot size.
  //
  // 🔴 And a v2 branch here is a branch nothing writes.
  //
  // `packIndex` emits v3, so `checkedPlan`'s per-chunk round trip — the
  // only thing that exercises this function against real data on every
  // build — could never reach it. An unexercised guard is the defect
  // this repository keeps finding in its own safeguards; adding one on
  // purpose, in the function whose failure mode is "the wrong
  // campsite", is not a trade worth making.
  //
  // What the reader gets instead is labelled, and the handling is
  // already built: the throw lands in the catch in site-search.tsx, the
  // part is counted as failed, and `partialNotice` says how many parts
  // could not be loaded and that every campsite in them is still
  // reachable from the country list.
  //
  // 🔴 Say the size of that plainly: with a fully warm cache this is a
  // DEAD search, not a degraded one. All 28 ids the new table of
  // contents asks for existed under version 2, so every request can be
  // answered from cache with a version 2 body — measured, 28 of 28
  // refused, `docs` empty, and the page answers "Nothing matches" to
  // everything, behind the notice. It recovers when the cached bodies
  // do, and how long that takes is the open question above.
  if (packed?.v !== 3) {
    // A stale cached file, a file from a future format, or a truncated
    // download. A version 2 body would throw a bare TypeError a few
    // lines below instead — see `PackedIndex` — and a format we have
    // not met yet could return junk rather than throwing at all. Both
    // are worse than one named error the caller can act on.
    throw new Error(`search index format ${packed?.v} is not supported`);
  }
  return packed.d.map((row) => {
    const country = packed.c[row[1] as number];
    const region = packed.r[row[2] as number];
    // 🔴 The names are SHARED, not copied. Every entry naming the same
    // place hands back the same string, and that is where the heap
    // saving is: measured on the live index, 42.2 MiB held → 37.4 MiB,
    // −11.4%, because 207 994 separate strings became 33 778 referenced
    // 207 994 times. V8 does not do this for us — 4.8 MiB across
    // 174 216 strings is about 29 bytes each, which is a short string
    // plus its header, so `JSON.parse` was genuinely allocating one per
    // entry.
    //
    // 🔴 Nothing in the suite would notice if this stopped. Rebuilding
    // the name here — `.slice()`, a template, anything that returns a
    // fresh string — gives identical documents, identical searches and
    // an identical file, and quietly gives back the heap this card was
    // for. There is no assertion for string identity in JavaScript;
    // what holds this is the measurement above, repeated when it
    // changes. Said plainly rather than covered by a test that would
    // only look like one.
    const near = ((row[4] as [number, number][]) ?? []).map((e) => ({
      name: packed.p[e[0]],
      m: e[1],
    }));
    const name = row[0] as string;
    // 0 means "the name produces it". Anything else is carried verbatim
    // because the name could not — see slugFromName.
    const slug = row[3] === 0 ? (slugFromName(name) ?? '') : (row[3] as string);
    return {
      kind: 'campsite' as const,
      name,
      path: `/camping/${country}/${region}/${slug}`,
      country,
      region,
      near,
      // Rebuilt by the same function that built it for the writer.
      // Folding 61 000 short strings once on load takes a few
      // milliseconds; sending them twice is paid on every visit.
      text: searchText({ name, region, country, near }),
    };
  });
}
