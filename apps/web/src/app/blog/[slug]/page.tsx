import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { alternatesFor } from '@/lib/i18n';
import { blogPostingGraph, breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import type { PostSummary } from '@/lib/posts';
import {
  postContent,
  postDate,
  postList,
  readingMinutes,
} from '@/lib/posts';
import { PageSections } from '@/components/page-sections';
import Breadcrumbs from '@/components/breadcrumbs';

// CAMP-364 — сторінка допису.
//
// 🔴 `dynamicParams = true`, І ЦЕ ПРОТИЛЕЖНО ДО `/legal/[slug]`.
//
// Перша редакція ставила `false`, як у правових сторінок, і докблок
// нижче стверджував, що мертвих адрес бути не може, бо перелік і вміст
// беруться з однієї множини. Множина справді одна — але читається у два
// РІЗНІ МОМЕНТИ, і переобчислюється лише один із двох читачів.
//
// Заміряно рецензією #308: `generateStaticParams()` виконується ТІЛЬКИ
// під час збірки, а `revalidateTag` і витримка перебудовують наявну
// сторінку, не чіпаючи маніфесту адрес. Отже допис, що настав за
// розкладом, зʼявився б у переліку `/blog` (той перебудовується), а
// його власна адреса віддавала б 404 — до наступного деплою.
//
// Для правових сторінок закрита множина правильна: їх сім, нових не
// буває без релізу. Блог росте в часі, зокрема за розкладом, тому тут
// невідомий слаг має рендеритись на вимогу — і дати 404 лише тоді,
// коли API каже, що допису немає.
export const dynamicParams = true;

/**
 * 🔴 ПЕРЕЛІК АДРЕС І ВМІСТ БЕРУТЬСЯ З ОДНІЄЇ МНОЖИНИ.
 *
 * `postList()` і `postContent()` ходять у сусідні маршрути одного
 * сервісу, а той фільтрує обидва ОДНИМ предикатом `VISIBLE`
 * (`pages.service.ts`). Якби вони розійшлись, збірка згенерувала б
 * сторінку, на яку потім прийшов би 404 — мертва адреса, яку ніхто б
 * не помітив, доки її не відкриють.
 */
export async function generateStaticParams() {
  const posts = await postList();
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await postContent(slug);
  if (!post) return { title: 'Not found' };
  return {
    title: post.metaTitle ?? post.title,
    description: post.metaDescription ?? undefined,
    alternates: alternatesFor(`/blog/${slug}`),
    ...(post.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BlogPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [post, posts] = await Promise.all([postContent(slug), postList()]);
  if (!post) notFound();

  // 🔴 Дата береться з ПЕРЕЛІКУ, а не з тіла сторінки: `PageView` її не
  // несе, і вигадувати «сьогодні» означало б друкувати дату збірки
  // замість дати публікації.
  const summary = posts.find((p) => p.slug === slug);
  if (!summary) {
    throw new Error(
      `допис «${slug}» віддався сторінкою, але його немає в переліку. ` +
        'Два запити розійшлись — це мертва адреса, а не дрібниця.',
    );
  }
  // 🔴 ПЕРЕВІРКА, А НЕ `!`. Дату гарантує обмеження бази
  // (`pages_post_published_has_date`), але гарантія в чужій системі —
  // це привід ПЕРЕВІРИТИ, а не привід замовчати перевірку знаком
  // оклику. Приберуть обмеження — впаде тут із назвою допису, а не
  // намалює «Invalid Date» читачеві.
  const publishedAt = summary.publishedAt;
  if (!publishedAt) {
    throw new Error(
      `допис «${slug}» опублікований без дати. Схема це забороняє ` +
        '(`pages_post_published_has_date`), тож або обмеження зникло, ' +
        'або API віддає не те.',
    );
  }

  const minutes = readingMinutes(post.sections);

  // «Читати далі»: сусіди за датою в тому самому переліку, яким
  // живиться каталог.
  //
  // 🔴 СУСІДИ БЕРУТЬСЯ З ПЕРЕЛІКУ, А НЕ З ОКРЕМОГО ЗАПИТУ. Другий
  // запит з іншим упорядкуванням або іншим фільтром дав би блок
  // «читати далі», який веде на допис, недосяжний із каталогу, —
  // саме той клас розходження, через який вище стоїть перевірка
  // `posts.find`.
  const index = posts.findIndex((p) => p.slug === slug);
  const neighbours = [posts[index - 1], posts[index + 1]].filter(
    (p): p is PostSummary => Boolean(p),
  );

  const path = `/blog/${slug}`;
  const crumbs = [
    { name: 'CampTribe', path: '/' },
    { name: 'Blog', path: '/blog' },
    { name: post.title, path },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-8 xl:px-6">
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@graph': [
            blogPostingGraph({
              name: post.metaTitle ?? post.title,
              description: post.metaDescription,
              path,
              datePublished: publishedAt,
              authorName: summary.authorName,
            }),
            breadcrumbList(crumbs, path),
          ],
        })}
      />

      <Breadcrumbs crumbs={crumbs} />

      <article className="mt-4">
        <header className="border-b border-line-2 pb-5">
          <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
            {post.title}
          </h1>
          <p className="mt-3 text-sm text-ink-2">
            <time dateTime={publishedAt}>{postDate(publishedAt)}</time>
            {summary.authorName ? ` · ${summary.authorName}` : ''}
            {` · `}
            <span data-testid="reading-time">{minutes} min read</span>
          </p>
        </header>

        <div className="mt-6 space-y-6">
          <PageSections sections={post.sections} />
        </div>
      </article>

      {neighbours.length > 0 && (
        <nav
          aria-labelledby="read-next"
          className="mt-10 border-t border-line-2 pt-6"
          data-testid="read-next"
        >
          <h2 id="read-next" className="text-base font-semibold">
            Read next
          </h2>
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {neighbours.map((p) => (
              <li
                key={p.slug}
                className="rounded-card border border-line-2 bg-surface p-4 shadow-card"
              >
                <Link
                  href={`/blog/${p.slug}`}
                  className="text-sm font-semibold text-heading hover:underline"
                >
                  {p.title}
                </Link>
                {p.publishedAt && (
                  <p className="mt-1 text-xs text-ink-2">
                    <time dateTime={p.publishedAt}>
                      {postDate(p.publishedAt)}
                    </time>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  );
}
