import { ButtonLink } from "./button";
import { RichText } from "./rich-text";
import { PAGE_VALUES, type SectionView } from "@/lib/page-content";

// CAMP-365 — рендер універсальних секцій (модель CAMP-362).
//
// 🔴 ТИПИ ПЕРЕЛІЧЕНІ ТУТ, І ЦЕ ЄДИНЕ МІСЦЕ, ДЕ ВОНИ ПЕРЕЛІЧЕНІ.
//
// `page_sections.type` — звичайний `varchar(64)` без CHECK і без enum
// (заміряно: у таблиці рівно два обмеження, PK і FK на `pages`). Саме
// це й дає обіцянку CAMP-362: новий тип секції не потребує ні міграції,
// ні нової колекції. Ціна тієї обіцянки — база може віддати тип, якого
// рендер не знає.
export const SECTION_TYPES = ["prose", "cta"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

function Prose({ section }: { section: SectionView }) {
  return (
    <>
      {section.heading && (
        <h2 className="text-xl font-semibold text-heading">
          {section.heading}
        </h2>
      )}
      {section.body && <RichText text={section.body} values={PAGE_VALUES} />}
    </>
  );
}

function Cta({ section }: { section: SectionView }) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      {section.ctaHref && section.ctaLabel && (
        <ButtonLink
          data-testid={`section-cta-${section.ctaHref.replace(/\W+/g, "-")}`}
          href={section.ctaHref}
          variant="primary"
        >
          {section.ctaLabel}
        </ButtonLink>
      )}
      {section.body && (
        <RichText
          text={section.body}
          values={PAGE_VALUES}
          className="text-sm text-ink-2"
        />
      )}
    </div>
  );
}

/**
 * 🔴 НЕВІДОМИЙ ТИП ПАДАЄ, А НЕ МАЛЮЄ ПОРОЖНЕЧУ.
 *
 * Спокуса тут — `return null` для типу, якого ми не знаємо: сторінка
 * «якось» намалюється. Саме так виглядає найгірший варіант: власник
 * додав секцію в CMS, побачив її в адмінці, а на сайті її немає — і
 * ніщо про це не сказало. Тихо зникла секція читається як «CMS не
 * працює», і шукати будуть не там.
 *
 * Падіння натомість: на збірці воно зупиняє викладку, а на живому
 * сервері Next лишає попередню справну сторінку. Обидва наслідки
 * кращі за мовчазну дірку в тексті.
 */
export function PageSections({ sections }: { sections: SectionView[] }) {
  return (
    <>
      {sections.map((s, i) => {
        if (s.type === "prose") return <Prose key={i} section={s} />;
        if (s.type === "cta") return <Cta key={i} section={s} />;
        throw new Error(
          `page-sections: невідомий тип секції «${s.type}». Відомі: ` +
            `${SECTION_TYPES.join(", ")}. Тип у базі зʼявився без рендера — ` +
            "або додайте рендер, або приберіть секцію; мовчки вона не зникне.",
        );
      })}
    </>
  );
}
