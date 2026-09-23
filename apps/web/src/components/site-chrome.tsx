import Link from 'next/link';

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
  //   { href: '/guides',  label: 'Guides' },     CAMP-66
];

export function SiteHeader() {
  return (
    <header className="border-b border-line-2 bg-surface">
      <div className="mx-auto flex h-[62px] max-w-wrap items-center gap-6 px-4 xl:px-6">
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
          <ul className="flex items-center gap-5 text-sm font-medium text-ink-2">
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
          . Elevation from the Copernicus DEM. Distances and terrain are
          calculated by CampTribe from that data.
        </p>
        <p className="mt-3">
          © {new Date().getFullYear()} CampTribe
        </p>
      </div>
    </footer>
  );
}
