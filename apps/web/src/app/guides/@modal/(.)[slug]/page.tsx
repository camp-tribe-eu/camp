import { notFound } from 'next/navigation';
import { getGuide, getGuides } from '@/lib/guides';
import Drawer from '@/components/drawer';
import GuideArticle from '@/components/guide-article';

/**
 * CAMP-460 — той самий гід, але в шухляді.
 *
 * 🔴 ПЕРЕХОПЛЕНИЙ МАРШРУТ `(.)`: він спрацьовує лише на КЛІЄНТСЬКОМУ
 * переході з `/guides`. Та сама адреса, відкрита напряму або з пошуку,
 * іде в `app/guides/[slug]/page.tsx` і віддає повну сторінку з 200.
 * Саме це й відповідає на питання власника: хто клікнув — лишається на
 * місці, хто прийшов із пошуку — бачить сторінку.
 *
 * 🔴 ВМІСТ ОДИН НА ОБИДВА ШЛЯХИ — `GuideArticle`. Два рендери того
 * самого тексту розходяться мовчки: у шухляді забули б позначку
 * походження (ст. 50(2) AI Act), і сторінка казала б одне, а шухляда
 * інше.
 */
export const dynamicParams = false;

type Params = { slug: string };

export async function generateStaticParams(): Promise<Params[]> {
  return (await getGuides()).map((g) => ({ slug: g.slug }));
}

export default async function GuideModal(props: { params: Promise<Params> }) {
  const { slug } = await props.params;
  const guide = await getGuide(slug);
  if (!guide) notFound();
  return (
    <Drawer title={guide.title} testId="guide-drawer">
      <GuideArticle guide={guide} />
    </Drawer>
  );
}
