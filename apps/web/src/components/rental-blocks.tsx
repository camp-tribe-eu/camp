import type { ReactNode } from "react";

import FeatureRow from "./feature-row";
import { Flag } from "./flag";
import { ImageWithText } from "./image-with-text";
import MediaCards, { type MediaCardItem } from "./media-card";
import { termsOf } from "./page-sections";
import { substitute } from "@/lib/rich-text";
import { PAGE_VALUES, type SectionView } from "@/lib/page-content";
import {
  camperTypeName,
  scaleParts,
  type CamperType,
  type Provider,
} from "@/lib/rental-providers";
import { countryName } from "@/lib/api";
import { isUnpublishedCountry } from "@/lib/unpublished-countries";

// CAMP-461 — блоки, спільні для хаба оренди, сторінки країни й сторінки
// компаній.
//
// 🔴 ОДИН НАБІР, А НЕ ТРИ КОПІЇ. Власник просив «одним стилем і форматом по
// всьому проєкту й перевикористовувати, а не малювати кожен раз нові».
// Рядок «текст + фото», картка компанії й чотири значки «що змінюється на
// 3 500 кг» потрібні всім трьом сторінкам оренди, тож живуть тут, а
// сторінки лише розкладають їх.

/**
 * Рядки «текст + фото» зі слотів `story:*` у CMS.
 *
 * 🔴 КАРТИНКА Й ЗАГОЛОВОК ОБОВʼЯЗКОВІ І КИДАЮТЬ. `ImageWithText` без них
 * повертає `null` («порожнє не малюємо»), і для компонента це правильно; для
 * секції з CMS — ні: власник заповнив рядок в адмінці й не побачив його на
 * сайті, а нічого про це не сказало.
 *
 * Чергування — з `variant: "reverse"` у базі, а не за номером: власник
 * сам вирішує, з якого боку фото.
 */
/**
 * 🔴 CAMP-461: КОМПАКТНИЙ БАНЕР ХАБА. Висота банера на широкому екрані
 * визначається ВМІСТОМ (`padding-top: 230px` + тікер + `padding: 104px` у
 * блоці тексту), а не `minHeight`: заміряно 764 px на 1440×900, тож віджет
 * вибору, який власник просив «на першому екрані», опинявся на 860-му px,
 * за краєм. Тут відступи зменшені лише для хаба (клас `ct-rental-banner`);
 * інші сторінки з банером не чіпаються.
 */
const COMPACT_BANNER_CSS = `
@media(min-width:992px){
.ct-rental-banner .ct-banner__main{padding-top:64px;min-height:0}
.ct-rental-banner .ct-banner__box{padding-top:16px;padding-bottom:40px}
}
`;

export function CompactBannerStyle() {
  return (
    <style href="ct-rental-banner" precedence="ct-components">
      {COMPACT_BANNER_CSS}
    </style>
  );
}

const STORY_CSS = `
.ct-rental-story .ct-iwt__heading{font-size:1.5rem;line-height:1.25}
.ct-rental-story .ct-iwt__text{line-height:1.6}
@media(min-width:992px){.ct-rental-story .ct-iwt__heading{font-size:2rem}}
`;

export function RentalStories({
  sections,
  where,
}: {
  sections: readonly SectionView[];
  where: string;
}) {
  return (
    <>
      {sections.length > 0 && (
        <style href="ct-rental-story" precedence="ct-components">
          {STORY_CSS}
        </style>
      )}
      {sections.map((s) => {
        if (!s.heading || s.heading.trim() === "") {
          throw new Error(`${where}: slot "${s.slot}" has no heading.`);
        }
        if (!s.imageUrl || s.imageUrl.trim() === "") {
          throw new Error(`${where}: slot "${s.slot}" has no image.`);
        }
        if (!s.imageAlt || s.imageAlt.trim() === "") {
          throw new Error(
            `${where}: slot "${s.slot}" has no image description (alt).`,
          );
        }
        const href = s.ctaHref ?? "";
        const label = s.ctaLabel ?? "";
        if ((href === "") !== (label === "")) {
          throw new Error(`${where}: slot "${s.slot}" has half a button.`);
        }
        return (
          <div key={s.slot} className="mt-12">
            <ImageWithText
              testId="image-text"
              className="ct-rental-story"
              image={{ src: s.imageUrl, alt: s.imageAlt }}
              caption={s.subheading ?? undefined}
              heading={s.heading}
              text={s.body ? substitute(s.body, PAGE_VALUES) : undefined}
              cta={href ? { href, label } : undefined}
              imagePosition={s.variant === "reverse" ? "right" : "left"}
            />
          </div>
        );
      })}
    </>
  );
}

