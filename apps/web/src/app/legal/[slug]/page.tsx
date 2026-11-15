import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LegalProse } from '@/components/legal-prose';
import { alternatesFor } from '@/lib/i18n';
import { COMPANY, LEGAL_PAGES, legalPage, legalPath } from '@/lib/legal';
import { legalDocument, legalSlugs } from '@/lib/legal-content';
import { breadcrumbList, jsonLdProps, legalPageGraph } from '@/lib/jsonld';

// CAMP-56 — the legal pages. CAMP-365 — and their text comes from the CMS.
//
// 🔴 READ AT BUILD TIME, RENDERED STATICALLY. Two decisions meet here and
// both are kept:
//
//   · CAMP-56: these are the pages that must still be readable when the
//     backend, the CMS or the database is down — and the moment somebody
//     needs them is disproportionately likely to be a moment when
//     something else has gone wrong.
//   · CAMP-365: the owner edits the text in the CMS.
//
// The owner edits → a rebuild (or ISR, CAMP-363) ships the new page. The
// database goes down at runtime → the reader is served the last good
// static page, because the reader never talks to the database at all.
//
// 🔴 AND THE OTHER HALF: IF THE DOCUMENT IS MISSING OR ITS BODY IS EMPTY,
// THE BUILD FAILS, naming the document (see `lib/legal-content.ts`). An
// empty legal document at a legal URL reads as "they have no terms",
// which is worse than not having the URL. On a live server the same rule
// means a failed regeneration leaves the reader the previous good page.
//
// 🔴 `dynamicParams = false` so /legal/anything-else is a real 404 rather
// than a page that renders empty.

export const dynamicParams = false;

/**
 * 🔴 The slugs come from the API — the same source as the text — and
 * `legalSlugs` refuses a set that differs from the registry in
 * `lib/legal.ts` in either direction. Taken from the API alone, a
 * document the CMS had stopped serving would simply get no page.
 */
export async function generateStaticParams() {
  return (await legalSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!legalPage(slug)) return {};
  // 🔴 From the document, not from the registry: what the title bar and
  // the search snippet say must be what the page says.
  const doc = await legalDocument(slug);
  return {
    title: doc.title,
    description: doc.summary,
    alternates: alternatesFor(legalPath(doc.slug)),
  };
}

export default async function LegalPageRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!legalPage(slug)) notFound();
  // Throws, naming the document, if it is missing or its body is empty.
  const doc = await legalDocument(slug);
  const otherPagesListedInBody = LEGAL_PAGES.filter(
    (p) => p.slug !== doc.slug,
  ).every((p) => doc.body.includes(`](${legalPath(p.slug)})`));

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      {/* 🔴 The version and the date it took effect are in here as well
          as printed above, because "which text applied on that day" is a
          question that may one day be asked of a machine-readable record
          rather than of a person reading the page. */}
      <script
        {...jsonLdProps(
          legalPageGraph({
            name: doc.title,
            description: doc.summary,
            path: legalPath(doc.slug),
            version: doc.version,
            effectiveFrom: doc.effectiveFrom,
            publisher: COMPANY.name,
          }),
        )}
      />
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: 'CampTribe', path: '/' },
            { name: doc.title, path: legalPath(doc.slug) },
          ]),
        )}
      />

      <nav aria-label="Breadcrumb" className="text-xs text-ink-2">
        <Link href="/" className="underline">
          Home
        </Link>{' '}
        · Legal
      </nav>

      {/* 🔴 ЗАГОЛОВОК ВЕЛИКИЙ І ПО ЦЕНТРУ, КОЛОНКА ТЕКСТУ — ПО ЦЕНТРУ (CAMP-464).
          Як `.shopify-policy__container{max-width:840px;margin:0 auto}` у
          теми: центрується СЕКЦІЯ цілком, тож заголовок і текст не
          розʼїжджаються. Було: малий заголовок ліворуч і колонка 540 px,
          права половина порожня (ревю 445/7). ТЕКСТ документів не
          змінено — лише верстка (його читає `scripts/seo/legal-review.json`). */}
      <header className="mx-auto mt-4 max-w-[840px] border-b border-line-2 pb-5 text-center">
        <h1 className="text-4xl leading-tight text-heading md:text-[56px]">
          {doc.title}
        </h1>
        <p className="mx-auto mt-3 max-w-read text-sm text-ink-2">{doc.summary}</p>

        {/* 🔴 The version and its date, on the page rather than buried in
            a changelog. "Which text applied on the day I used the site"
            is the question that matters if anything is ever disputed, and
            the answer has to be visible to the reader, not only to us. */}
        <p
          data-testid="legal-version"
          className="mt-3 text-xs text-ink-2"
        >
          Version {doc.version} · in force since{' '}
          <time dateTime={doc.effectiveFrom}>
            {new Date(doc.effectiveFrom).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </time>
        </p>
      </header>

      <article className="mx-auto mt-6 max-w-[840px]">
        <LegalProse text={doc.body} />
      </article>

      {/* 🔴 ПЕРЕЛІК ІНШИХ СТОРІНОК — ОДИН РАЗ (CAMP-464). Документ «Legal
          notice» сам несе в тексті розділ «The other pages» з посиланнями на
          всі інші; цей блок додавав їх удруге, а підвал — утретє. Текст
          документа міняти не можна, тож блок ховається, коли текст уже
          називає КОЖНУ іншу сторінку. */}
      {!otherPagesListedInBody && (
      <nav
        aria-label="Other legal pages"
        className="mx-auto mt-12 max-w-[840px] border-t border-line-2 pt-5"
      >
        <h2 className="text-xs uppercase tracking-wide text-ink-2">
          Also here
        </h2>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LEGAL_PAGES.filter((p) => p.slug !== doc.slug).map((p) => (
            <li key={p.slug}>
              <Link href={legalPath(p.slug)} className="underline text-ink-2">
                {p.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      )}
    </main>
  );
}
