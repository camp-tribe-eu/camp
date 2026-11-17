import { pagePhoto } from "@/lib/page-photos";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGuide, getGuides, needsAiDisclosure } from "@/lib/guides";
import { abs, jsonLdProps } from "@/lib/jsonld";
import { alternatesFor } from "@/lib/i18n";
import GuideArticle from "@/components/guide-article";
import { Flag } from "@/components/flag";
import { LayeredBanner } from "@/components/layered-banner";
import { countryName } from "@/lib/api";
import { parseGuideSlug, TOPICS } from "@/lib/guide-facets";
import { bannerBackground } from "@/lib/photo-slot";

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
  const facets = parseGuideSlug(slug);
  // Сусідні гайди того ж регіону: той самий префікс `країна-регіон-`.
  // Нічого не вигадуємо — це лише інші записи каталогу.
  const siblings = facets
    ? (await getGuides()).filter(
        (g) =>
          g.slug !== slug &&
          g.slug.startsWith(`${facets.country}-${facets.region}-`) &&
          parseGuideSlug(g.slug)?.region === facets.region,
      )
    : [];

  return (
    <main className="mx-auto max-w-wrap px-4 pb-12 pt-4 xl:px-6">
      <script
        {...jsonLdProps({
          "@context": "https://schema.org",
          "@type": "Article",
          "@id": `${abs(path)}#article`,
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
                "@type": "SoftwareApplication",
                name: guide.generator ?? "generator",
                applicationCategory: "ContentGenerator",
              }
            : { "@type": "Person", name: guide.authorName ?? "CampTribe" },
          publisher: { "@type": "Organization", name: "CampTribe" },
          isAccessibleForFree: true,
        })}
      />

      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/guides" className="text-ink-2 underline">
          Guides
        </Link>
        {facets && (
          <>
            <span aria-hidden="true" className="text-ink-2">
              {" "}
              /{" "}
            </span>
            <Link
              href={`/guides/topic/${facets.topic}`}
              className="text-ink-2 underline"
            >
              {TOPICS[facets.topic]}
            </Link>
          </>
        )}
      </nav>

      {/* CAMP-443/9: банер несе `h1`, як на /guides. Опис — резюме
          самого гайда, а не нове твердження. */}
      <LayeredBanner
        className="mt-3"
        headingLevel={1}
        background={await bannerBackground(
          "guide-hero",
          "/banners/guides.webp",
          facets
            ? (pagePhoto("topic-country", `${facets.country}-${facets.topic}`) ?? pagePhoto("topic", facets.topic))
            : null,
        )}
        tickerText={(facets ? TOPICS[facets.topic] : "Guide").toUpperCase()}
        heading={guide.title}
        description={guide.summary ?? undefined}
        minHeight="min(42svh, 340px)"
        textSize={{ desktop: "120px", mobile: "48px" }}
      />

      {/* Колонка статті за `article.build.css` теми: плашка
          `background-secondary`, відступи 20/12/40 → 48/12/80 від 992,
          основна колонка + бічна 320 px, проміжок 24 → 48. */}
      <div className="mx-auto mt-3 flex max-w-[1304px] flex-col gap-6 rounded-card bg-surface-2 px-3 pb-10 pt-5 lg:flex-row lg:gap-12 lg:pb-20 lg:pt-12">
        <div className="min-w-0 flex-1">
          {(facets || guide.readingMinutes) && (
            <p
              className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold text-heading"
              data-testid="guide-meta"
            >
              {facets && (
                <Link
                  href={`/guides/country/${facets.country}`}
                  className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-surface px-3 py-1.5"
                >
                  <Flag
                    code={facets.country}
                    className="h-3 w-auto rounded-[2px]"
                  />
                  {countryName(facets.country)}
                </Link>
              )}
              {guide.readingMinutes ? (
                <span>{guide.readingMinutes} min read</span>
              ) : null}
            </p>
          )}
          {/* 🔴 Один вміст на два шляхи — сторінку й шухляду
              (CAMP-460). Чому саме так, див. `components/guide-article.tsx`. */}
          <GuideArticle guide={guide} showTitle={false} />
        </div>

        {facets && (
          <aside
            aria-label="More guides"
            className="flex w-full shrink-0 flex-col gap-6 lg:w-80"
            data-testid="guide-sidebar"
          >
            {siblings.length > 0 && (
              <section>
                <h2 className="text-xl">Same region</h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {siblings.map((g) => (
                    <li key={g.slug}>
                      <Link
                        href={`/guides/${g.slug}`}
                        className="font-semibold text-heading underline"
                      >
                        {g.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h2 className="text-xl">Keep browsing</h2>
              <ul className="mt-3 flex flex-col gap-3">
                <li>
                  <Link
                    href={`/guides/topic/${facets.topic}`}
                    className="font-semibold text-heading underline"
                  >
                    All guides: {TOPICS[facets.topic]}
                  </Link>
                </li>
                <li>
                  <Link
                    href={`/guides/country/${facets.country}`}
                    className="font-semibold text-heading underline"
                  >
                    All guides in {countryName(facets.country)}
                  </Link>
                </li>
              </ul>
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
