import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { alternatesFor } from '@/lib/i18n';
import { blogPostingGraph, breadcrumbList, jsonLdProps } from '@/lib/jsonld';
import { postContent, postDate, postList } from '@/lib/posts';
import { PageSections } from '@/components/page-sections';
import Breadcrumbs from '@/components/breadcrumbs';

// CAMP-364 — сторінка допису.
//
// 🔴 `dynamicParams = false`: /blog/будь-що інше — справжній 404, а не
// сторінка, що намалювалась порожньою. Те саме міркування, що в
// `/legal/[slug]`: порожній документ за адресою читається як «у них
// цього немає», і гірше — потрапляє в індекс.

export const dynamicParams = false;

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
          {(
            <p className="mt-3 text-sm text-ink-2">
              <time dateTime={publishedAt}>
                {postDate(publishedAt)}
              </time>
              {summary.authorName ? ` · ${summary.authorName}` : ''}
            </p>
          )}
        </header>

        <div className="mt-6 space-y-6">
          <PageSections sections={post.sections} />
        </div>
      </article>
    </main>
  );
}
