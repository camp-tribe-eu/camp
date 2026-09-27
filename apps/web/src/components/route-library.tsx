'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { TRAVELLER_LABEL, type TravellerTag } from '@/lib/route-types';

// CAMP-45 — the filterable list on /routes.
//
// 🔴 A Client Component that still renders its whole list on the server.
//
// This is the point of doing it this way rather than with a query
// string. Next renders Client Components on the server for the first
// paint, so the HTML that a crawler (or a reader with no JavaScript)
// receives already contains every route, every summary and every link.
// The filters then narrow what is already there. Nothing is fetched,
// nothing appears only after hydration, and the crawl path through this
// hub — which is the entire reason the section exists — does not depend
// on JavaScript running.
//
// 🔴 The filters are AND across categories and OR within one. Picking
// "Families" and "Italy" means Italian routes for families, not the
// union of the two — which is what a reader means and the opposite of
// what a naive `.some()` over a flat list of chips produces.

export interface RouteCard {
  slug: string;
  name: string;
  summary: string;
  region: string;
  countries: string[];
  countryNames: string[];
  days: number;
  nights: number;
  months: number[];
  monthsLabel: string;
  suits: TravellerTag[];
}

const MONTH_GROUPS: { id: string; label: string; months: number[] }[] = [
  { id: 'spring', label: 'Spring', months: [3, 4, 5] },
  { id: 'summer', label: 'Summer', months: [6, 7, 8] },
  { id: 'autumn', label: 'Autumn', months: [9, 10, 11] },
  { id: 'winter', label: 'Winter', months: [12, 1, 2] },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'rounded-sm border px-3 py-1.5 text-sm transition-colors',
        active
          ? 'border-line-blue bg-accent-surface font-semibold text-heading'
          : 'border-line-2 bg-surface text-ink-2 hover:border-line-blue',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

export default function RouteLibrary({ routes }: { routes: RouteCard[] }) {
  const [countries, setCountries] = useState<string[]>([]);
  const [tags, setTags] = useState<TravellerTag[]>([]);
  const [season, setSeason] = useState<string | null>(null);

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  // Only the countries and tags that some route actually has. A filter
  // offering a value with no results is a filter that teaches people not
  // to trust it.
  const countryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of routes) {
      r.countries.forEach((c, i) => seen.set(c, r.countryNames[i] ?? c.toUpperCase()));
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [routes]);

  const tagOptions = useMemo(() => {
    const seen = new Set<TravellerTag>();
    for (const r of routes) for (const t of r.suits) seen.add(t);
    return [...seen].sort((a, b) =>
      TRAVELLER_LABEL[a].localeCompare(TRAVELLER_LABEL[b]),
    );
  }, [routes]);

  const shown = useMemo(
    () =>
      routes.filter((r) => {
        if (countries.length && !r.countries.some((c) => countries.includes(c))) {
          return false;
        }
        if (tags.length && !r.suits.some((t) => tags.includes(t))) return false;
        if (season) {
          const group = MONTH_GROUPS.find((g) => g.id === season);
          if (group && !r.months.some((m) => group.months.includes(m))) return false;
        }
        return true;
      }),
    [routes, countries, tags, season],
  );

  const filtering = countries.length > 0 || tags.length > 0 || season !== null;

  return (
    <>
      <section aria-labelledby="filters-heading" className="mt-8">
        <h2 id="filters-heading" className="sr-only">
          Narrow the list
        </h2>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
              Country
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {countryOptions.map(([code, label]) => (
                <Chip
                  key={code}
                  active={countries.includes(code)}
                  onClick={() => setCountries((c) => toggle(c, code))}
                >
                  {label}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
              Who it suits
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tagOptions.map((t) => (
                <Chip
                  key={t}
                  active={tags.includes(t)}
                  onClick={() => setTags((v) => toggle(v, t))}
                >
                  {TRAVELLER_LABEL[t]}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
              When
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {MONTH_GROUPS.map((g) => (
                <Chip
                  key={g.id}
                  active={season === g.id}
                  onClick={() => setSeason((s) => (s === g.id ? null : g.id))}
                >
                  {g.label}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-4 text-sm text-ink-2" data-testid="route-count">
          {filtering ? (
            <>
              Showing {shown.length} of {routes.length} routes.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setCountries([]);
                  setTags([]);
                  setSeason(null);
                }}
              >
                Clear the filters
              </button>
            </>
          ) : (
            <>All {routes.length} routes.</>
          )}
        </p>
      </section>

      {shown.length === 0 ? (
        <p className="mt-8 max-w-prose text-ink-2">
          Nothing matches all of those at once. There are twelve routes in this
          library, not fifty — we would rather have twelve we can stand behind
          than a gap filled with a template.
        </p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {shown.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/routes/${r.slug}`}
                className="flex h-full flex-col rounded-card border border-line-2 bg-surface p-5 hover:border-line-blue"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
                  {r.countryNames.join(' · ')}
                </span>
                <span className="mt-2 text-lg font-bold leading-snug text-heading">
                  {r.name}
                </span>
                <span className="mt-2 flex-1 text-sm leading-6 text-ink-2">
                  {r.summary}
                </span>
                <span className="mt-4 text-xs text-ink-2">
                  {r.days} days · {r.nights} nights · {r.monthsLabel}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
