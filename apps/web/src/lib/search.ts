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
// outgrows a download (see app/data/search.json/route.ts).
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
}

/**
 * Scores one document against one folded term.
 *
 * The bands are deliberately far apart so that a weaker kind of match
 * can never outrank a stronger one by accumulating: an exact word beats
 * any number of fuzzy ones.
 */
function scoreTerm(doc: SearchDoc, term: string): number {
  const words = doc.text.split(' ');
  if (words.includes(term)) return 100;
  if (words.some((w) => w.startsWith(term))) return 60;

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

/** The place a query named, if it named one this document is near. */
function nearestNamed(doc: SearchDoc, ts: string[]): number | undefined {
  let closest: number | undefined;
  for (const place of doc.near) {
    const folded = fold(place.name);
    const words = folded.split(' ');
    const named = ts.some(
      (t) =>
        words.includes(t) ||
        words.some((w) => w.startsWith(t)) ||
        (tolerance(t) > 0 &&
          words.some((w) => editDistance(w, t, tolerance(t)) <= tolerance(t))),
    );
    if (named && (closest === undefined || place.m < closest)) closest = place.m;
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
 * Every term must match something. An AND over terms is what makes a
 * second word narrow the answer instead of widening it, which is what a
 * reader typing more words is asking for.
 */
export function search(
  docs: SearchDoc[],
  query: string,
  { limit = 20 }: SearchOptions = {},
): SearchHit[] {
  const ts = terms(query);
  if (ts.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const doc of docs) {
    let total = 0;
    let ok = true;
    for (const t of ts) {
      const s = scoreTerm(doc, t);
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (!ok) continue;
    hits.push({ doc, score: total, metres: nearestNamed(doc, ts) });
  }

  const anyNamedPlace = hits.some((h) => h.metres !== undefined);

  return hits
    .sort((a, b) => {
      // 🔴 Distance first, and only when the query actually named a
      // place. Sorting by distance for a query like "shower" would be
      // ordering by an irrelevant number and calling it relevance.
      if (anyNamedPlace) {
        const am = a.metres ?? Number.POSITIVE_INFINITY;
        const bm = b.metres ?? Number.POSITIVE_INFINITY;
        if (am !== bm) return am - bm;
      }
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tiebreak — the same lesson as the map's ORDER BY.
      return a.doc.path.localeCompare(b.doc.path);
    })
    .slice(0, limit);
}
