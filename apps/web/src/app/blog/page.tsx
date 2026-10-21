import type { Metadata } from 'next';
import Link from 'next/link';
import { alternatesFor } from '@/lib/i18n';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { postDate, postList } from '@/lib/posts';
import Breadcrumbs from '@/components/breadcrumbs';

// CAMP-364 — блог.
//
// 🔴 ПОРОЖНІЙ БЛОГ НЕ ПОТРАПЛЯЄ В ІНДЕКС, І ЦЕ НЕ ОБЕРЕЖНІСТЬ, А
// ПРАВИЛО КАРТКИ CAMP-365: «сторінка без контенту не має віддавати 200
// із порожнечею». Доки жодного допису немає, сторінка існує (щоб
// власник бачив, куди вони поїдуть), каже про це прямо й стоїть під
// `noindex`. У карті сайту її теж немає — див. `lib/sitemap.ts`.
//
// 🔴 І ЖОДНОГО ПОСИЛАННЯ В МЕНЮ ВІД МЕНЕ. Меню тепер живе в CMS
// (CAMP-365), тож пункт «Blog» додає власник тоді, коли там буде що
// читати. Посилання на порожній розділ — це реклама власного
// беклогу, і головна вже має коментар рівно про це.

const PATH = '/blog';

const TITLE = 'Blog';

const DESCRIPTION =
  'What we are building, what the data says, and what we got wrong.';

export async function generateMetadata(): Promise<Metadata> {
  const posts = await postList();
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: alternatesFor(PATH),
    ...(posts.length === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BlogIndex() {
  const posts = await postList();

  const crumbs = [
    { name: 'CampTribe', path: '/' },
    { name: TITLE, path: PATH },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@graph': [
            collectionGraph({
              name: TITLE,
              description: DESCRIPTION,
              path: PATH,
              items: posts.map((p) => ({
                name: p.title,
                path: `${PATH}/${p.slug}`,
              })),
            }),
            breadcrumbList(crumbs, PATH),
          ],
        })}
      />

      <Breadcrumbs crumbs={crumbs} />

      <h1 className="mt-4 text-3xl font-bold leading-tight md:text-[42px]">
        {TITLE}
      </h1>
      <p className="mt-4 max-w-prose text-ink-2">{DESCRIPTION}</p>

      {posts.length === 0 ? (
        // 🔴 Порожньо сказано словами, а не порожнім списком: читач має
        // зрозуміти, що сторінка працює, а дописів ще немає.
        <p className="mt-8 max-w-prose text-ink-2" data-testid="blog-empty">
          Nothing is published yet. When the first post goes up it will appear
          here, newest first.
        </p>
      ) : (
        <ul className="mt-8 grid gap-6 md:grid-cols-2">
          {posts.map((p) => (
            <li
              key={p.slug}
              className="rounded-card border border-line-2 bg-surface p-5 shadow-card"
            >
              <h2 className="text-base font-semibold">
                <Link
                  href={`${PATH}/${p.slug}`}
                  className="text-heading hover:underline"
                >
                  {p.title}
                </Link>
              </h2>
              {p.publishedAt && (
                <p className="mt-1 text-xs text-ink-2">
                  <time dateTime={p.publishedAt}>
                    {postDate(p.publishedAt)}
                  </time>
                  {p.authorName ? ` · ${p.authorName}` : ''}
                </p>
              )}
              {p.summary && (
                <p className="mt-2 max-w-prose text-sm text-ink-2">
                  {p.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
