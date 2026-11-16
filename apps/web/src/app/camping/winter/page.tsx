import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCountries } from '@/lib/api';
import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { pageContent } from '@/lib/page-content';
import {
  getWinter,
  winterText,
  winterView,
  WINTER_PAGE,
  WINTER_PATH,
} from '@/lib/winter';
import { Block, PageShell } from '@/components/layout';
import { LayeredBanner } from '@/components/layered-banner';

// CAMP-525: /camping/winter — what is recorded as open in winter, and what
// winter camping runs short of.
//
// 🔴 THE ADDRESS. `/camping/winter` sits beside `/camping/[country]` and does
// not collide with it: a static segment wins over a dynamic one, and
// `[country]` is `dynamicParams = false` over the ISO codes of
// `getCountries()` — two letters, so `winter` can never be one.
//
// 🔴 THE WORDS ARE THE CMS'S (page `winter`), THE NUMBERS ARE THE API'S
// (`/spots/winter`). The page is composed in lib/winter.ts, which fills each
// `{{key}}` of a CMS template with a counted number and throws on a key it
// does not supply. No CMS page, or a page missing a slot: 404 — a table of
// figures without its caveat is the half the card forbids.
//
// 🔴 ONLY CAMPSITES WITH A SOURCED «OPEN IN WINTER» ARE COUNTED, and no
// campsite is listed: the page shows counts and links to the filtered region
// hubs, where the list applies the same rule (CAMP-520). Unconfirmed
// campsites cannot reach this page — there is no field for them.
//
// 🔴 NOTHING EMPTY IS DRAWN. No country with a winter record → one sentence
// saying so, no table, no headings over nothing.
//
// 🔴 NO MAP LINK. The map has no water, dump or gas layer today (its layer
// registry lists campsites, wildfire, drought, weather warnings and three
// planned ones); a link to a layer that does not exist would be a promise.

export async function generateMetadata(): Promise<Metadata> {
  const page = await pageContent(WINTER_PAGE);
  if (!page) return { title: 'Not found' };
  return {
    title: page.metaTitle ?? page.title,
    description: page.metaDescription ?? undefined,
    alternates: alternatesFor(WINTER_PATH),
    ...(page.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

const CARD = 'rounded-card border border-line-2 bg-surface p-4';

export default async function WinterPage() {
  const page = await pageContent(WINTER_PAGE);
  if (!page) notFound();
  const text = winterText(page.sections);
  if (!text) notFound();

  // 🔴 The figures and the country list fail soft: a missing API route is
  // «nothing recorded», not a broken page.
  const [data, countries] = await Promise.all([
    getWinter().catch(() => null),
    getCountries().catch(() => []),
  ]);
  const hubs = new Set(countries.map((c) => c.country.toLowerCase()));
  const view = winterView(data, text, hubs);

  const crumbs = [
    { name: 'Camping', path: '/camping' },
    { name: page.title, path: WINTER_PATH },
  ];

  return (
    <PageShell rhythm="tight">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: page.title,
            description: page.metaDescription ?? page.title,
            path: WINTER_PATH,
            items: view.rows
              .filter((r) => r.href !== null)
              .map((r) => ({ name: r.name, path: r.href as string })),
          }),
        )}
      />
      <script {...jsonLdProps(breadcrumbList(crumbs))} />
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link href="/camping" className="hover:text-heading">
              Camping
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{page.title}</li>
        </ol>
      </nav>

      <LayeredBanner
        className="mt-4"
        headingLevel={1}
        background={{ src: '/banners/eu-dawn.webp' }}
        tickerText="WINTER"
        heading={page.title}
        description={page.metaDescription ?? undefined}
        minHeight="min(48svh, 380px)"
        textSize={{ desktop: '140px', mobile: '48px' }}
      />

      <Block as="p" measure="read" className="mt-8 text-ink-2" data-testid="winter-intro">
        {view.intro}
      </Block>

      {view.empty !== null && (
        <Block as="p" measure="read" className="mt-8" data-testid="winter-empty">
          {view.empty}
        </Block>
      )}

      {view.rows.length > 0 && (
        <section aria-labelledby="winter-countries" className="mt-10" data-testid="winter-countries">
          <h2 id="winter-countries" className="scroll-mt-20 text-xl md:text-[25px]">
            {view.countriesHeading}
          </h2>
          {view.lead && (
            <Block as="p" measure="read" className="mt-2 text-ink-2" data-testid="winter-lead">
              {view.lead}
            </Block>
          )}
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {view.rows.map((r) => (
              <li key={r.country} data-country={r.country} className={CARD}>
                <h3 className="text-lg">
                  {r.href ? (
                    <Link href={r.href} className="hover:underline">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </h3>
                <p className="mt-1 text-sm text-ink-2">{r.card}</p>
                {r.regions.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {r.regions.map((g) => (
                      <li key={g.href}>
                        <Link href={g.href} rel="nofollow" className="underline">
                          {g.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {view.none && (
            <Block as="p" measure="read" className="mt-4 text-sm text-ink-2" data-testid="winter-none">
              {view.none}
            </Block>
          )}
        </section>
      )}

      {view.pain && view.services.length > 0 && (
        <section aria-labelledby="winter-pain" className="mt-12" data-testid="winter-pain">
          <h2 id="winter-pain" className="scroll-mt-20 text-xl md:text-[25px]">
            {view.pain.heading}
          </h2>
          <Block as="p" measure="read" className="mt-2 text-ink-2">
            {view.pain.body}
          </Block>
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
            {view.services.map((s) => (
              <section key={s.key} data-service={s.key} className={CARD}>
                <h3 className="text-lg">{s.heading}</h3>
                <p className="mt-2 text-sm text-ink-2">{s.body}</p>
                <ul className="mt-3 space-y-2 border-t border-line pt-3 text-sm">
                  {s.rows.map((r) => (
                    <li key={r.country} data-country={r.country}>
                      <strong className="text-heading">{r.name}</strong>
                      <span className="block text-ink-2">{r.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {view.method && (
            <Block as="p" measure="read" className="mt-4 text-sm text-ink-2" data-testid="winter-method">
              {view.method}
              {view.asOf ? ` ${view.asOf}` : ''}
            </Block>
          )}
        </section>
      )}
    </PageShell>
  );
}
