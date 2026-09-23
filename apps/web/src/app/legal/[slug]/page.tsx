import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { alternatesFor } from '@/lib/i18n';
import { COMPANY, LEGAL_PAGES, legalPage, legalPath } from '@/lib/legal';
import { breadcrumbList, jsonLdProps, legalPageGraph } from '@/lib/jsonld';
import Terms from '@/content/legal/terms';
import Privacy from '@/content/legal/privacy';
import Cookies from '@/content/legal/cookies';
import Attribution from '@/content/legal/attribution';
import Notice from '@/content/legal/notice';

// CAMP-56 — the legal pages.
//
// 🔴 Prerendered like everything else, and listed here rather than
// fetched. These are the pages that must still be readable when the
// backend, the CMS or the database is down — and the moment somebody
// needs them is disproportionately likely to be a moment when something
// else has gone wrong.
//
// 🔴 `dynamicParams = false` so /legal/anything-else is a real 404 rather
// than a page that renders empty. A blank document at a legal URL reads
// as "they have no terms", which is worse than not having the URL.

export const dynamicParams = false;

const BODIES: Record<string, () => React.JSX.Element> = {
  terms: Terms,
  privacy: Privacy,
  cookies: Cookies,
  attribution: Attribution,
  notice: Notice,
};

export function generateStaticParams() {
  return LEGAL_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = legalPage(slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.summary,
    alternates: alternatesFor(legalPath(page.slug)),
  };
}

export default async function LegalPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = legalPage(slug);
  const Body = BODIES[slug];
  if (!page || !Body) notFound();

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      {/* 🔴 The version and the date it took effect are in here as well
          as printed above, because "which text applied on that day" is a
          question that may one day be asked of a machine-readable record
          rather than of a person reading the page. */}
      <script
        {...jsonLdProps(
          legalPageGraph({
            name: page.title,
            description: page.summary,
            path: legalPath(page.slug),
            version: page.version,
            effectiveFrom: page.effectiveFrom,
            publisher: COMPANY.name,
          }),
        )}
      />
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'CampTribe', path: '/' },
            { name: page.title, path: legalPath(page.slug) },
          ]),
        )}
      />

      <nav aria-label="Breadcrumb" className="text-xs text-ink-2">
        <Link href="/" className="underline">
          Home
        </Link>{' '}
        · Legal
      </nav>

      <header className="mt-4 border-b border-line-2 pb-5">
        <h1 className="text-2xl font-bold text-heading sm:text-3xl">
          {page.title}
        </h1>
        <p className="mt-2 max-w-prose text-sm text-ink-2">{page.summary}</p>

        {/* 🔴 The version and its date, on the page rather than buried in
            a changelog. "Which text applied on the day I used the site"
            is the question that matters if anything is ever disputed, and
            the answer has to be visible to the reader, not only to us. */}
        <p
          data-testid="legal-version"
          className="mt-3 text-xs text-ink-2"
        >
          Version {page.version} · in force since{' '}
          <time dateTime={page.effectiveFrom}>
            {new Date(page.effectiveFrom).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </time>
        </p>
      </header>

      <article className="mt-6">
        <Body />
      </article>

      <nav
        aria-label="Other legal pages"
        className="mt-12 border-t border-line-2 pt-5"
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          Also here
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LEGAL_PAGES.filter((p) => p.slug !== page.slug).map((p) => (
            <li key={p.slug}>
              <Link href={legalPath(p.slug)} className="underline text-ink-2">
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </main>
  );
}
