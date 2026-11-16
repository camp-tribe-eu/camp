import Link from "next/link";
import { countryName } from "@/lib/api";
import { TOPICS, type GuideFacets, type Topic } from "@/lib/guide-facets";
import { CatalogueProvenance } from "@/components/catalogue-provenance";
import { Flag } from "@/components/flag";
import { LayeredBanner } from "@/components/layered-banner";
import { Block } from "@/components/layout";
import MediaCards from "@/components/media-card";
import { Pagination } from "@/components/pagination";
import { cardProvenanceLabel, type Guide } from "@/lib/guides";
import {
  GUIDES_PER_PAGE,
  guidePageCount,
  orderedTopicGuides,
  topicPagePath,
} from "@/lib/guide-pages";
import { breadcrumbList, collectionGraph, jsonLdProps } from "@/lib/jsonld";

type TopicGuide = Guide & { facets: GuideFacets };

/**
 * Тематична сторінка гайдів — одна на адресу `/guides/topic/x` і на
 * `/guides/topic/x/page/n` (той самий хід, що `blog-index.tsx`: дві
 * копії розмітки розійшлися б тихо).
 *
 * 🔴 КАРТКА — ЄДИНА `MediaCards` (CAMP-443/2): прапор ліворуч, назва,
 * текст, одна кнопка, що називає предмет. Фото в гайдів немає, і ми
 * його не вигадуємо: прапор країни — те, що в записі справді є.
 */
export default function GuideTopicView({
  topic,
  guides,
  page,
  background,
}: {
  topic: Topic;
  /** Усі гайди теми. */
  guides: readonly TopicGuide[];
  page: number;
  /** Фон банера зі слота `guide-topic-hero`; без нього — дефолтний. */
  background?: { src: string; alt: string };
}) {
  const ordered = orderedTopicGuides(guides);
  const pages = guidePageCount(ordered.length);
  const slice = ordered.slice(
    (page - 1) * GUIDES_PER_PAGE,
    page * GUIDES_PER_PAGE,
  );
  const path = topicPagePath(topic, page);
  const countries = [...new Set(ordered.map((g) => g.facets.country))].sort(
    (a, b) => countryName(a).localeCompare(countryName(b)),
  );

  return (
    <main className="mx-auto max-w-wrap px-4 pb-12 pt-4 xl:px-6">
      <script
        {...jsonLdProps(
          collectionGraph({
            name: page > 1 ? `${TOPICS[topic]} — page ${page}` : TOPICS[topic],
            description: `${ordered.length} regions where our records answer this question.`,
            path,
            items: slice.map((g) => ({
              name: g.title,
              path: `/guides/${g.slug}`,
            })),
          }),
        )}
      />
      <script
        {...jsonLdProps(
          breadcrumbList([
            { name: "Guides", path: "/guides" },
            { name: TOPICS[topic], path: `/guides/topic/${topic}` },
            ...(page > 1 ? [{ name: `Page ${page}`, path }] : []),
          ]),
        )}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link href="/guides" className="underline">
              Guides
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page">{TOPICS[topic]}</li>
        </ol>
      </nav>

      {/* Банер несе `h1`, як на /guides (CAMP-443/5). */}
      <LayeredBanner
        className="mt-3"
        headingLevel={1}
        background={background ?? { src: "/banners/guides.webp" }}
        tickerText={TOPICS[topic].toUpperCase()}
        heading={TOPICS[topic]}
        description={`${ordered.length.toLocaleString("en-GB")} regions across ${countries.length} countries. Each one counts what our records hold, and says how many campsites have nothing recorded.`}
        minHeight="min(42svh, 340px)"
        textSize={{ desktop: "120px", mobile: "48px" }}
      />

      <CatalogueProvenance guides={slice} />

      {/* Країни — посиланнями: заголовки по країнах зникли разом із
          довгим переліком, а перехід до гайдів однієї країни лишається. */}
      <nav
        aria-label="Countries"
        className="mt-8"
        data-testid="topic-countries"
      >
        <h2 className="text-xl md:text-[25px]">By country</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {countries.map((cc) => (
            <li key={cc}>
              <Link
                href={`/guides/country/${cc}`}
                className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-surface-2 px-3 py-1.5 text-sm hover:border-line-blue"
              >
                <Flag code={cc} className="h-3 w-auto rounded-[2px]" />
                {countryName(cc)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section className="mt-10" aria-labelledby="topic-guides">
        <h2 id="topic-guides" className="text-xl md:text-[25px]">
          {page > 1 ? `Regions, page ${page} of ${pages}` : "Regions"}
        </h2>
        <Block as="p" measure="read" className="mt-2 text-ink-2">
          {ordered.length.toLocaleString("en-GB")} guides, {slice.length} on
          this page.
        </Block>
        <div className="mt-6">
          <MediaCards
            testId="topic-guide-cards"
            columns={3}
            titleAs="h3"
            items={slice.map((g) => ({
              key: g.slug,
              media: <Flag code={g.facets.country} />,
              title: g.title,
              text: g.summary ?? undefined,
              chips: [
                countryName(g.facets.country),
                ...(cardProvenanceLabel(g.provenance)
                  ? [cardProvenanceLabel(g.provenance) as string]
                  : []),
              ],
              cta: { href: `/guides/${g.slug}`, label: `Read ${g.title}` },
            }))}
          />
        </div>
      </section>

      {pages > 1 && (
        <Pagination
          page={page}
          pages={pages}
          href={(n) => topicPagePath(topic, n)}
          rel={(n) =>
            n === page - 1 ? "prev" : n === page + 1 ? "next" : undefined
          }
          className="mt-10 flex justify-center"
        />
      )}
    </main>
  );
}
