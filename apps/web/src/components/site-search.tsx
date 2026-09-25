'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { countryName, formatDistance } from '@/lib/api';
import {
  search,
  unpackIndex,
  type PackedIndex,
  type SearchDoc,
  type SearchHit,
} from '@/lib/search';
import {
  chunkUrl,
  fetchOrder,
  loadProgress,
  partialNotice,
  type SearchChunk,
  type SearchIndex,
} from '@/lib/search-chunks';

// CAMP-67 — the results.
//
// 🔴 The index is fetched once and searched in memory. At a thousand
// campsites a keystroke costs under a millisecond, which is the whole
// argument for this design over a round trip: the answer arrives while
// the reader is still typing, and it keeps arriving with the backend
// switched off.
//
// 🔴 The query lives in the URL, so a search is a link somebody can
// send — the same rule as the map filters (CAMP-35).

const INDEX_URL = '/data/search/index.json';

/**
 * How many chunks are in flight at once.
 *
 * \ud83d\udd34 Four, not twenty-eight. A browser caps connections per origin
 * anyway, and firing everything means the small files queue behind the
 * big ones \u2014 which is exactly the ordering this card exists to avoid.
 */
const IN_FLIGHT = 4;

type State =
  | { status: 'loading' }
  | {
      status: 'ready';
      docs: SearchDoc[];
      index: SearchIndex;
      loaded: Set<string>;
      failed: number;
    }
  | { status: 'failed' };

