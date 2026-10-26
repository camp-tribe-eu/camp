import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getGuide,
  getGuides,
  needsAiDisclosure,
  PROVENANCE_LABEL,
} from '@/lib/guides';
import { abs, jsonLdProps } from '@/lib/jsonld';
import { alternatesFor } from '@/lib/i18n';

// CAMP-66 — one guide.
//
// 🔴 The disclosure sits ABOVE the text, not under it. Article 50(2) of
// the EU AI Act asks for machine-made content to be marked; a mark a
// reader meets after they have read and believed the text is a mark in
// form only. The same reasoning as the travel notice on a campsite page:
// a warning is worth what it is worth at the moment somebody relies on
// the thing it warns about.

// 🔴 `true`, І ЦЕ ЗМІНА ПРОТИ CAMP-73 — ЇЇ ЗАСНОВКУ ПЕРЕМІРЯНО 26.10.2026.
//
// CAMP-73 ставила тут `false`, бо з `true` невідома адреса рендерилась на
// вимогу, кликала `notFound()`, і Next віддавав КЛІЄНТСЬКУ оболонку
// помилки: 404 їхав у RSC-навантаженні, тож сторінка була ідеальна в
// браузері й порожня для будь-кого без JS, робота пошуковика включно.
//
// Це більше не так. Заміряно на живій збірці Next 15.5.28, на маршруті
// `/blog/[slug]`, який уже мав `true`:
//     /blog/<неіснуючий> → HTTP 404, 34 418 байт РОЗМІТКИ,
//     у ній «404», «Not found», «page is not here»
// Тобто сторінку-404 тепер рендерить сервер, справжнім HTML.
//
// 🔴 А ЦІНА `false` ВИЯВИЛАСЬ НЕСУМІСНОЮ З ISR (CAMP-396). Документація
// Next каже прямо: під час перевалідації `generateStaticParams` НЕ
// викликається повторно. Ворота Next при цьому — `fallback === false &&
// !isPrerendered → NoFallbackError`. Разом це означає: будь-який
// `revalidateTag` знецінює запис, і сторінка, яку нема з чого
// перевивести, віддає 404 ДО ПЕРЕЗАПУСКУ СЛУЖБИ.
//
// Заміряно на проді 26.10.2026: один виклик `revalidateTag('navigation')`
// поклав 55 269 сторінок кемпінгів і 1 256 гайдів — бо меню живе в
// кореневому макеті, тож його мітку споживає КОЖНА сторінка. Мітка
// `pages` так само клала `/legal/*`, не чіпаючи решти: гине рівно те,
// що мітку їло.
//
// Сторож: scripts/ci/check-dynamic-params.mjs
export const dynamicParams = true;

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

  const label = PROVENANCE_LABEL[guide.provenance];
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

      <h1 className="mt-3 max-w-[22ch] text-3xl font-bold leading-tight md:text-[42px]">
        {guide.title}
      </h1>

      {/* 🔴 Before the text, always. */}
      <aside
        data-testid="provenance"
        data-provenance={guide.provenance}
        className="mt-5 rounded-card border border-line-2 bg-surface-2 p-4 text-sm leading-6 text-ink-2"
      >
        <strong className="font-semibold text-heading">
          {label?.short ?? guide.provenance}
        </strong>
        {label?.explain && <> {label.explain}</>}
        {needsAiDisclosure(guide.provenance) && guide.generator && (
          <> The program is <code>{guide.generator}</code>.</>
        )}
        {guide.authorName && (
          <>
            {' '}
            Written by {guide.authorName}
            {guide.authorCredentials ? ` — ${guide.authorCredentials}` : ''}.
          </>
        )}
        {guide.factsCheckedAt && (
          <>
            {' '}
            The figures were taken from our records on{' '}
            <time dateTime={guide.factsCheckedAt}>
              {new Date(guide.factsCheckedAt).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </time>
            .
          </>
        )}
      </aside>

      {guide.body && (
        <div className="mt-8 max-w-prose space-y-4 text-ink-2">
          {guide.body.split('\n\n').map((block, i) => {
            if (block.startsWith('- ')) {
              return (
                <ul key={i} className="list-disc space-y-1 pl-5">
                  {block.split('\n').map((line, j) => (
                    <li key={j}>{line.replace(/^- /, '')}</li>
                  ))}
                </ul>
              );
            }
            return <p key={i}>{block}</p>;
          })}
        </div>
      )}
    </main>
  );
}
