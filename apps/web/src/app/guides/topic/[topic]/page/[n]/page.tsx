import { pagePhoto } from "@/lib/page-photos";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { byTopic, isTopic, TOPICS } from "@/lib/guide-facets";
import { getGuides } from "@/lib/guides";
import {
  guidePageCount,
  parseGuidePage,
  topicPagePath,
} from "@/lib/guide-pages";
import { alternatesFor } from "@/lib/i18n";
import GuideTopicView from "@/components/guide-topic-view";
import { bannerBackground } from "@/lib/photo-slot";

// CAMP-443/6 — друга й далі сторінки тематичного переліку гайдів.
//
// 🔴 `dynamicParams = false`, як і на першій (CAMP-365): адреса поза
// переліком — 404, а не порожня сторінка з 200. Гайди з'являються
// лише разом зі збіркою, тож і кількість сторінок змінюється разом із нею.
export const dynamicParams = false;

interface Params {
  topic: string;
  n: string;
}

export async function generateStaticParams(): Promise<Params[]> {
  return byTopic(await getGuides()).flatMap((t) =>
    Array.from({ length: guidePageCount(t.guides.length) - 1 }, (_, i) => ({
      topic: t.topic,
      n: String(i + 2),
    })),
  );
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { topic, n } = await props.params;
  const page = parseGuidePage(n);
  if (!isTopic(topic) || page === null) return {};
  return {
    title: `${TOPICS[topic]} — guides, page ${page}`,
    description: `Every region where our records answer one question: ${TOPICS[topic].toLowerCase()}.`,
    alternates: alternatesFor(topicPagePath(topic, page)),
  };
}

export default async function GuidesByTopicPage(props: {
  params: Promise<Params>;
}) {
  const { topic, n } = await props.params;
  const page = parseGuidePage(n);
  if (!isTopic(topic) || page === null) notFound();
  const entry = byTopic(await getGuides()).find((t) => t.topic === topic);
  if (!entry || page > guidePageCount(entry.guides.length)) notFound();
  return (
    <GuideTopicView
      topic={topic}
      guides={entry.guides}
      page={page}
      background={await bannerBackground("guide-topic-hero", "/banners/guides.webp", pagePhoto("topic", topic))}
    />
  );
}
