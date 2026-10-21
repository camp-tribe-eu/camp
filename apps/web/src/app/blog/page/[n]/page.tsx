import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { alternatesFor } from '@/lib/i18n';
import { pageCount, pageSlice, parsePageNumber, postList } from '@/lib/posts';
import BlogIndexView, {
  BLOG_DESCRIPTION,
  BLOG_TITLE,
  blogPagePath,
} from '@/components/blog-index';

// CAMP-364 — друга й далі сторінки каталогу.
//
// 🔴 `dynamicParams = true` З ТІЄЇ Ж ПРИЧИНИ, ЩО Й У `[slug]`:
// `generateStaticParams` виконується лише під час збірки, а допис,
// що настав за розкладом, збільшує КІЛЬКІСТЬ СТОРІНОК. Із закритою
// множиною одинадцятий допис створив би `/blog/page/2`, яка віддавала б
// 404 до наступного деплою — при тому, що посилання «Next» на неї вже
// стояло б.
export const dynamicParams = true;

export async function generateStaticParams() {
  const total = pageCount((await postList()).length);
  // Перша сторінка живе за адресою `/blog`, тож тут її немає.
  return Array.from({ length: Math.max(0, total - 1) }, (_, i) => ({
    n: String(i + 2),
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ n: string }>;
}): Promise<Metadata> {
  const n = parsePageNumber((await params).n);
  if (n === null) return { title: 'Not found' };
  return {
    title: `${BLOG_TITLE} — page ${n}`,
    description: BLOG_DESCRIPTION,
    alternates: alternatesFor(blogPagePath(n)),
  };
}

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const n = parsePageNumber((await params).n);
  if (n === null) notFound();

  const all = await postList();
  const posts = pageSlice(all, n);
  // 🔴 Сторінка за межами переліку це 404, а не порожній каталог.
  // Порожня сторінка з 200 — запрошення пошуковику індексувати
  // нескінченність `/blog/page/9999`.
  if (posts.length === 0) notFound();

  return <BlogIndexView all={all} posts={posts} page={n} />;
}
