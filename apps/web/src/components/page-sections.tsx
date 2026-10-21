import { ButtonLink, buttonClasses } from "./button";
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
// 🔴 ПЕРЕЛІК ТИПІВ — ЦЕ КЛЮЧІ КАРТИ РЕНДЕРІВ, А НЕ ДРУГИЙ СПИСОК.
//
// Перша редакція тримала `SECTION_TYPES = ["prose","cta"]` поруч із
// ланцюжком `if`. Рецензія провела мутацію: додала `"faq"` у перелік,
// не додавши рендера, — і ВСІ 4 тести лишились зеленими, а повідомлення
// про помилку почало називати `faq` серед «Відомих». Тобто сторож
// підказував би тип, якого намалювати не вміє.
//
// Тепер розійтись неможливо за побудовою: перелік ВИВОДИТЬСЯ з карти
// (нижче, після самих рендерів).

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
  const href = section.ctaHref;
  const label = section.ctaLabel;

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      {href && label && <CtaButton href={href} label={label} />}
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
 * 🔴 `next/link` НЕ ДЛЯ `mailto:`, І ДІМ ЦЕ ВЖЕ ЗНАВ.
 *
 * `ButtonLink` ходить через `next/link`, тобто вміє клієнтський перехід
 * — для внутрішнього шляху це правильно. Але попередня сторінка
 * `/contact` навмисно малювала свою кнопку ЗВИЧАЙНИМ якорем із тими
 * самими класами (`buttonClasses('primary')`), бо її адреса — `mailto:`.
 * Я б цього не помітив, якби не перечитав сторінку перед переїздом:
 * мій перший рендер секції віддавав усе через `ButtonLink`.
 *
 * Отже розрізняємо за тим самим правилом, що й у `rich-text`: шлях від
 * кореня — внутрішній, решта — ні.
 */
function CtaButton({ href, label }: { href: string; label: string }) {
  const testId = `section-cta-${href.replace(/\W+/g, "-")}`;

  if (href.startsWith("/")) {
    return (
      <ButtonLink data-testid={testId} href={href} variant="primary">
        {label}
      </ButtonLink>
    );
  }
  return (
    <a
      data-testid={testId}
      href={href}
      className={buttonClasses("primary")}
      data-ct-button="primary"
    >
      {label}
    </a>
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
const RENDERERS = {
  prose: Prose,
  cta: Cta,
} as const;

export const SECTION_TYPES = Object.keys(RENDERERS) as Array<
  keyof typeof RENDERERS
>;
export type SectionType = keyof typeof RENDERERS;

export function PageSections({ sections }: { sections: SectionView[] }) {
  return (
    <>
      {sections.map((s, i) => {
        const Render = RENDERERS[s.type as SectionType];
        if (Render) return <Render key={i} section={s} />;
        throw new Error(
          `page-sections: невідомий тип секції «${s.type}». Відомі: ` +
            `${SECTION_TYPES.join(", ")}. Тип у базі зʼявився без рендера — ` +
            "або додайте рендер, або приберіть секцію; мовчки вона не зникне.",
        );
      })}
    </>
  );
}
