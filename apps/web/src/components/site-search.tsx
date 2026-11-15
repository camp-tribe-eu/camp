'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { sendZeroResult } from '@/lib/events';
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
import {
  countryEntries,
  matchEntries,
  regionEntries,
  type CountryEntry,
} from '@/lib/search-groups';
import { Block } from '@/components/layout';
import { Button } from '@/components/button';
import {
  CampsiteCards,
  CountryCards,
  RegionCards,
  SearchCardsStyle,
} from '@/components/search-cards';

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

/**
 * Вкладки за типом результату — лише ті, що дані справді містять:
 * кемпінги (індекс), регіони (з кемпінгів індексу), країни (перелік,
 * який сторінка вже має). Гайдів немає: див. `search-groups.ts`.
 */
export const TABS = ['campsites', 'regions', 'countries'] as const;
export type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  campsites: 'Campsites',
  regions: 'Regions',
  countries: 'Countries',
};

export const isTab = (v: unknown): v is Tab =>
  typeof v === 'string' && (TABS as readonly string[]).includes(v);

export interface CountryInput {
  country: string;
  spots: number;
  regions: number;
}

export default function SiteSearch({
  initialQuery,
  initialTab = 'campsites',
  countries = [],
}: {
  initialQuery: string;
  initialTab?: Tab;
  countries?: CountryInput[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [tab, setTab] = useState<Tab>(initialTab);
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
  //
  // 🔴 Вкладка лежить в адресі лише коли вона не типова: посилання на
  // «Regions» мусить відкриватись на «Regions», а типовий адрес лишається
  // тим, що був до цієї картки.
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (query && tab !== 'campsites') params.set('tab', tab);
    const qs = params.toString();
    window.history.replaceState(
      null,
      '',
      qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
    );
  }, [query, tab]);

  const hits: SearchHit[] = useMemo(
    () => (state.status === 'ready' ? search(state.docs, query) : []),
    [state, query],
  );

  // Регіони — з документів, що вже прийшли; країни — з переліку сторінки.
  const allRegions = useMemo(
    () => (state.status === 'ready' ? regionEntries(state.docs) : []),
    [state],
  );
  const allCountries = useMemo<CountryEntry[]>(
    () => countryEntries(countries),
    [countries],
  );
  const regionHits = useMemo(
    () => matchEntries(allRegions, query, (r) => r.count),
    [allRegions, query],
  );
  const countryHits = useMemo(
    () => matchEntries(allCountries, query, (c) => c.spots),
    [allCountries, query],
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

  // 🔴 CAMP-504. Пошук, що нічого не знайшов — і лише коли індекс ПОВНИЙ:
  // поки частини ще йдуть, «нічого» може означати «ще не дійшло». Текст
  // запиту НЕ надсилається (людина могла вписати імʼя) — лише факт, що
  // порожньо; у цьому пошуку фільтрів немає.
  const zeroQuery =
    state.status === 'ready' &&
    progress.done &&
    query.trim().length >= 3 &&
    // 🔴 CAMP-455. «Нічого» — коли немає НІ кемпінгу, НІ регіону, НІ
    // країни. Запит «Bari» без жодного кемпінгу, але з регіоном —
    // знайдений запит, і лічити його як порожній означало б збрехати
    // тому, хто читає ці лічильники.
    hits.length === 0 &&
    regionHits.length === 0 &&
    countryHits.length === 0;
  useEffect(() => {
    if (!zeroQuery) return;
    const timer = setTimeout(() => sendZeroResult('search', []), 2000);
    return () => clearTimeout(timer);
  }, [zeroQuery, query]);

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
      // Усе, що не картка, стоїть по центру; картки вирівнюють себе самі.
      className="text-center"
      data-state={state.status}
      // \ud83d\udd34 Two separate facts, because a test needs to pick one.
      // `ready` means the search box answers; `complete` means it can
      // answer about every campsite. A spec that types a French name
      // must wait for the second, and before this attribute existed it
      // had no way to say so.
      data-complete={state.status === 'ready' && progress.done ? 'true' : 'false'}
      data-searchable={progress.searchable}
    >
      <SearchCardsStyle />
      <label htmlFor="q" className="sr-only">
        Search campsites, regions and countries
      </label>
      {/* 🔴 ПОЛЕ ПО ЦЕНТРУ І НЕ НА ВСЮ ШИРИНУ: `max-w-[910px]` з `mx-auto`.
          910 — не вигадка: у Fuse поле займає 912 із 1500 px (знімок
          442/03, заміряно 15.11.2026), тобто ~61% сторінки. Слова власника
          з ревʼю 442/4: «сьорч не такий широкий і по центру». Розміри
          самого поля — з теми: висота 56, відступ 24, радіус 16, вага 600
          (`docs/design-system-from-theme.md`, «Поля вводу»). */}
      <div className="mx-auto max-w-[910px]">
        <input
          id="q"
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="A campsite, a region, or a place nearby"
          autoComplete="off"
          data-testid="search-input"
          className="h-14 w-full rounded-card border border-line-2 bg-surface px-6 text-base font-semibold text-heading placeholder:font-normal placeholder:text-ink-2"
        />
      </div>

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
        <>
          {/* 🔴 ВКЛАДКИ ЗА ТИПОМ, І КОЖНА НЕСЕ СВОЄ ЧИСЛО. Читач, який
              шукає «Bari», бачить, що це й регіон, не відкриваючи вкладку.
              Це справжній `tablist`: стрілки перемикають, а не Tab. */}
          <div
            role="tablist"
            aria-label="Result type"
            data-testid="search-tabs"
            className="mt-5 flex flex-wrap justify-center gap-2"
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const at = TABS.indexOf(tab);
              const next =
                TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
              setTab(next);
              document.getElementById(`search-tab-${next}`)?.focus();
            }}
          >
            {TABS.map((t) => {
              const n =
                t === 'campsites'
                  ? `${hits.length}${hits.length === 20 ? '+' : ''}`
                  : String(t === 'regions' ? regionHits.length : countryHits.length);
              return (
                <Button
                  key={t}
                  id={`search-tab-${t}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls="search-panel"
                  tabIndex={tab === t ? 0 : -1}
                  variant={tab === t ? 'accent' : 'chip'}
                  data-testid={`search-tab-${t}`}
                  onClick={() => setTab(t)}
                >
                  {TAB_LABEL[t]} ({n})
                </Button>
              );
            })}
          </div>

          <div
            id="search-panel"
            role="tabpanel"
            aria-labelledby={`search-tab-${tab}`}
            data-testid="search-panel"
            data-tab={tab}
          >
            <p data-testid="search-count" className="mt-4 text-sm text-ink-2">
              {tab === 'campsites'
                ? hits.length === 0
                  ? `Nothing matches “${query}”.`
                  : `${hits.length}${hits.length === 20 ? '+' : ''} of ${total.toLocaleString('en-GB')} campsites`
                : tab === 'regions'
                  ? regionHits.length === 0
                    ? `No regions match “${query}”.`
                    : `${regionHits.length} ${regionHits.length === 1 ? 'region' : 'regions'}`
                  : countryHits.length === 0
                    ? `No countries match “${query}”.`
                    : `${countryHits.length} ${countryHits.length === 1 ? 'country' : 'countries'}`}
            </p>

            <div className="mt-4">
              {tab === 'campsites' && hits.length > 0 && <CampsiteCards hits={hits} />}
              {tab === 'regions' && regionHits.length > 0 && (
                <RegionCards regions={regionHits} showCounts={progress.done} />
              )}
              {tab === 'countries' && countryHits.length > 0 && (
                <CountryCards countries={countryHits} />
              )}
            </div>
          </div>
        </>
      )}

      {state.status === 'ready' && query.trim() === '' && (
        <Block as="p" measure="narrow" className="mt-4 text-sm text-ink-2">
          Searching {total.toLocaleString('en-GB')} campsites. Try a name, a region, or a town or
          lake nearby — results near a place you name are ordered by how
          close they are to it.
        </Block>
      )}
    </div>
  );
}
