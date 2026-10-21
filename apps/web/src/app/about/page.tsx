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

export const dynamicParams = false;

export async function generateMetadata(): Promise<Metadata> {
  const page = await pageContent(SLUG);
  if (!page) return { title: "Not found" };
  return {
    title: page.title,
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
