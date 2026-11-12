import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { alternatesFor } from "@/lib/i18n";
import { breadcrumbList, jsonLdProps } from "@/lib/jsonld";
import { pageContent } from "@/lib/page-content";
import { PageSections } from "@/components/page-sections";
import { LayeredBanner } from "@/components/layered-banner";

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

export const dynamicParams = false;

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

      {/* 🔴 БАНЕР НЕСЕ `h1` СТОРІНКИ (CAMP-464). Власник просив повторити
          структуру сторінки «про нас» демо-стору, і перше, чим вона
          відрізняється від нашої, — у неї є верх. У нас був заголовок на
          білому й одразу стіна тексту.

          Заголовок переїхав УСЕРЕДИНУ банера, а не продублювався під
          ним: два `h1` — це зламаний обрис, а не двічі красиво. Той
          самий хід, що вже зроблено на /tools (CAMP-458).

          Опис — `metaDescription` сторінки, якщо він є: це той самий
          рядок, яким сторінка вже представляється в пошуку, тож нового
          твердження тут не зʼявляється. Немає — немає й рядка. */}
      <LayeredBanner
        headingLevel={1}
        background={{ src: "/banners/about.webp" }}
        tickerText="CAMPTRIBE"
        heading={page.title}
        description={page.metaDescription ?? undefined}
        minHeight="min(52svh, 420px)"
        textSize={{ desktop: "160px", mobile: "56px" }}
      />

      <div className="mt-6">
        <PageSections sections={page.sections} />
      </div>
    </main>
  );
}
