import type { Metadata } from "next";
import { LayeredBanner } from "@/components/layered-banner";
import { Block } from "@/components/layout";
import ProviderCatalogue from "@/components/provider-catalogue";
import { RentalStories } from "@/components/rental-blocks";
import { collectionGraph, jsonLdProps } from "@/lib/jsonld";
import { pageContent } from "@/lib/page-content";
import { claimSlots, withButton } from "@/lib/slots";
import { listCamperTypes, listProviders } from "@/lib/rental-providers";

// CAMP-427 — сторінка вибору провайдера. CAMP-461 — вона ж як вітрина.
//
// 🔴 Дані беруться у ЗБІРЦІ, звуження робить браузер: сайт статичний, а
// компаній десяток. Правило звуження живе в `lib/rental-providers.ts`,
// тобто в одному місці, а не копією в компоненті.
//
// 🔴 CAMP-461: ЦЕ, ЗА СЛОВАМИ ВЛАСНИКА, «ОДНА З НАЙЦІННІШИХ СТОРІНОК
// ПРОЄКТУ», І ВОНА БУЛА НАЙСУХІШОЮ: текстові рядки «EE · 1 depot · fleet of
// 3», без банера, без значків, без кнопки. Тепер: банер, бокова панель
// фільтрів із значками, картки в єдиному форматі (прапор, назва, цифри,
// кнопка) і два рядки «фото + текст», що ведуть далі по сайту.
//
// Текст над і під каталогом — у CMS (`camper-rental-providers`), і слоти
// перевіряються так само, як на хабі: слот, якого сторінка не знає, не
// зникає мовчки.
const SLOTS = {
  one: ["banner", "intro"],
  many: /^story:\d+$/,
} as const;

export const metadata: Metadata = {
  title: "Camper rental in the EU: companies, services and fleet",
  description:
    "Camper rental companies in the European Union, with the services and fleet each one lists. Every fact carries its source and the date it was checked.",
};

export default async function ProvidersPage() {
  // 🔴 CAMP-371. Таксономія типів іде поруч із компаніями, і теж у збірці:
  // пʼять типів з бази, не константа в коді.
  const [all, types, page] = await Promise.all([
    listProviders(),
    listCamperTypes(),
    pageContent("camper-rental-providers"),
  ]);
  if (!page) throw new Error("camper-rental-providers: the page is missing from the CMS");
  const slots = claimSlots(page.sections, SLOTS, "camper-rental-providers");
  const banner = withButton(slots.one.banner, "camper-rental-providers");
  const intro = slots.one.intro;

  return (
    <main className="mx-auto max-w-wrap px-4 pb-12 pt-4 xl:px-6">
      {/* 🔴 Структуровані дані на КОЖНІЙ сторінці — вимога сторожа
          `check-structured-data`, і він спіймав цю сторінку порожньою.
          CollectionPage зі списком компаній описує рівно те, чим сторінка
          є: перелік, а не стаття. */}
      <script
        {...jsonLdProps(
          collectionGraph({
            name: "Camper rental companies in the EU",
            description:
              "Camper rental companies in the European Union, with the services and fleet each one lists.",
            path: "/camper-rental/providers",
            items: all.map((p) => ({
              name: p.name,
              path: `/camper-rental/providers/${p.slug}`,
            })),
          }),
        )}
      />

      <LayeredBanner
        headingLevel={1}
        background={{ src: "/banners/eu-dawn.webp" }}
        foreground={{
          src: "/banners/camper.webp",
          alt: "A white camper van on a straight road through green fields at sunrise",
        }}
        tickerText={banner.subheading ?? banner.heading.toUpperCase()}
        heading={banner.heading}
        description={banner.body}
        cta={{ href: banner.ctaHref, label: banner.ctaLabel }}
        minHeight="min(46svh, 380px)"
        textSize={{ desktop: "140px", mobile: "48px" }}
      />

      {intro.body && (
        <div className="mt-8">
          {intro.heading && (
            <h2 className="text-xl text-heading">{intro.heading}</h2>
          )}
          <Block as="p" measure="read" className="mt-2 text-ink-2">
            {intro.body}
          </Block>
        </div>
      )}

      {all.length === 0 ? (
        <p className="mt-8">The catalogue is not filled in yet.</p>
      ) : (
        <div className="mt-8">
          <ProviderCatalogue all={all} types={types} />
        </div>
      )}

      <RentalStories sections={slots.many} where="camper-rental-providers" />
    </main>
  );
}
