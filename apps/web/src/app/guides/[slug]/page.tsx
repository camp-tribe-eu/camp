import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getGuide,
  getGuides,
  needsAiDisclosure,
} from '@/lib/guides';
import { abs, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';
import GuideArticle from '@/components/guide-article';

// CAMP-66 — one guide.
//
// 🔴 The disclosure sits ABOVE the text, not under it. Article 50(2) of
// the EU AI Act asks for machine-made content to be marked; a mark a
// reader meets after they have read and believed the text is a mark in
// form only. The same reasoning as the travel notice on a campsite page:
// a warning is worth what it is worth at the moment somebody relies on
// the thing it warns about.

export const dynamicParams = false;

type Params = { slug: string };

export async function generateStaticParams(): Promise<Params[]> {
  return (await getGuides()).map((g) => ({ slug: g.slug }));
}

export async function generateMetadata(props: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const guide = await getGuide(slug);
  if (!guide) return {};
  return {
    title: guide.title,
    description: guide.summary ?? undefined,
    alternates: alternatesFor(`/guides/${slug}`),
  };
}

export default async function GuidePage(props: { params: Promise<Params> }) {
  const { slug } = await props.params;
  const guide = await getGuide(slug);
  if (!guide) notFound();

  const path = `/guides/${slug}`;

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script
        {...jsonLdProps({
          '@context': 'https://schema.org',
          '@type': 'Article',
          '@id': `${abs(path)}#article`,
          headline: guide.title,
          description: guide.summary ?? undefined,
          url: abs(path),
          datePublished: guide.publishedAt ?? undefined,
          dateModified: guide.factsCheckedAt ?? guide.publishedAt ?? undefined,
          // 🔴 The machine is named as the author when a machine wrote
          // it. Claiming an organisation authored text a program produced
          // would be the same misrepresentation the label exists to stop.
          author: needsAiDisclosure(guide.provenance)
            ? {
                '@type': 'SoftwareApplication',
                name: guide.generator ?? 'generator',
                applicationCategory: 'ContentGenerator',
              }
            : { '@type': 'Person', name: guide.authorName ?? 'CampTribe' },
          publisher: { '@type': 'Organization', name: 'CampTribe' },
          isAccessibleForFree: true,
        })}
      />

      <p className="text-sm">
        <Link href="/guides" className="text-ink-2 underline">
          Guides
        </Link>
      </p>

      {/* 🔴 Один вміст на два шляхи — сторінку й шухляду
          (CAMP-460). Чому саме так, див. `components/guide-article.tsx`. */}
      <GuideArticle guide={guide} />
    </main>
  );
}
