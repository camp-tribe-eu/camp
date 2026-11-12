import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { alternatesFor } from "@/lib/i18n";
import { breadcrumbList, jsonLdProps } from "@/lib/jsonld";
import { pageContent } from "@/lib/page-content";
import { PageSections } from "@/components/page-sections";
import { LayeredBanner } from "@/components/layered-banner";

// CAMP-209 завела цю сторінку, CAMP-365 забрала з неї текст.
//
// 🔴 ЧОМУ САМЕ ЦЯ СТОРІНКА МУСИТЬ ЛИШИТИСЬ ТОЧНОЮ. Для бельгійської
// юрособи контакт — вимога, а не ввічливість, і афіліат-мережа, яка
// розглядає заявку (CAMP-98), перевіряє саме її. Тому переїзд тут
// доводиться посимвольно: `tests/e2e/contact.spec.ts` тримає всі
// чотири абзаци рядками.
//
// Оболонка лишилась у коді: маршрут, крихти, метадані. Запасного
// тексту немає навмисно — він повернув би хардкод і зробив би збій
// невидимим.

const SLUG = "contact";

export const dynamicParams = false;

export async function generateMetadata(): Promise<Metadata> {
  const page = await pageContent(SLUG);
  if (!page) return { title: "Not found" };
  return {
    // 🔴 `metaTitle` окремо від `title`: на цій сторінці вони різні —
    // «Contact» у заголовку й «Contact CampTribe» для пошуковика.
    title: page.metaTitle ?? page.title,
    description: page.metaDescription ?? undefined,
    alternates: alternatesFor(`/${SLUG}`),
    ...(page.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function Contact() {
  const page = await pageContent(SLUG);
  if (!page) notFound();

  const crumbs = [
    { name: "CampTribe", path: "/" },
    { name: page.title, path: `/${SLUG}` },
  ];

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <script {...jsonLdProps(breadcrumbList(crumbs))} />

      {/* 🔴 БАНЕР НЕСЕ `h1` (CAMP-464). Власник про цю сторінку: «взагалі
          не красиво і сухо». Форма зворотного звʼязку, яку він просить,
          — це нова обробка персональних даних і свій розділ у політиці,
          тож вона йде окремою карткою. А верх сторінка дістає зараз, тим
          самим ходом, що /tools і /about.

          Опис — `metaDescription` сторінки: той самий рядок, яким вона
          вже представляється в пошуку, тож нового твердження тут немає. */}
      <LayeredBanner
        headingLevel={1}
        background={{ src: "/banners/eu-dawn.webp" }}
        tickerText="WRITE TO US"
        heading={page.title}
        description={page.metaDescription ?? undefined}
        minHeight="min(42svh, 340px)"
        textSize={{ desktop: "140px", mobile: "48px" }}
      />

      <div className="mt-6">
        <PageSections sections={page.sections} />
      </div>
    </main>
  );
}
