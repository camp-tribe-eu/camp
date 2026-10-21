import { ButtonLink, buttonClasses } from "./button";
import { RichText } from "./rich-text";
import { PAGE_VALUES, type SectionView } from "@/lib/page-content";
import { isInternalHref } from "@/lib/rich-text";
import Link from "next/link";
import { FUEL, FUEL_COUNTRIES, longDate } from "@/lib/fuel";

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

  if (isInternalHref(href)) {
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
/** Один елемент секції `cards`, як його тримає `items` у базі. */
export interface CardItem {
  title: string;
  href: string;
  body: string;
  terms?: Array<{ term: string; text: string }>;
}

/**
 * 🔴 ЩО САМЕ ТУТ ПЕРЕВІРЯЄТЬСЯ, І ЧОМУ НЕ `as CardItem[]`.
 *
 * `items` — це `jsonb`. База не обіцяє ні форми, ні типів: вона віддасть
 * усе, що туди поклали. Привести це типом означало б повірити на слово
 * й намалювати `undefined` там, де читач чекає текст.
 *
 * Адреса кожної картки проходить ТУ САМУ перевірку, що й `cta_href` —
 * інакше повторилась би помилка з рецензії #303, де перевірка стояла в
 * одному місці з двох.
 */
export function cardsOf(items: unknown[], where: string): CardItem[] {
  return items.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const need = (k: string) => {
      const v = o[k];
      if (typeof v !== "string" || v.trim() === "") {
        throw new Error(
          `page-sections: картка ${i} у ${where} не має поля «${k}». ` +
            "Порожня картка на сторінці виглядає як дефект рендера, " +
            "тож секція падає тут, а не малює дірку.",
        );
      }
      return v;
    };
    const href = need("href");
    if (!isInternalHref(href)) {
      throw new Error(
        `page-sections: картка ${i} у ${where} веде на «${href}» — ` +
          "картки ведуть лише на наші сторінки.",
      );
    }
    const terms = Array.isArray(o.terms)
      ? (o.terms as unknown[]).map((t) => {
          const x = (t ?? {}) as Record<string, unknown>;
          return {
            term: String(x.term ?? ""),
            text: String(x.text ?? ""),
          };
        })
      : [];
    return { title: need("title"), href, body: need("body"), terms };
  });
}

function Cards({ section }: { section: SectionView }) {
  const items = cardsOf(section.items, "секції cards");
  return (
    <ul className="mt-8 grid gap-6 md:grid-cols-2">
      {items.map((t) => (
        <li
          key={t.href}
          className="rounded-card border border-line-2 bg-surface p-5"
        >
          <h2 className="text-xl font-semibold">
            <Link className="text-heading underline" href={t.href}>
              {t.title}
            </Link>
          </h2>
          <p className="mt-2 text-ink-2">{t.body}</p>
          {t.terms && t.terms.length > 0 && (
            <dl className="mt-4 space-y-3 text-sm leading-6">
              {t.terms.map((d) => (
                <div key={d.term}>
                  <dt className="font-semibold text-heading">{d.term}</dt>
                  <dd className="text-ink-2">{d.text}</dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * 🔴 СЕКЦІЯ, ЯКУ CMS НЕ НАПОВНЮЄ — І ЦЕ ВМИСНО.
 *
 * Перелік 27 країн генерується з `FUEL_COUNTRIES` — того самого
 * джерела, з якого `generateStaticParams` робить самі сторінки й яке
 * читає карта сайту. Коментар на `/tools` казав це прямо: так перелік
 * «не може назвати сторінку, якої немає, або пропустити одну».
 *
 * Перенести його в CMS означало б віддати цю властивість за можливість
 * редагувати те, що й так породжується. Тому межа така: **текст, що
 * ОПИСУЄ сторінку, їде в CMS; текст, що РАХУЄ або ПЕРЕЛІЧУЄ
 * згенероване, лишається з генератором.**
 *
 * У базі ця секція тримає лише заголовок і речення-підпис, у якому
 * `{{count}}` і `{{bulletin}}` підставляє САМЕ цей рендер — бо лише він
 * знає, скільки їх сьогодні.
 */
function FuelCountries({ section }: { section: SectionView }) {
  const countries = FUEL_COUNTRIES.map((code) => ({
    code,
    name: FUEL.countries[code].name,
  })).sort((a, b) => a.name.localeCompare(b.name));

  const note = (section.body ?? "")
    .replace(/\{\{count\}\}/g, String(countries.length))
    .replace(/\{\{bulletin\}\}/g, longDate(FUEL.bulletinDate));

  return (
    <section aria-labelledby="by-country-heading" className="mt-12">
      <h2 id="by-country-heading" className="text-xl font-bold md:text-[25px]">
        {section.heading}
      </h2>
      {note && <p className="mt-2 max-w-prose text-sm text-ink-2">{note}</p>}
      <ul className="mt-4 flex flex-wrap gap-x-2 gap-y-3">
        {countries.map((c) => (
          <li key={c.code}>
            <ButtonLink
              href={`/tools/camper-trip-cost/${c.code.toLowerCase()}`}
              size="sm"
            >
              {c.name}
            </ButtonLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

const RENDERERS = {
  prose: Prose,
  cta: Cta,
  cards: Cards,
  "fuel-countries": FuelCountries,
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
