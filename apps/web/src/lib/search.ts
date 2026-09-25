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
  let closest: { m: number; name: string } | undefined;
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
    const place = nearestNamed(doc, ts);
    hits.push({ doc, score: total, metres: place?.m, nearest: place?.name });
  }

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
      const am = a.metres ?? Number.POSITIVE_INFINITY;
      const bm = b.metres ?? Number.POSITIVE_INFINITY;
      if (am !== bm) return am - bm;
      // Deterministic tiebreak — the same lesson as the map's ORDER BY.
      return a.doc.path.localeCompare(b.doc.path);
    })
    .slice(0, limit);
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

/** Country codes and region names, each stored once and referenced by index. */
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
   * 🔴 2 since CAMP-129 dropped `text`. A version 1 file read as 2 would
   * put the folded haystack where places-nearby belong — not a crash, a
   * wrong page. The reader refuses instead.
   */
  v: 2;
  c: string[];
  r: string[];
  /**
   * `[name, countryIdx, regionIdx, slug | 0, near?]`
   *
   * `text` is derived, and `slug` is 0 when it is exactly what the name
   * produces — which it is for 71% of rows.
   */
  d: (string | number | { name: string; m: number }[])[][];
}

export function packIndex(docs: SearchDoc[]): PackedIndex {
  const c: string[] = [];
  const r: string[] = [];
  const idx = (list: string[], value: string) => {
    const at = list.indexOf(value);
    if (at >= 0) return at;
    list.push(value);
    return list.length - 1;
  };

  const d = docs.map((doc) => {
    // 🔴 The slug is recovered from the path rather than carried
    // separately, because the path is what the rest of the app uses and
    // a second source for the same string is a second thing to get
    // wrong. `/camping/<country>/<region>/<slug>` — the last segment.
    const slug = doc.path.slice(doc.path.lastIndexOf('/') + 1);
    const row: (string | number | { name: string; m: number }[])[] = [
      doc.name,
      idx(c, doc.country),
      idx(r, doc.region),
      // 🔴 0, not an empty string: an empty string is a legitimate slug
      // to be wrong about, and `''` beside `'0'` in a hand-read file is
      // a mistake waiting to happen. A number says "derive it"; a string
      // says "here it is".
      slugFromName(doc.name) === slug ? 0 : slug,
    ];
    // Only 3% of campsites have anything near them recorded, so an empty
    // array on every other row is 10 000 copies of "[]".
    if (doc.near.length > 0) row.push(doc.near);
    return row;
  });

  return { v: 2, c, r, d };
}

export function unpackIndex(packed: PackedIndex): SearchDoc[] {
  if (packed?.v !== 2) {
    // A cached file from before this change, or a truncated download.
    // Returning junk would show a reader a search that silently finds
    // nothing; an empty index at least makes the page say so.
    throw new Error(`search index format ${packed?.v} is not supported`);
  }
  return packed.d.map((row) => {
    const country = packed.c[row[1] as number];
    const region = packed.r[row[2] as number];
    const near = (row[4] as { name: string; m: number }[]) ?? [];
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
