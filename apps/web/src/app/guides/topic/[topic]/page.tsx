import { pagePhoto } from "@/lib/page-photos";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { byTopic, isTopic, TOPICS } from "@/lib/guide-facets";
import { getGuides } from "@/lib/guides";
import { alternatesFor } from "@/lib/i18n";
import GuideTopicView from "@/components/guide-topic-view";
import { bannerBackground } from "@/lib/photo-slot";

// CAMP-210 — the other facet. See `country/[cc]/page.tsx` for why these
// live under a static segment rather than beside the articles.
//
// This one is the larger of the two: "water" covers 466 regions. Grouped
// by country so the page has structure rather than a 466-item run, and
// so a reader scanning for one country finds it by heading.

interface Params {
  topic: string;
}

// 🔴 CAMP-365: параметр поза переліком мусить дати 404, а не рендеритись
// на запит. Сім інших динамічних сегментів це вже оголошували, ці два —
// ні. Наслідок став видимий, коли шапка почала ходити по меню в базу:
// маршрут, що рендериться на запит при недосяжному API, віддає 500 з
// голою сторінкою Next, і `app/error.tsx` його не ловить — виняток у
// кореневому макеті йде повз сусідній боундарі. З `false` той самий
// запит чесно віддає 404.
export const dynamicParams = false;

export async function generateStaticParams() {
  return byTopic(await getGuides()).map((t) => ({ topic: t.topic }));
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { topic } = await props.params;
  if (!isTopic(topic)) return {};
  return {
    title: `${TOPICS[topic]} — guides`,
    description: `Every region where our records answer one question: ${TOPICS[topic].toLowerCase()}.`,
    alternates: alternatesFor(`/guides/topic/${topic}`),
  };
}

export default async function GuidesByTopic(props: {
  params: Promise<Params>;
}) {
  const { topic } = await props.params;
  // 🔴 Checked against the declared set, not against whatever arrives.
  // `/guides/topic/anything` must be a 404, or it is an address that
  // renders an empty page and invites the index to keep it.
  if (!isTopic(topic)) notFound();

  const entry = byTopic(await getGuides()).find((t) => t.topic === topic);
  if (!entry) notFound();

  // CAMP-443/6: перша сторінка; решта — `page/[n]/page.tsx`.
  return (
    <GuideTopicView
      topic={topic}
      guides={entry.guides}
      page={1}
      background={await bannerBackground("guide-topic-hero", "/banners/guides.webp", pagePhoto("topic", topic))}
    />
  );
}