const MASS_ICONS: ReactNode[] = [
  // Licence
  <svg key="licence" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <circle cx="9" cy="11" r="2" />
    <path d="M6.5 16c.5-1.6 1.6-2.4 2.5-2.4s2 .8 2.5 2.4M14 10h4.5M14 13h3" strokeLinecap="round" />
  </svg>,
  // Tolls
  <svg key="tolls" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M4 20V9l8-5 8 5v11" strokeLinejoin="round" />
    <path d="M9 20v-6h6v6M2.5 20h19" strokeLinecap="round" strokeLinejoin="round" />
  </svg>,
  // Winter
  <svg key="winter" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" strokeLinecap="round" />
    <path d="M9.5 4.5 12 6.5l2.5-2M9.5 19.5 12 17.5l2.5 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>,
  // Payload
  <svg key="payload" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M6.5 8h11l2 11.5h-15L6.5 8Z" strokeLinejoin="round" />
    <path d="M9.5 8a2.5 2.5 0 0 1 5 0" strokeLinecap="round" />
  </svg>,
];

/**
 * «Усе міняється на 3 500 кг» — чотири коротких картки.
 *
 * 🔴 ЗНАЧОК ЙДЕ ЗА ПОЗИЦІЄЮ, І ЦЕ ВІДОМЕ ОБМЕЖЕННЯ. Редактор у CMS не
 * вибирає значок (це був би шлях для чужого SVG), тож перша картка — право,
 * друга — збори, третя — зима, четверта — корисне навантаження. П'ята
 * картка, додана в CMS, дістане картку без значка, а не чужий.
 */
export function MassLine({
  section,
  where,
}: {
  section: SectionView;
  where: string;
}) {
  const items = termsOf(section.items, where);
  return (
    <FeatureRow
      testId="mass-line"
      iconSide="left"
      titleAs="h3"
      items={items.map((it, i) => ({
        key: it.term,
        icon: MASS_ICONS[i],
        title: it.term,
        text: it.text,
      }))}
    />
  );
}

/** Прапор країни компанії; без прапора — двобуквений код (`Flag` це вміє). */
export function homeFlag(code: string): ReactNode {
  return <Flag code={code} />;
}

/**
 * Картка компанії в єдиному форматі «медіа — назва — текст — кнопка».
 *
 * 🔴 ЦИФРИ — ЛИШЕ ЗАЯВЛЕНІ КОМПАНІЄЮ, І СТОРІНКА ЦЕ КАЖЕ ПОРУЧ. `scaleParts`
 * повертає депо, парк і рік із полів `declared*`; тут вони чипи, а не
 * вимір. Картка не вигадує ні рейтингу, ні «найкращого».
 *
 * 🔴 ПОРЯДОК — ЗА НАЗВОЮ, а не за розміром парку: порядок за заявленою
 * компанією цифрою читався б як рейтинг, якого ми не складали.
 */
export function providerCards(
  providers: readonly Provider[],
  types: readonly CamperType[],
): MediaCardItem[] {
  return providers.map((p) => {
    const typed = p.camperTypeSlugs.map((s) =>
      camperTypeName(types as CamperType[], s).toLowerCase(),
    );
    // 🔴 Кіпр не показуємо (рішення власника 26.10.2026): у даних компаній
    // він є, у читача — ні. Рахунок країн видачі іде БЕЗ нього.
    const shown = p.countries.filter((c) => !isUnpublishedCountry(c));
    return {
      key: p.slug,
      media: homeFlag(p.homeCountry),
      title: p.name,
      text: `Based in ${countryName(p.homeCountry)}${
        shown.length > 0
          ? `; hands over vehicles in ${shown.length} ${shown.length === 1 ? "country" : "countries"}`
          : ""
      }.`,
      chips: [
        ...scaleParts(p),
        ...(typed.length > 0 ? [typed.join(", ")] : []),
      ],
      cta: {
        href: `/camper-rental/providers/${p.slug}`,
        label: `View ${p.name}`,
      },
    };
  });
}

export function RentalProviderCards({
  providers,
  types,
  testId,
  columns = 2,
}: {
  providers: readonly Provider[];
  types: readonly CamperType[];
  testId?: string;
  columns?: 1 | 2 | 3;
}) {
  return (
    <MediaCards
      testId={testId}
      columns={columns}
      items={providerCards(providers, types)}
    />
  );
}
