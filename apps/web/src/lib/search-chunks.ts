// CAMP-129: the search index, in pieces — and the order they arrive in.
//
// 🔴 Why it is no longer one file.
//
// The route refuses to send more than 1.5 MB to every visitor, and after
// the EU-27 import the index was 6.9 MB. Deriving `text` and the slug
// took it to 4.26 MB (measured), which is better and still not close.
//
// 🔴 What this does NOT do: make the search smaller. A site-wide search
// over 61 422 campsites has to hold 61 422 campsites. What it changes is
// WHEN each part arrives and whether the reader can use the search
// before all of it has. Slovenia's 284 are 38 KB and land almost at
// once; France's 23 645 are the last thing to come in. Typing "Bled"
// answers in the first tenth of a second instead of after four
// megabytes.
//
// The real answer is a search service the browser queries, which is what
// the route's own error message says — and it needs an API that is
// reachable at runtime (CAMP-61). This is what works before that exists.

/** One downloadable piece of the index. */
export interface SearchChunk {
  /** `fr`, or `fr-2` when one country needed splitting. */
  id: string;
  country: string;
  /** Campsites in this piece — shown while it is still arriving. */
  count: number;
  /** Bytes, so the loader can start with the ones that land first. */
  bytes: number;
}

export interface SearchIndex {
  v: 1;
  chunks: SearchChunk[];
}

export const chunkUrl = (id: string): string => `/data/search/${id}.json`;

/**
 * The order chunks are fetched in: smallest first.
 *
 * 🔴 Smallest first is not politeness, it is what the reader sees. Every
 * chunk that lands makes the search able to answer more, so the order
 * that maximises "campsites searchable per second" is ascending size.
 * Measured: the median country is 38 KB and France is 2 309 KB, so
 * fetching France first would mean twenty-six countries waiting behind
 * the one that takes longest.
 *
 * Ties break on id so two builds of the same data fetch in the same
 * order — a test that depends on arrival order must not be a coin toss.
 */
export function fetchOrder(index: SearchIndex): SearchChunk[] {
  return [...index.chunks].sort(
    (a, b) => a.bytes - b.bytes || a.id.localeCompare(b.id),
  );
}

/**
 * How far along the load is, in the reader's terms.
 *
 * 🔴 Campsites, not files. "22 of 27 files" means nothing to somebody
 * looking for a campsite; "58 000 of 61 422 searchable" is the same fact
 * in units they care about.
 */
export function loadProgress(
  index: SearchIndex,
  loaded: ReadonlySet<string>,
): { searchable: number; total: number; done: boolean } {
  let searchable = 0;
  let total = 0;
  for (const c of index.chunks) {
    total += c.count;
    if (loaded.has(c.id)) searchable += c.count;
  }
  return { searchable, total, done: searchable === total && total > 0 };
}

/**
 * What the reader is told while the index is still coming in.
 *
 * 🔴 Null once everything is in: a search that works says nothing. And
 * never silence while it is incomplete — a reader who types a French
 * campsite's name before France has landed must be told the answer is
 * partial, not shown "no results" and left to conclude we do not have it.
 */
export function partialNotice(
  progress: { searchable: number; total: number; done: boolean },
  failed: number,
): string | null {
  if (failed > 0) {
    return `${failed} part${failed === 1 ? '' : 's'} of the index could not be loaded, so some campsites cannot be found here yet. Every one of them is still reachable from the country list.`;
  }
  if (progress.done) return null;
  if (progress.total === 0) return 'Loading campsites…';
  const pct = Math.floor((100 * progress.searchable) / progress.total);
  return `Searching ${progress.searchable.toLocaleString('en-GB')} of ${progress.total.toLocaleString('en-GB')} campsites — the rest are still loading (${pct}%).`;
}
