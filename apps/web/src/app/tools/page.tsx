import type { Metadata } from "next";
import { notFound } from "next/navigation";

import Breadcrumbs from "@/components/breadcrumbs";
import { breadcrumbList, collectionGraph, jsonLdProps } from "@/lib/jsonld";
import { alternatesFor } from "@/lib/i18n";
import { pageContent } from "@/lib/page-content";
import { PageSections, cardsFrom } from "@/components/page-sections";

// CAMP-55 завела цей розділ, CAMP-365 забрала з нього текст.
//
// 🔴 ЦЯ СТОРІНКА ПЕРЕЇХАЛА ЧАСТКОВО, І МЕЖА ТУТ ПРЕДМЕТНА.
//
// Текст, що ОПИСУЄ сторінку — вступ, картки інструментів, завершальний
// абзац, — живе в CMS. Текст, що РАХУЄ або ПЕРЕЛІЧУЄ згенероване —
// перелік 27 країн і дата паливного бюлетеня, — лишається з
// генератором: перелік будується з `FUEL_COUNTRIES`, того самого
// джерела, з якого робляться самі сторінки й карта сайту. Саме тому він
// «не може назвати сторінку, якої немає, або пропустити одну», і саме
// цю властивість переїзд у CMS забрав би.
//
// 🔴 РОЗМІТКА JSON-LD ТЕПЕР БЕРЕ ПЕРЕЛІК ІЗ CMS, а не з власної копії.
// Доки `TOOLS` жив тут, колекція й картки читались з одного масиву.
// Після переїзду вони могли б розійтись — колекція казала б про два
// інструменти, а сторінка показувала б три. Тож джерело одне.

const SLUG = "tools";

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

export async function generateMetadata(): Promise<Metadata> {
  const page = await pageContent(SLUG);
  if (!page) return { title: "Not found" };
  return {
    title: page.metaTitle ?? page.title,
    description: page.metaDescription ?? undefined,
    alternates: alternatesFor(`/${SLUG}`),
    ...(page.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function ToolsIndex() {
  const page = await pageContent(SLUG);
  if (!page) notFound();

  const crumbs = [
    { name: "CampTribe", path: "/" },
    { name: page.title, path: `/${SLUG}` },
  ];

  // 🔴 Той самий розбір, що й у рендера карток: якщо форма в базі
  // зіпсується, впаде і тут, і там — однаково й гучно, а не так, що
  // розмітка каже одне, а сторінка показує інше.
  // 🔴 Той самий розбір, що й у рендера карток, і те саме імʼя типу —
  // один раз. Якщо форма в базі зіпсується, впаде і тут, і там:
  // однаково й гучно, а не так, що розмітка каже одне, а сторінка
  // показує інше.
  const cards = cardsFrom(page.sections, "секції cards на /tools");

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      {/* 🔴 CAMP-240. Колекція — це ДВА інструменти, бо саме їх дають
          читачеві; 27 країн нижче це другий вхід, не частина колекції. */}
      <script
        {...jsonLdProps(
          collectionGraph({
            name: page.title,
            description:
              "Free planning tools for camper trips in the EU, built on published data.",
            path: `/${SLUG}`,
            items: cards.map((t) => ({ name: t.title, path: t.href })),
          }),
        )}
      />
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <Breadcrumbs crumbs={crumbs} />

      <h1 className="mt-4 text-3xl font-bold leading-tight md:text-[42px]">
        {page.title}
      </h1>

      <div className="mt-4">
        <PageSections sections={page.sections} />
      </div>
    </main>
  );
}
