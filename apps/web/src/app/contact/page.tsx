import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { alternatesFor } from "@/lib/i18n";
import { breadcrumbList, jsonLdProps } from "@/lib/jsonld";
import { pageContent } from "@/lib/page-content";
import { PageSections } from "@/components/page-sections";
import { sectionsBySlot } from "@/lib/page-layout";
import { LayeredBanner } from "@/components/layered-banner";
import ContactForm from "@/components/contact-form";

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

  // 🔴 ДВІ КОЛОНКИ ЗА ТЕМОЮ (CAMP-464): ліворуч вступ (`intro`) і контакти
  // (`details`), праворуч картка (`aside`), під ними решта секцій. Слот на
  // сторінці унікальний — одне місце, одна секція. Секція в місці, якого
  // тут немає, КИДАЄ — див. `lib/page-layout.ts`.
  const { bySlot, rest } = sectionsBySlot(
    page.sections,
    ["intro", "details", "aside"] as const,
    "/contact",
  );

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

      {/* 🔴 ФОРМА Є (CAMP-441, пункт 31 ревʼю), І ВОНА НІЧОГО НЕ ЗБЕРІГАЄ.
          Раніше тут стояв коментар «форми немає»: єдиний відкритий
          ендпоінт був привʼязаний до кемпінгу, а нова форма — це нова
          обробка персональних даних. Тепер `POST /contact` перетворює
          повідомлення на ОДИН ЛИСТ на скриньку проєкту (той самий SMTP, що
          шле листи акаунтів) і нічого не кладе в базу; розділ «Writing to
          us» політики приватності каже це словами, а під кнопкою стоїть
          речення з посиланням на нього. Картка CMS із кнопкою `mailto:`
          лишається під формою: це запасний шлях, і він потрібен, коли
          пошта на боці API недоступна. */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-12">
        <div data-testid="contact-intro">
          <PageSections sections={bySlot.intro} />
          <PageSections sections={bySlot.details} />
        </div>
        <div data-testid="contact-aside" className="grid gap-8">
          <ContactForm />
          <PageSections sections={bySlot.aside} />
        </div>
      </div>

      <PageSections sections={rest} />
    </main>
  );
}
