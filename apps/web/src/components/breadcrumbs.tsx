import { Fragment } from 'react';
import Link from 'next/link';
import type { Crumb } from '@/lib/jsonld';

// CAMP-240 — the breadcrumb a reader sees, drawn from the SAME list that
// feeds the one a crawler reads.
//
// 🔴 ONE ARRAY, TWO RENDERINGS. `breadcrumbList()` in lib/jsonld.ts says
// of itself that it mirrors "the ones on screen", and on /routes and
// /search that sentence was false: the JSON-LD named a trail and the page
// showed none. Marking up content a reader cannot see is exactly what
// Google's structured-data guidelines ask sites not to do, and the cheap
// way to make the two impossible to disagree is to not write them twice.
// A page builds `crumbs` once and hands it to both `breadcrumbList(crumbs)`
// and this component.
//
// The last crumb is the page itself: text, not a link, and marked
// `aria-current="page"`. A link from a page to itself is a dead end that
// looks like a way out.

export default function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
      <ol className="flex flex-wrap items-center gap-x-2">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={c.path}>
              {i > 0 && <li aria-hidden="true">/</li>}
              {last ? (
                <li aria-current="page">{c.name}</li>
              ) : (
                <li>
                  <Link href={c.path} className="underline hover:text-heading">
                    {c.name}
                  </Link>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
