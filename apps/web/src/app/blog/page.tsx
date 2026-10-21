import type { Metadata } from 'next';
import { alternatesFor } from '@/lib/i18n';
import { pageSlice, postList } from '@/lib/posts';
import BlogIndexView, {
  BLOG_DESCRIPTION,
  BLOG_PATH,
  BLOG_TITLE,
} from '@/components/blog-index';

// CAMP-364 — блог, перша сторінка каталогу.
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

export async function generateMetadata(): Promise<Metadata> {
  const posts = await postList();
  return {
    title: BLOG_TITLE,
    description: BLOG_DESCRIPTION,
    alternates: alternatesFor(BLOG_PATH),
    ...(posts.length === 0 ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function BlogIndex() {
  const all = await postList();
  return <BlogIndexView all={all} posts={pageSlice(all, 1)} page={1} />;
}
