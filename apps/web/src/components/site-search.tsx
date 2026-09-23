'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { countryName, formatDistance } from '@/lib/api';
import { search, type SearchDoc, type SearchHit } from '@/lib/search';

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

const INDEX_URL = '/data/search.json';

type State =
  | { status: 'loading' }
  | { status: 'ready'; docs: SearchDoc[] }
  | { status: 'failed' };

export default function SiteSearch({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<State>({ status: 'loading' });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(INDEX_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { docs?: SearchDoc[] }) => {
        if (!cancelled) setState({ status: 'ready', docs: data.docs ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'failed' });
      });
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

  const total = state.status === 'ready' ? state.docs.length : 0;

  return (
    <div>
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
            : `${hits.length}${hits.length === 20 ? '+' : ''} of ${total} campsites`}
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
          Searching {total} campsites. Try a name, a region, or a town or
          lake nearby — results near a place you name are ordered by how
          close they are to it.
        </p>
      )}
    </div>
  );
}
