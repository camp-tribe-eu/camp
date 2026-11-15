import type { Metadata } from 'next';
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
import PostCards from '@/components/post-cards';
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

      {/* 🔴 ШАБЛОН ДОПИСУ ЗА ТЕМОЮ (CAMP-464): темна-світла плашка з
          великою назвою по центру й рядком «автор · дата», під нею —
          обкладинка на всю ширину, далі біла картка з тегами й текстом.
          Було: заголовок ліворуч і вузька колонка без картинки (ревю
          445/5: «пост — вузький текст без обкладинки»).

          Обкладинка — те саме поле, що картка в каталозі, і з тією ж
          перевіркою (`normalizePost`): недійсна адреса — допис без
          обкладинки, а не зламана сторінка. */}
      <article className="mt-4">
        <header className="rounded-card bg-surface-2 px-5 py-10 text-center md:px-10 md:py-14">
          <h1 className="mx-auto max-w-[24ch] text-3xl leading-tight md:text-[48px]">
            {post.title}
          </h1>
          <p className="mt-4 text-sm text-ink-2">
            {summary.authorName ? `By ${summary.authorName} · ` : ''}
            <time dateTime={publishedAt}>{postDate(publishedAt)}</time>
            {` · `}
            <span data-testid="reading-time">{minutes} min read</span>
          </p>
        </header>

        {summary.coverUrl && (
          <figure className="mt-3" data-testid="post-cover">
            {/* eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config. */}
            <img
              src={summary.coverUrl}
              alt={summary.coverAlt ?? ''}
              className="aspect-[16/9] w-full rounded-card object-cover md:aspect-[21/9]"
            />
          </figure>
        )}

        <div className="mt-3 rounded-card bg-surface p-5 md:p-10">
          <div className="mx-auto max-w-read">
            {summary.tags.length > 0 && (
              <ul
                aria-label="Tags"
                className="flex flex-wrap gap-2"
                data-testid="post-tags"
              >
                {summary.tags.map((t) => (
                  <li
                    key={t}
                    className="rounded-md bg-surface-2 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-heading"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            )}
            <div className={`${summary.tags.length > 0 ? 'mt-6 ' : ''}space-y-6`}>
              <PageSections sections={post.sections} />
            </div>
          </div>
        </div>
      </article>

      {neighbours.length > 0 && (
        <nav
          aria-labelledby="read-next"
          className="mt-10 border-t border-line-2 pt-6"
          data-testid="read-next"
        >
          <h2 id="read-next" className="text-base">
            Read next
          </h2>
          {/* 🔴 ТА САМА СЕКЦІЯ, ЩО НА /blog І НА СТОРІНЦІ КРАЇНИ
              (CAMP-465, пункт 3). Тут була власна сітка з власною
              карткою — четверта копія однієї й тієї самої розмітки.
              Копія розходиться з оригіналом тихо: обидві сторінки
              лишаються «нормальними», доки хтось не покладе їх поруч.

              `h3`, бо заголовок розділу «Read next» уже є `h2`. */}
          <div className="mt-4">
            <PostCards
              testId="read-next-cards"
              items={neighbours.map((p) => ({
                key: p.slug,
                href: `/blog/${p.slug}`,
                title: p.title,
                excerpt: p.summary ?? undefined,
                meta: p.publishedAt ? postDate(p.publishedAt) : undefined,
                image: p.coverUrl
                  ? { src: p.coverUrl, alt: p.coverAlt ?? '' }
                  : undefined,
                tags: p.tags,
              }))}
            />
          </div>
        </nav>
      )}
    </main>
  );
}