export default function SiteSearch({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<State>({ status: 'loading' });
  const input = useRef<HTMLInputElement>(null);

  // CAMP-129. The index arrives in pieces, smallest first, and the
  // search answers from whatever has landed.
  //
  // 🔴 Why not one file any more: 61 422 campsites pack to 3.40 MB in
  // one file, and the route refuses to hand any single file over 1.5 MB
  // to a visitor — so since the EU-27 import this page has been saying
  // "the search index could not be loaded" to everyone. Splitting does
  // not make the data smaller (3.14 MiB across 28 files, all of which
  // this component still fetches); it makes the page useful in the
  // first tenth of a second instead of after all of it.
  useEffect(() => {
    let cancelled = false;

    const getChunk = async (chunk: SearchChunk): Promise<SearchDoc[]> => {
      const r = await fetch(chunkUrl(chunk.id));
      if (!r.ok) throw new Error(String(r.status));
      // CAMP-107. The file is packed; unpackIndex throws on a version it
      // does not know, which lands in the catch and is counted as a
      // failed part rather than shown as a search that finds nothing.
      const docs = unpackIndex((await r.json()) as PackedIndex);
      // \ud83d\udd34 The table of contents said how many campsites are in this
      // file. If the file disagrees, it is NOT this file \u2014 and the whole
      // point of the notice below is that a reader is never silently
      // given a partial index.
      //
      // This is reachable in production, not theoretical: both the index
      // and the chunks are `max-age=3600` with no content hash in any
      // URL, and `fr-1`/`fr-2` mean "first and second half of France".
      // France's second part is already 68% of the limit, so one import
      // turns fr-1..2 into fr-1..3 \u2014 same URLs, different contents. A
      // browser holding an hour-old TOC would then merge the wrong
      // halves and call it complete.
      //
      // Review measured exactly that: 11 823 French campsites missing,
      // `data-complete="true"`, notice `null`.
      if (docs.length !== chunk.count) {
        throw new Error(
          `chunk ${chunk.id} holds ${docs.length} campsites, the index said ${chunk.count}`,
        );
      }
      return docs;
    };

    void (async () => {
      let index: SearchIndex;
      try {
        const r = await fetch(INDEX_URL);
        if (!r.ok) throw new Error(String(r.status));
        index = (await r.json()) as SearchIndex;
        if (!Array.isArray(index?.chunks) || index.chunks.length === 0) {
          throw new Error('empty index');
        }
      } catch {
        // \ud83d\udd34 Only the table of contents failing is a dead search.
        // A missing piece is not \u2014 that is the `failed` count below.
        if (!cancelled) setState({ status: 'failed' });
        return;
      }

      if (cancelled) return;
      setState({ status: 'ready', docs: [], index, loaded: new Set(), failed: 0 });

      const queue = fetchOrder(index);
      let next = 0;
      const worker = async () => {
        while (!cancelled) {
          const chunk = queue[next++];
          if (!chunk) return;
          try {
            const docs = await getChunk(chunk);
            if (cancelled) return;
            setState((prev) =>
              prev.status === 'ready'
                ? {
                    ...prev,
                    docs: [...prev.docs, ...docs],
                    loaded: new Set(prev.loaded).add(chunk.id),
                  }
                : prev,
            );
          } catch {
            if (cancelled) return;
            // \ud83d\udd34 Counted and said out loud. A part that never arrives
            // means a reader can type a real campsite's name and be told
            // nothing matches \u2014 the one outcome this page must never
            // produce silently.
            setState((prev) =>
              prev.status === 'ready' ? { ...prev, failed: prev.failed + 1 } : prev,
            );
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(IN_FLIGHT, queue.length) }, worker),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the URL in step, without re-rendering the page through the
  // router — the same reasoning as the map filters.
  useEffect(() => {
    const url = query
      ? `${window.location.pathname}?q=${encodeURIComponent(query)}`
      : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [query]);

  const hits: SearchHit[] = useMemo(
    () => (state.status === 'ready' ? search(state.docs, query) : []),
    [state, query],
  );

  const progress =
    state.status === 'ready'
      ? loadProgress(state.index, state.loaded)
      : { searchable: 0, total: 0, done: false };
  const notice =
    state.status === 'ready'
      ? partialNotice(progress, state.failed)
      : null;
  // \ud83d\udd34 The number of campsites the index SAYS exist, not the number
  // that happen to have arrived. "Searching 3 100 campsites" while the
  // rest are still coming would be a number that shrinks the reader's
  // idea of the site every time they arrive early.
  const total = progress.total;

  return (
    // 🔴 The state, on the element, so a test can wait for readiness
    // rather than for the absence of loading.
    //
    // The e2e waited for `search-loading` to be hidden — and `toBeHidden`
    // is satisfied by an element that is not in the DOM *yet*, which is
    // also true in the instant before React has rendered anything at all.
    // So it waited for nothing, typed into an index that had not arrived,
    // and failed on the tablet project roughly one run in ten. The flaky
    // guard caught it; the previous fix had made the loading state
    // visible to a reader, but left the test racing.
    //
    // Waiting for a thing to BE has no such hole.
    <div
      data-testid="search"
      data-state={state.status}
      // \ud83d\udd34 Two separate facts, because a test needs to pick one.
      // `ready` means the search box answers; `complete` means it can
      // answer about every campsite. A spec that types a French name
      // must wait for the second, and before this attribute existed it
      // had no way to say so.
      data-complete={state.status === 'ready' && progress.done ? 'true' : 'false'}
      data-searchable={progress.searchable}
    >
      <label htmlFor="q" className="sr-only">
        Search campsites
      </label>
      <input
        id="q"
        ref={input}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="A campsite, a region, or a place nearby"
        autoComplete="off"
        data-testid="search-input"
        className="h-11 w-full rounded-sm border border-line-2 bg-surface px-3 text-base text-heading placeholder:text-ink-3"
      />

      {/* 🔴 Say that it is loading, because it now takes long enough to
          notice. The index was 228 KB at 1 079 campsites and is 654 KB at
          3 147; a reader who starts typing immediately used to get
          results at once and now gets an empty page with no explanation.
          Found by a flaky WebKit test — the browser was doing exactly
          what a reader on a slow connection does. */}
      {state.status === 'loading' && (
        <p
          data-testid="search-loading"
          role="status"
          className="mt-4 text-sm text-ink-2"
        >
          Loading the campsite index…
        </p>
      )}

      {notice && (
        <p
          data-testid="search-partial"
          role="status"
          className="mt-4 text-sm text-ink-2"
        >
          {notice}
        </p>
      )}

      {state.status === 'failed' && (
        <p role="status" className="mt-4 text-sm text-ink-2">
          The search index could not be loaded. Every campsite is still
          reachable from the{' '}
          <Link href="/camping" className="underline">
            country list
          </Link>
          .
        </p>
      )}

      {state.status === 'ready' && query.trim() !== '' && (
        <p data-testid="search-count" className="mt-4 text-sm text-ink-2">
          {hits.length === 0
            ? `Nothing matches “${query}”.`
            : `${hits.length}${hits.length === 20 ? '+' : ''} of ${total.toLocaleString('en-GB')} campsites`}
        </p>
      )}

      {hits.length > 0 && (
        <ul data-testid="search-results" className="mt-3 space-y-2">
          {hits.map((hit) => (
            <li key={hit.doc.path}>
              <Link
                href={hit.doc.path}
                className="block rounded-card border border-line-2 bg-surface p-3 hover:border-line-blue"
              >
                <span className="font-semibold text-heading">
                  {/* An unnamed campsite says so rather than showing a
                      blank line or a slug dressed up as a name. */}
                  {hit.doc.name || 'Unnamed campsite'}
                </span>
                <span className="mt-0.5 block text-xs text-ink-2">
                  {hit.doc.region.replace(/-/g, ' ')} ·{' '}
                  {countryName(hit.doc.country)}
                  {/* 🔴 The distance is shown only when the query named a
                      place. Printing "1.2 km" for a search like "shower"
                      would be showing a number that answers a question
                      nobody asked. */}
                  {hit.metres !== undefined && (
                    <> · {formatDistance(hit.metres)} from what you searched</>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {state.status === 'ready' && query.trim() === '' && (
        <p className="mt-4 max-w-prose text-sm text-ink-2">
          Searching {total.toLocaleString('en-GB')} campsites. Try a name, a region, or a town or
          lake nearby — results near a place you name are ordered by how
          close they are to it.
        </p>
      )}
    </div>
  );
}
