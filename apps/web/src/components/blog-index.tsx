import Link from 'next/link';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { pageCount, postDate, type PostSummary } from '@/lib/posts';
import Breadcrumbs from '@/components/breadcrumbs';

// CAMP-364 — каталог блогу, один на обидва маршрути.
//
// 🔴 `/blog` І `/blog/page/[n]` МАЛЮЮТЬ ОДИН КОМПОНЕНТ НАВМИСНО.
// Дві копії розмітки розійшлися б тихо: сторінка 2 лишилась би без
// хлібних крихт або без JSON-LD, і помітив би це пошуковик, а не ми.

export const BLOG_PATH = '/blog';
export const BLOG_TITLE = 'Blog';
export const BLOG_DESCRIPTION =
  'What we are building, what the data says, and what we got wrong.';

/** Адреса сторінки каталогу: перша — без суфікса. */
export function blogPagePath(n: number): string {
  return n <= 1 ? BLOG_PATH : `${BLOG_PATH}/page/${n}`;
}

export default function BlogIndexView({
  all,
  posts,
  page,
}: {
  /** Весь перелік — потрібен для лічильника сторінок. */
  all: readonly PostSummary[];
  /** Зріз, який малюється. */
  posts: readonly PostSummary[];
  page: number;
}) {
  const total = pageCount(all.length);
  const path = blogPagePath(page);

  const crumbs = [
    { name: 'CampTribe', path: '/' },
    ...(page > 1
      ? [
          { name: BLOG_TITLE, path: BLOG_PATH },
          { name: `Page ${page}`, path },
        ]
      : [{ name: BLOG_TITLE, path }]),
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@graph': [
            collectionGraph({
              name: page > 1 ? `${BLOG_TITLE} — page ${page}` : BLOG_TITLE,
              description: BLOG_DESCRIPTION,
              path,
              items: posts.map((p) => ({
                name: p.title,
                path: `${BLOG_PATH}/${p.slug}`,
              })),
            }),
            breadcrumbList(crumbs, path),
          ],
        })}
      />

      <Breadcrumbs crumbs={crumbs} />

      <h1 className="mt-4 text-3xl font-bold leading-tight md:text-[42px]">
        {BLOG_TITLE}
      </h1>
      <p className="mt-4 max-w-prose text-ink-2">{BLOG_DESCRIPTION}</p>

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
                  href={`${BLOG_PATH}/${p.slug}`}
                  className="text-heading hover:underline"
                >
                  {p.title}
                </Link>
              </h2>
              {p.publishedAt && (
                <p className="mt-1 text-xs text-ink-2">
                  <time dateTime={p.publishedAt}>{postDate(p.publishedAt)}</time>
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

      {/* 🔴 Пагінація зʼявляється лише тоді, коли сторінок БІЛЬШЕ ОДНІЄЇ.
          Самотня кнопка «1» на порожньому блозі це шум, який ще й веде
          сам на себе. */}
      {total > 1 && (
        <nav
          aria-label="Pagination"
          className="mt-10 flex items-center gap-2 border-t border-line-2 pt-6"
          data-testid="pagination"
        >
          {page > 1 && (
            <Link
              href={blogPagePath(page - 1)}
              rel="prev"
              className="rounded-sm border border-line-2 px-3 py-1.5 text-sm hover:bg-surface-2"
            >
              Previous
            </Link>
          )}
          <span className="text-sm text-ink-2" data-testid="page-of">
            Page {page} of {total}
          </span>
          {page < total && (
            <Link
              href={blogPagePath(page + 1)}
              rel="next"
              className="rounded-sm border border-line-2 px-3 py-1.5 text-sm hover:bg-surface-2"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
