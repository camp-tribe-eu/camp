import Link from 'next/link';
import PostCards from '@/components/post-cards';
import { breadcrumbList, collectionGraph, jsonLdProps } from '@/lib/jsonld';
import { pageCount, postDate, type PostSummary } from '@/lib/posts';
import Breadcrumbs from '@/components/breadcrumbs';
import { Block } from '@/components/layout';

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

      <h1 className="mt-4 text-3xl leading-tight md:text-[42px]">
        {BLOG_TITLE}
      </h1>
      <Block as="p" measure="read" className="mt-4 text-ink-2">{BLOG_DESCRIPTION}</Block>

      {posts.length === 0 ? (
        // 🔴 Порожньо сказано словами, а не порожнім списком: читач має
        // зрозуміти, що сторінка працює, а дописів ще немає.
        <Block as="p" measure="read" className="mt-8 text-ink-2" data-testid="blog-empty">
          Nothing is published yet. When the first post goes up it will appear
          here, newest first.
        </Block>
      ) : (
        <div className="mt-8">
          {/* 🔴 СЕКЦІЯ КАТАЛОГУ, А НЕ ВЛАСНА СІТКА (CAMP-465, пункт 3;
              CAMP-449, секція 10). Власник просив, щоб картки матеріалів
              можна було класти на будь-яку сторінку: внизу сторінок він
              хоче чергувати то блог-пости, то інші наші фічі. Доки
              розмітка жила тут, «покласти її на іншу сторінку» означало
              скопіювати — а копія розходиться з оригіналом тихо.

              `h2` тут, бо на цій сторінці картки САМІ є розділом; під
              заголовком секції на іншій сторінці буде `h3`. */}
          <PostCards
            testId="blog-posts"
            titleAs="h2"
            items={posts.map((p) => ({
              key: p.slug,
              href: `${BLOG_PATH}/${p.slug}`,
              title: p.title,
              excerpt: p.summary ?? undefined,
              meta: p.publishedAt
                ? `${postDate(p.publishedAt)}${p.authorName ? ` · ${p.authorName}` : ''}`
                : undefined,
            }))}
          />
        </div>
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
