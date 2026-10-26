import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { alternatesFor } from "@/lib/i18n";
import { breadcrumbList, jsonLdProps } from "@/lib/jsonld";
import { pageContent } from "@/lib/page-content";
import { PageSections } from "@/components/page-sections";

// CAMP-209 завела цю сторінку, CAMP-365 забрала з неї текст.
//
// 🔴 ЩО ТУТ ЛИШИЛОСЬ І ЧОМУ. Лишилась ОБОЛОНКА: маршрут, хлібні
// крихти, метадані й виклик рендера секцій. Текст поїхав у CMS, бо
// його пише власник, а не розробник.
//
// 🔴 ЧОГО ТУТ НЕМАЄ НАВМИСНО: запасного тексту в коді. Він повернув би
// той самий хардкод і зробив би збій невидимим — сторінка малювалась
// би «правильно» й тоді, коли CMS недосяжна. Замість нього виняток у
// `pageContent`: на збірці він зупиняє викладку, а на живому сервері
// Next лишає попередню справну сторінку.
//
// 🔴 А `notFound()` — це інше. Він для випадку, коли сторінки в CMS
// НЕМАЄ: тоді 404 чесний. Плутати «CMS мовчить» із «сторінки немає»
// не можна: перше треба лагодити, друге нормально.

const SLUG = "about";

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

export default async function About() {
  const page = await pageContent(SLUG);
  if (!page) notFound();

  const crumbs = [
    { name: "CampTribe", path: "/" },
    { name: page.title, path: `/${SLUG}` },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">
        {page.title}
      </h1>

      <div className="mt-6">
        <PageSections sections={page.sections} />
      </div>
    </main>
  );
}
