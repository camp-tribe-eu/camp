import { ButtonLink, buttonClasses } from "./button";
import { RichText } from "./rich-text";
import { PAGE_VALUES, type SectionView } from "@/lib/page-content";
import { isInternalHref, substitute } from "@/lib/rich-text";
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

/**
 * 🔴 `variant` — НЕ ПРИКРАСА. Заміряно рецензією #304: завершальний
 * абзац /tools мав `mt-10 max-w-prose text-ink-3`, а після переїзду
 * дістав типові `max-w-prose space-y-4 text-ink-2` — тобто втратив
 * верхній відступ і приглушений колір, опинившись упритул до переліку
 * 27 країн.
 *
 * 🔴 І ПОСИМВОЛЬНА ЗВІРКА ЦЬОГО НЕ ЛОВИТЬ. Вона порівнює ТЕКСТ, а
 * змінився ВИГЛЯД. Мій доказ «2072 символи збіглись» був правдою й
 * одночасно недостатнім: однаковий текст не означає однакової
 * сторінки. Тому варіанти живуть тут, у коді, а не класами в базі —
 * клас у полі CMS це розмітка, яку редактор зламає мовчки.
 */
const PROSE_VARIANTS: Record<string, string> = {
  // Як було на /tools: відбитий донизу, приглушений.
  aside: "mt-10 max-w-prose text-ink-3",
};
const PROSE_DEFAULT = "max-w-prose space-y-4 text-ink-2";

function Prose({ section }: { section: SectionView }) {
  const className =
    (section.variant && PROSE_VARIANTS[section.variant]) || PROSE_DEFAULT;
  return (
    <>
      {section.heading && (
        <h2 className="text-xl font-semibold text-heading">
          {section.heading}
        </h2>
      )}
      {section.body && (
        <RichText
          text={section.body}
          values={PAGE_VALUES}
          className={className}
        />
      )}
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
export function cardsOf(items: unknown, where: string): CardItem[] {
  // 🔴 НЕ-МАСИВ — ЦЕ ПОЛОМКА, А НЕ ПОРОЖНЬО.
  //
  // Сервіс раніше зводив усе не-масивне до `[]`, і найімовірніша
  // поломка — правка `jsonb` у Directus, що перетворює масив на
  // обʼєкт `{"0":{…}}`, — давала ПОРОЖНІЙ `<ul>` і `numberOfItems: 0`
  // у розмітці. Тобто обіцянка «падає тут, а не малює дірку» була
  // хибною саме для того випадку, заради якого існувала.
  if (!Array.isArray(items)) {
    throw new Error(
      `page-sections: ${where} — \`items\` не масив, а ` +
        `${items === null ? "null" : typeof items}. Так виглядає правка ` +
        "jsonb, що перетворила масив на обʼєкт; порожній перелік і " +
        "зламаний перелік не можна плутати.",
    );
  }

  return items.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const need = (k: string, scope = `картка ${i} у ${where}`) => {
      const v = o[k];
      if (typeof v !== "string" || v.trim() === "") {
        throw new Error(
          `page-sections: ${scope} не має поля «${k}». ` +
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

    // 🔴 `terms` ПРОХОДИТЬ ТУ САМУ ПЕРЕВІРКУ. Перша редакція зводила
    // їх через `String(x.term ?? "")` — тобто `[{}, "junk"]` давало
    // порожні `<dt>`/`<dd>`, рівно ту «порожню картку», яку коментар
    // вище називає неможливою.
    const rawTerms = o.terms ?? [];
    if (!Array.isArray(rawTerms)) {
      throw new Error(
        `page-sections: картка ${i} у ${where} має \`terms\`, що не масив.`,
      );
    }
    const terms = rawTerms.map((t, j) => {
      const x = (t ?? {}) as Record<string, unknown>;
      const field = (k: string) => {
        const v = x[k];
        if (typeof v !== "string" || v.trim() === "") {
          throw new Error(
            `page-sections: рядок ${j} картки ${i} у ${where} ` +
              `не має поля «${k}».`,
          );
        }
        return v;
      };
      return { term: field("term"), text: field("text") };
    });

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

  // 🔴 ТОЙ САМИЙ МЕХАНІЗМ ПІДСТАНОВКИ, А НЕ ВЛАСНА ЗАМІНА РЯДКА.
  //
  // Перша редакція робила `.replace()` по двох ключах — і тим самим
  // відкрила дірку: будь-який ІНШИЙ ключ друкувався читачеві замість
  // кидати. Заміряно рецензією #304: `{{company.name}}` у підписі цієї
  // секції виходив дослівно, тоді як у сусідньому `prose` той самий
  // ключ коректно підставляється, а невідомий — валить збірку.
  //
  // Дві мови підстановок у сусідніх секціях — це форма, з якої тихі
  // дірки й ростуть. Тепер мова одна: `substitute` із розширеним
  // білим списком, і невідомий ключ кидає тут так само, як усюди.
  const note = section.body
    ? substitute(section.body, {
        ...PAGE_VALUES,
        count: String(countries.length),
        bulletin: longDate(FUEL.bulletinDate),
      })
    : "";

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

/**
 * 🔴 ІМʼЯ ТИПУ НАЗИВАЄТЬСЯ ОДИН РАЗ.
 *
 * `tools/page.tsx` фільтрував секції рядком `"cards"` — тобто другим,
 * зашитим записом того самого імені. Перейменування типу в CMS дало б
 * тиху колекцію з нуля елементів у розмітці JSON-LD, тоді як сторінка
 * малювала б картки. `satisfies` привʼязує константу до карти рендерів:
 * імʼя, якого там немає, не скомпілюється.
 */
const CARDS = "cards" satisfies SectionType;

/** Картки всіх секцій `cards` сторінки — для розмітки й для рендера. */
export function cardsFrom(sections: SectionView[], where: string): CardItem[] {
  return sections
    .filter((s) => s.type === CARDS)
    .flatMap((s) => cardsOf(s.items, where));
}

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
