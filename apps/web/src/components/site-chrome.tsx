import Link from 'next/link';
import { COMPANY, LEGAL_PAGES, legalPath } from '@/lib/legal';
import { CookieSettingsLink } from './cookie-consent';

// CAMP-41: the header and footer every page wears.
//
// 🔴 The navigation lists only destinations that exist.
//
// The design (CAMP-81) draws five: Map, Routes, Trip Planner, Rentals,
// Guides. Four of them have no page yet — CAMP-31, CAMP-45, CAMP-46,
// CAMP-54, CAMP-66 — and a header full of links to nothing is a worse
// first impression than a short one. It also wastes the crawler's time
// on 404s and teaches a reader that our links are unreliable.
//
// So the list is data, and a page joins it the day it ships. That is one
// line of diff, and it is deliberately harder to forget than it is to
// add a dead link now and remember to fix it later.

interface NavItem {
  href: string;
  label: string;
}

const NAV: NavItem[] = [
  { href: '/map', label: 'Map' },
  { href: '/camping', label: 'Campsites' },
  { href: '/search', label: 'Search' },
  // Added as each ships, not before:
  //   { href: '/routes',  label: 'Routes' },     CAMP-45
  //   { href: '/plan',    label: 'Plan a trip' },CAMP-46
  //   { href: '/rentals', label: 'Rentals' },    CAMP-54
  { href: '/guides', label: 'Guides' }, // CAMP-66
  { href: '/tools', label: 'Tools' }, // CAMP-55
];

export function SiteHeader() {
  return (
    <header className="border-b border-line-2 bg-surface">
      {/* 🔴 Wraps below `sm`, and the height grows with it.

          The fixed 62px row fitted three links by luck, not by design.
          Adding Guides (CAMP-66) pushed it 26px past a 375px screen and
          11px past an iPhone 14 — measured, and caught by the
          no-horizontal-scroll test rather than by anyone looking. The
          list above names four more links still to come, so this was
          going to happen regardless of which card added the fourth.

          Wrapping rather than hiding: a link a reader cannot see is a
          section that does not exist for them, and a horizontally
          scrolling nav with no affordance hides links just as
          effectively. Two short rows on a phone costs 30px and keeps
          every destination visible.

          ⚠️ This is the honest minimum, not a mobile header. Seven
          links will need a real one — that belongs to the design card
          CAMP-81, not here. From `sm` up nothing changes at all, so the
          visual baselines are untouched. */}
      <div className="mx-auto flex min-h-[62px] max-w-wrap flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:h-[62px] sm:flex-nowrap sm:py-0 xl:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-narrow text-[19px] font-bold text-heading"
        >
          <span
            aria-hidden="true"
            className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-amber text-[13px]"
          >
            ⛺
          </span>
          CampTribe
        </Link>

        <nav aria-label="Main" className="ml-auto">
          {/* Wraps too, so the row that wraps can itself wrap once the
              fifth and sixth links arrive. */}
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm font-medium text-ink-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="hover:text-heading">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}

/**
 * ODbL requires attribution wherever the data is shown, so it belongs in
 * the footer of every page rather than being repeated per template and
 * eventually forgotten on one of them.
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line-2 bg-surface">
      <div className="mx-auto max-w-wrap px-4 py-8 text-xs text-ink-2 xl:px-6">
        <p className="max-w-prose">
          Campsite data ©{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            className="underline"
            rel="noopener"
          >
            OpenStreetMap contributors
          </a>
          , available under the{' '}
          <a
            href="https://opendatacommons.org/licenses/odbl/"
            className="underline"
            rel="noopener"
          >
            Open Database License
          </a>
          . Boundaries from Natural Earth. Elevation from the Copernicus
          DEM. Distances and terrain are calculated by CampTribe from that
          data —{' '}
          <Link href="/legal/attribution" className="underline">
            full sources and licences
          </Link>
          .
        </p>

        {/* 🔴 CAMP-56: on every page, because that is where a reader
            looks for them and because the E-Commerce Directive expects
            the operator to be identifiable without hunting. Built from
            LEGAL_PAGES, so a page added to that list cannot be one the
            footer forgets. */}
        <nav aria-label="Legal" className="mt-4">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_PAGES.map((p) => (
              <li key={p.slug}>
                <Link href={legalPath(p.slug)} className="underline">
                  {p.title}
                </Link>
              </li>
            ))}
            <li>
              <CookieSettingsLink />
            </li>
          </ul>
        </nav>

        <p className="mt-4">
          © {new Date().getFullYear()} CampTribe — {COMPANY.name},{' '}
          {COMPANY.city}, {COMPANY.country} ·{' '}
          <a href={`mailto:${COMPANY.email}`} className="underline">
            {COMPANY.email}
          </a>
        </p>
      </div>
    </footer>
  );
}
