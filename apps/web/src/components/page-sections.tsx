import FeatureRow from '@/components/feature-row';
import Faq from '@/components/faq';
import { HeroSlider } from "./home-slider";
import { ImageWithText } from "./image-with-text";
import { SearchWidget } from "./search-widget";
import { searchOf, slidesOf } from "@/lib/slides";
import { ButtonLink, buttonClasses } from "./button";
import { RichText } from "./rich-text";
import { PAGE_VALUES, type SectionView } from "@/lib/page-content";
import { isInternalHref, substitute } from "@/lib/rich-text";
import Link from "next/link";
import { FUEL, FUEL_COUNTRIES, longDate } from "@/lib/fuel";
import { Block, type Measure } from "@/components/layout";
import { CountryChip } from "./country-chip";
import type { ReactNode } from "react";

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
 * абзац /tools мав `mt-10 text-ink-2` на читальній колонці, а після
 * переїзду дістав типові `space-y-4 text-ink-2` — тобто втратив
 * верхній відступ і приглушений колір, опинившись упритул до переліку
 * 27 країн.
 *
 * 🔴 І ПОСИМВОЛЬНА ЗВІРКА ЦЬОГО НЕ ЛОВИТЬ. Вона порівнює ТЕКСТ, а
 * змінився ВИГЛЯД. Мій доказ «2072 символи збіглись» був правдою й
 * одночасно недостатнім: однаковий текст не означає однакової
 * сторінки. Тому варіанти живуть тут, у коді, а не класами в базі —
 * клас у полі CMS це розмітка, яку редактор зламає мовчки.
 */
/**
 * 🔴 ПІДСТАНОВКИ ПРИХОДЯТЬ ЗГОРИ, А НЕ БЕРУТЬСЯ З МОДУЛЯ.
 *
 * `PAGE_VALUES` — це сталі сайту (назва компанії, місто, пошта). На
 * головній зʼявилось значення, якого модуль знати не може: перше
 * речення вступу рахується з відповіді API вже під час рендера. Тому
 * рендери більше не тягнуть білий список самі — його зливає `PageSections`
 * в одному місці, а сторінка додає своє.
 *
 * Властивість, заради якої це робиться, лишається тією самою: невідомий
 * ключ КИДАЄ (`substitute`). Сторінка, яка забула передати `lead`, не
 * надрукує «{{lead}}» читачеві — вона завалить збірку.
 */
type Values = Readonly<Record<string, string>>;
type RenderProps = {
  section: SectionView;
  values: Values;
  /** Секція стоїть у вузькій коробці макета: без значків, три колонки на xl. */
  compact?: boolean;
};

/**
 * 🔴 ШИРИНА НАЗВАНА В КОЖНОМУ ВАРІАНТІ, І ТИП ЦЬОГО ВИМАГАЄ (CAMP-447).
 *
 * Було: `PROSE_DEFAULT` — рядок класів, у якому читальна колонка
 * їхала безкоштовно з кожною новою секцією. Замір: 105 вживань 01.10.2026 →
 * 149 на 08.11.2026, і приріст давало саме це замовчування. Тепер варіант —
 * це `{ measure, className }`, і `measure` не має значення за замовчуванням:
 * забутий — не компілюється, а не розповзається.
 */
type ProseStyle = {
  measure: Measure;
  className: string;
  /** Клас заголовка секції; типово — малий `text-xl`. */
  headingClassName?: string;
};

const PROSE_VARIANTS: Record<string, ProseStyle> = {
  // Як було на /tools: відбитий донизу, приглушений.
  aside: { measure: "read", className: "mt-10 text-ink-2" },
  // Примітка про походження тексту (допис блогу). Рядок у CMS, не код:
  // власник міняє текст, коли перепише допис сам. Варіант лише дає їй
  // вигляд і мітку `data-provenance`, за якою її шукає
  // `scripts/ci/check-post-provenance.mjs` у ВІДДАНІЙ сторінці.
  provenance: {
    measure: "read",
    className: "mt-10 border-t border-line-2 pt-4 text-sm text-ink-2",
  },
  // CAMP-464: вступ сторінки з великим заголовком — ліва колонка контактів
  // у теми («Feel Free to Contact Us» великими літерами над абзацом).
  lead: {
    measure: "read",
    className: "mt-4 space-y-4 text-ink-2",
    headingClassName: "text-3xl leading-tight md:text-[42px]",
  },
};
/** Звичайний абзацний текст секції — читальна колонка, бо це суцільний текст. */
const PROSE_PLAIN: ProseStyle = {
  measure: "read",
  className: "space-y-4 text-ink-2",
};

function Prose({ section, values }: RenderProps) {
  const style =
    (section.variant && PROSE_VARIANTS[section.variant]) || PROSE_PLAIN;
  const content = (
    <>
      {section.heading && (
        <h2 className={style.headingClassName ?? "text-xl text-heading"}>
          {section.heading}
        </h2>
      )}
      {section.body && (
        <RichText
          text={section.body}
          values={values}
          measure={style.measure}
          className={style.className}
        />
      )}
    </>
  );
  return section.variant === "provenance" ? (
    <div data-provenance>{content}</div>
  ) : (
    content
  );
}

function Cta({ section, values }: RenderProps) {
  const href = section.ctaHref;
  const label = section.ctaLabel;

  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      {href && label && <CtaButton href={href} label={label} />}
      {section.body && (
        <RichText
          text={section.body}
          values={values}
          measure="read"
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
export function cardsOf(
  items: unknown,
  where: string,
  values: Values = PAGE_VALUES,
): CardItem[] {
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
    const href = substitute(need("href"), values);
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
      return {
        term: substitute(field("term"), values),
        text: substitute(field("text"), values),
      };
    });

    return {
      title: substitute(need("title"), values),
      href,
      body: substitute(need("body"), values),
      terms,
    };
  });
}

/**
 * 🔴 ЗНАЧОК ВИБИРАЄ КОД ЗА АДРЕСОЮ, А НЕ РЕДАКТОР У CMS.
 *
 * Власник просив значки на картках /tools (CAMP-458). Поле «іконка» в
 * базі означало б або назву файлу, або розмітку — тобто або 404 на
 * проді, коли файл перейменують, або SVG, який редактор уставив з
 * чужого сайту. Тут адреса картки й так веде на НАШУ сторінку
 * (`cardsOf` це перевіряє), тож значок іде за адресою.
 *
 * 🔴 НЕВІДОМА АДРЕСА — БЕЗ ЗНАЧКА, А НЕ З ТИПОВИМ. Картка про
 * інструмент, якого ще немає в цій карті, краще стоятиме без значка,
 * ніж із чужим: типовий значок бреше тихо.
 */
const CARD_ICONS: Record<string, ReactNode> = {
  "/tools/camper-trip-cost": (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
      <path d="M7.5 6.5h9M7.5 11h2.5M12 11h2.5M16.5 11H17M7.5 14.5H10M12 14.5h2.5M16.5 14.5H17M7.5 18H10M12 18h2.5M16.5 18H17" strokeLinecap="round" />
    </svg>
  ),
  "/tools/camper-packing-list": (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 4.5H6.5A1.5 1.5 0 0 0 5 6v13.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H16" />
      <rect x="8" y="2.5" width="8" height="4" rx="1.2" />
      <path d="M8.5 11.5l1.6 1.6 3.2-3.2M8.5 16.5l1.6 1.6 3.2-3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function Cards({ section, values, compact }: RenderProps) {
  const items = cardsOf(section.items, "секції cards", values);
  return (
    <ul
      className={
        compact
          ? "mt-6 grid gap-4 xl:grid-cols-3"
          : "mt-8 grid gap-6 md:grid-cols-2"
      }
    >
      {items.map((t) => (
        <li
          key={t.href}
          className={`flex gap-4 rounded-card border border-line-2 bg-surface ${compact ? "p-4" : "p-5"}`}
        >
          {!compact && CARD_ICONS[t.href] && (
            <span className="shrink-0 text-heading" aria-hidden="true">
              {CARD_ICONS[t.href]}
            </span>
          )}
          <div className="min-w-0">
          <h2 className={compact ? "text-lg" : "text-xl"}>
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
          </div>
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
function FuelCountries({ section, values }: RenderProps) {
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
        ...values,
        count: String(countries.length),
        bulletin: longDate(FUEL.bulletinDate),
      })
    : "";

  return (
    <section aria-labelledby="by-country-heading" className="mt-12">
      <h2 id="by-country-heading" className="text-xl md:text-[25px]">
        {section.heading}
      </h2>
      {note && <Block as="p" measure="read" className="mt-2 text-sm text-ink-2">{note}</Block>}
      {/* 🔴 ПРАПОР — ПОРУЧ ІЗ НАЗВОЮ, А НЕ ЗАМІСТЬ НЕЇ (CAMP-458).
          Правила переїхали в `CountryChip`, бо та сама кнопка потрібна
          й на /search (CAMP-455): два однакові рядки CSS під різними
          іменами розходяться на першій же правці розміру. */}
      <ul className="mt-4 flex flex-wrap gap-x-2 gap-y-3">
        {countries.map((c) => (
          <li key={c.code}>
            <CountryChip
              code={c.code}
              href={`/tools/camper-trip-cost/${c.code.toLowerCase()}`}
            >
              {c.name}
            </CountryChip>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── CAMP-464: секції каталогу для /about і /contact ────────────────────
//
// Власник просив для «Про нас» і «Контактів» те, що є в демо-стору теми:
// фото поруч із текстом, картки зі значками, FAQ, картку праворуч від
// тексту. Компоненти цих секцій у нас уже ЗРОБЛЕНІ (CAMP-449) і жили
// лише в коді сторінок — тобто змінити їх міг тільки розробник. Тут вони
// стають типами секцій, а текст їх — рядками в базі, які править власник.

/**
 * 🔴 ЗНАЧОК ВИБИРАЄ КОД ЗА ІМЕНЕМ, А НЕ РЕДАКТОР ЗА РОЗМІТКОЮ — і
 * НЕВІДОМЕ ІМ'Я КИДАЄ. Це інакше, ніж у `CARD_ICONS`, де невідома адреса
 * дає картку без значка: там значок бере код за адресою, яку редактор
 * правильно вписав. Тут редактор САМ називає значок, і друкарська помилка
 * («emial») мусить бути видима одразу, а не стати карткою без значка в
 * переліку, де решта значки мають.
 */
const ICON_PROPS = {
  width: "28",
  height: "28",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.5",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const FEATURE_ICONS: Record<string, ReactNode> = {
  mail: (
    <svg {...ICON_PROPS}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3.5 7.5 12 13l8.5-5.5" />
    </svg>
  ),
  shield: (
    <svg {...ICON_PROPS}>
      <path d="M12 3 5 6v5.5c0 4.2 2.8 7.6 7 9.5 4.2-1.9 7-5.3 7-9.5V6l-7-3Z" />
      <path d="m9 12 2.2 2.2L15.2 10" />
    </svg>
  ),
  database: (
    <svg {...ICON_PROPS}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  ),
  clock: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  alert: (
    <svg {...ICON_PROPS}>
      <path d="M12 4 3 19.5h18L12 4Z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </svg>
  ),
  info: (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.1" />
    </svg>
  ),
};

export const FEATURE_ICON_NAMES = Object.keys(FEATURE_ICONS);

/** Один елемент секції `features`, як його тримає `items` у базі. */
export interface FeatureEntry {
  title: string;
  text: string;
  icon: string | null;
  href: string | null;
}

/**
 * Картки секції `features` із сирого `jsonb`. Та сама суворість, що в
 * `cardsOf`/`termsOf`: порожня картка на сторінці виглядає як дефект
 * рендера, тож падаємо тут, а не малюємо дірку.
 *
 * 🔴 `href` — наша сторінка АБО `mailto:`. Не `https://`: картка
 * «Email» веде на лист, картка «Legal notice» — на нашу сторінку, а
 * чужий сайт у картці-факті — це реклама, якої ніхто не замовляв.
 */
export function featuresOf(
  items: unknown,
  where: string,
  values: Values = PAGE_VALUES,
): FeatureEntry[] {
  if (!Array.isArray(items)) {
    throw new Error(
      `page-sections: ${where} — \`items\` не масив, а ` +
        `${items === null ? "null" : typeof items}.`,
    );
  }
  return items.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const need = (k: string) => {
      const v = o[k];
      if (typeof v !== "string" || v.trim() === "") {
        throw new Error(
          `page-sections: картка ${i} у ${where} не має поля «${k}».`,
        );
      }
      return substitute(v, values);
    };
    const optional = (k: string): string | null => {
      const v = o[k];
      if (v === undefined || v === null) return null;
      if (typeof v !== "string" || v.trim() === "") {
        throw new Error(
          `page-sections: картка ${i} у ${where} має порожнє або не рядкове «${k}». ` +
            "Не потрібне поле прибирають, а не лишають порожнім.",
        );
      }
      return substitute(v, values);
    };
    const icon = optional("icon");
    if (icon !== null && !(icon in FEATURE_ICONS)) {
      throw new Error(
        `page-sections: картка ${i} у ${where} просить значок «${icon}», ` +
          `якого немає. Відомі: ${FEATURE_ICON_NAMES.join(", ")}.`,
      );
    }
    const href = optional("href");
    if (href !== null && !(isInternalHref(href) || href.startsWith("mailto:"))) {
      throw new Error(
        `page-sections: картка ${i} у ${where} веде на «${href}» — ` +
          "картка веде лише на нашу сторінку або на лист.",
      );
    }
    return { title: need("title"), text: need("text"), icon, href };
  });
}

function Features({ section, values, compact }: RenderProps) {
  const items = featuresOf(section.items, "секції features", values);
  const stacked = section.variant === "stack";
  return (
    <section className={stacked ? "mt-6" : "mt-12"}>
      {section.heading && (
        <h2 className="text-xl md:text-[25px]">{section.heading}</h2>
      )}
      <div className={section.heading ? "mt-5" : undefined}>
        <FeatureRow
          testId="features"
          titleAs="h3"
          iconSide={stacked ? "left" : "top"}
          stacked={stacked || compact}
          items={items.map((f, i) => ({
            key: `${i}-${f.title}`,
            icon: f.icon ? FEATURE_ICONS[f.icon] : undefined,
            title: f.title,
            text: f.text,
            href: f.href ?? undefined,
          }))}
        />
      </div>
    </section>
  );
}

function FaqSection({ section, values }: RenderProps) {
  const items = termsOf(section.items, "секції faq", values);
  return (
    <section className="mt-12">
      {section.heading && (
        <h2 className="text-xl md:text-[25px]">{section.heading}</h2>
      )}
      <div className={section.heading ? "mt-5" : undefined}>
        <Faq
          testId="faq"
          items={items.map((q, i) => ({
            key: `${i}-${q.term}`,
            question: q.term,
            answer: q.text,
          }))}
        />
      </div>
    </section>
  );
}

/**
 * Секція «текст + фото».
 *
 * 🔴 ФОТО БЕРЕТЬСЯ ЛИШЕ З НАШОГО ДОМЕНУ. CSP тримає `img-src 'self'`, а
 * чужа адреса в `image_url` (`applyValues` пропускає `https://`) не
 * завантажилась би — читач бачив би порожню сіру коробку, а редактор
 * вирішив би, що зламано сторінку. Тож не-внутрішня адреса КИДАЄ.
 *
 * 🔴 БЕЗ ФОТО — НЕ ЦЯ СЕКЦІЯ. Секція без картинки — це абзац у рамці;
 * для абзацу є `prose`. Редактор, який стер адресу, отримує падіння, а
 * не тихо переставлений макет.
 *
 * `subheading` — надзаголовок над заголовком (`caption` теми). Раніше це
 * поле не читав жоден рендер, тепер читає цей.
 */
function ImageWithTextSection({ section, values }: RenderProps) {
  const src = section.imageUrl;
  if (!src || !isInternalHref(src)) {
    throw new Error(
      `page-sections: секція image-with-text «${section.heading ?? "—"}» ` +
        `має фото «${src ?? ""}», яке не наш шлях від кореня.`,
    );
  }
  if (!section.heading) {
    throw new Error(
      "page-sections: секція image-with-text без заголовка. Без нього " +
        "компонент не малюється, а секція мовчки зникла б зі сторінки.",
    );
  }
  return (
    <div className="mt-12 [&_.ct-iwt__heading]:text-3xl [&_.ct-iwt__heading]:leading-tight md:[&_.ct-iwt__heading]:text-[40px]">
      <ImageWithText
        testId="image-with-text"
        image={{ src, alt: section.imageAlt ?? "" }}
        caption={section.subheading ?? undefined}
        heading={section.heading}
        imagePosition={section.variant === "image-right" ? "right" : "left"}
        imageWidth={50}
        textAs="div"
        text={
          section.body ? (
            <RichText
              text={section.body}
              values={values}
              measure="wide"
              className="space-y-4 text-ink-2"
            />
          ) : undefined
        }
        cta={
          section.ctaHref && section.ctaLabel && isInternalHref(section.ctaHref)
            ? { href: section.ctaHref, label: section.ctaLabel }
            : undefined
        }
      />
    </div>
  );
}

/**
 * 🔴 CAMP-488 — ТРИ ТИПИ ДЛЯ ГОЛОВНОЇ, І ВСІ ТРИ УНІВЕРСАЛЬНІ.
 *
 * `slide`, `search`, `image-text` не привʼязані до головної: будь-який
 * лендинг може мати слайдер, пошукове поле й рядок «текст + фото». Саме
 * тому це типи каталогу, а не три рядки в `page.tsx`, і саме тому їх
 * правка — в адмінці (CAMP-365: усе, що бачить читач, живе в CMS).
 *
 * Окремий `slide` сам по собі малює слайдер із одного слайда; кілька
 * слайдів в одному слайдері збирає сторінка (головна бере ВСІ секції
 * `slide` і віддає їх одному `HeroSlider`), бо `PageSections` обходить
 * секції по одній і не знає, що сусідні належать до однієї групи.
 */
function Slide({ section, values }: RenderProps) {
  return (
    <HeroSlider
      slides={slidesOf([section], values)}
      label={section.heading ?? "Highlights"}
    />
  );
}

function Search({ section, values }: RenderProps) {
  return <SearchWidget search={searchOf(section, values)} />;
}

/**
 * Рядок «текст + фото». `subheading` — надзаголовок над заголовком,
 * `variant: "reverse"` — фото праворуч на десктопі (чергування).
 *
 * 🔴 КАРТИНКА Й ЗАГОЛОВОК ОБОВʼЯЗКОВІ І КИДАЮТЬ, А НЕ ХОВАЮТЬСЯ. Сам
 * `ImageWithText` без заголовка чи фото повертає `null` (правило каталогу
 * «порожнє не малюємо»), і для компонента це правильно. Для СЕКЦІЇ з CMS —
 * ні: власник заповнив рядок в адмінці й не побачив його на сайті, а
 * нічого про це не сказало. Тому той самий випадок тут падає.
 */
function ImageText({ section, values }: RenderProps) {
  if (!section.heading || section.heading.trim() === "") {
    throw new Error("page-sections: секція image-text без заголовка.");
  }
  if (!section.imageUrl || section.imageUrl.trim() === "") {
    throw new Error(
      `page-sections: секція image-text «${section.heading}» без картинки.`,
    );
  }
  const href = section.ctaHref;
  const label = section.ctaLabel;
  if ((href === null || href === "") !== (label === null || label === "")) {
    throw new Error(
      `page-sections: секція image-text «${section.heading}» — кнопка наполовину.`,
    );
  }
  return (
    <div className="mx-auto max-w-wrap px-4 py-3 xl:px-6">
      <ImageWithText
        image={{ src: section.imageUrl, alt: section.imageAlt ?? "" }}
        caption={section.subheading ?? undefined}
        heading={section.heading}
        text={section.body ? substitute(section.body, values) : undefined}
        cta={href && label ? { href, label } : undefined}
        imagePosition={section.variant === "reverse" ? "right" : "left"}
        testId="image-text"
      />
    </div>
  );
}

/**
 * Картка з текстом і однією дією — права колонка контактів у теми (біла
 * картка із заголовком, текстом і кнопкою).
 *
 * 🔴 КНОПКА ТА САМА, ЩО В `cta`: `CtaButton` розрізняє `mailto:` і шлях.
 */
function CardSection({ section, values }: RenderProps) {
  return (
    <section
      data-testid="card-section"
      className="rounded-card border border-line-2 bg-surface p-6 md:p-8"
    >
      {section.heading && (
        <h2 className="text-xl md:text-[25px]">{section.heading}</h2>
      )}
      {section.body && (
        <RichText
          text={section.body}
          values={values}
          measure="wide"
          className="mt-4 space-y-4 text-ink-2"
        />
      )}
      {section.ctaHref && section.ctaLabel && (
        <div className="mt-6">
          <CtaButton href={section.ctaHref} label={section.ctaLabel} />
        </div>
      )}
    </section>
  );
}

const RENDERERS = {
  prose: Prose,
  cta: Cta,
  cards: Cards,
  "fuel-countries": FuelCountries,
  hero: Hero,
  steps: Steps,
  features: Features,
  faq: FaqSection,
  "image-with-text": ImageWithTextSection,
  card: CardSection,
  slide: Slide,
  search: Search,
  "image-text": ImageText,
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
/**
 * 🔴 ГОЛОВНА — ЦЕ МАКЕТ, А НЕ ДОКУМЕНТ, І ТИПИ НИЖЧЕ ЦЕ ВИЗНАЮТЬ.
 *
 * На /about і /contact текст був суцільним, тож вистачало `prose`. На
 * головній редакційні рядки вплетені в ОБЧИСЛЕНЕ: перелік країн,
 * картки місць, числа кемпінгів. Межа та сама, що й на /tools — текст,
 * який ОПИСУЄ, їде в CMS; те, що РАХУЄ або ПЕРЕЛІЧУЄ згенероване,
 * лишається з генератором.
 *
 * Тому `hero`, `steps` — універсальні (будь-який лендинг їх матиме), а
 * `country-grid` і `notable-spots` тримають у базі лише заголовок, а
 * самі переліки малює сторінка.
 */
function Hero({ section, values }: RenderProps) {
  return (
    <>
      {section.heading && (
        <h1 className="max-w-[18ch] text-3xl leading-tight md:text-[42px]">
          {section.heading}
        </h1>
      )}
      {section.body && (
        <Block as="p" measure="read" className="mt-4 text-ink-2">
          {substitute(section.body, values)}
        </Block>
      )}
    </>
  );
}

function Steps({ section, values }: RenderProps) {
  const items = termsOf(section.items, "секції steps", values);
  return (
    <section className="mx-auto max-w-wrap px-4 py-12 xl:px-6">
      {section.heading && (
        <h2 className="text-xl md:text-[25px]">{section.heading}</h2>
      )}
      {/* 🔴 CAMP-449, пункт 5: секція каталогу замість голого `<ol>`.
          Було три стовпчики тексту без рамки й без значка — рівно те,
          що власник назвав «скучний, сухий». Дані НЕ змінились: ті самі
          `items`, той самий порядок, та сама нумерація. */}
      <div className="mt-5">
        <FeatureRow
          testId="steps"
          ordered
          titleAs="h3"
          items={items.map((s, i) => ({
            key: s.term,
            // Номер чують і оком, і читачем екрана — див. 🔴 у
            // `feature-row.tsx` про `srLabel`.
            srLabel: `Step ${i + 1}`,
            // Номер кроку в кружечку — той самий прийом, що в теми, де
            // в заголовку картки стоїть велике число.
            icon: <span className="ct-feat__step">{i + 1}</span>,
            title: s.term,
            text: s.text,
          }))}
        />
      </div>
    </section>
  );
}

/**
 * Пари «назва — текст» із `items`, із тією самою суворістю, що й картки:
 * порожній рядок у списку виглядає як дефект рендера, тож падаємо тут.
 */
export function termsOf(
  items: unknown,
  where: string,
  // 🔴 Типове значення — САМЕ `PAGE_VALUES`, і воно безпечне: єдиний
  // ключ понад них на сьогодні це `{{lead}}` головної, і його
  // відсутність КИДАЄ в `substitute`. Тобто виклик, який забув передати
  // свої значення, падає гучно, а не друкує сміття.
  values: Values = PAGE_VALUES,
): Array<{ term: string; text: string }> {
  if (!Array.isArray(items)) {
    throw new Error(
      `page-sections: ${where} — \`items\` не масив, а ` +
        `${items === null ? "null" : typeof items}.`,
    );
  }
  return items.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    const field = (k: string) => {
      const v = o[k];
      if (typeof v !== "string" || v.trim() === "") {
        throw new Error(
          `page-sections: рядок ${i} у ${where} не має поля «${k}».`,
        );
      }
      return v;
    };
    // 🔴 `items` ТЕЖ ПРОХОДЯТЬ ПІДСТАНОВКУ — ЦЕ ВИПРАВЛЕННЯ НЕПРАВДИ.
    //
    // `applyValues` покриває `title`, `metaTitle`, `metaDescription`,
    // `heading` і `ctaHref`; `body` розгортає `RichText`. А `items` не
    // чіпав ніхто. Заміряно рецензією #306: крок із текстом
    // «Write to {{contact.email}}» друкувався ЧИТАЧЕВІ дослівно, і
    // невідомий ключ теж друкувався замість кидати. Тобто червоне
    // твердження вище в цьому ж файлі («мова одна… невідомий ключ кидає
    // тут так само, як усюди») було хибним саме для `items`.
    //
    // Сторож «жодної {{ на сторінці» цього не бачив за побудовою: він
    // читає ЗАСІЯНУ базу, а в засіві підстановок у кроках немає.
    return {
      term: substitute(field("term"), values),
      text: substitute(field("text"), values),
    };
  });
}

const CARDS = "cards" satisfies SectionType;

/** Картки всіх секцій `cards` сторінки — для розмітки й для рендера. */
export function cardsFrom(
  sections: SectionView[],
  where: string,
  values: Values = PAGE_VALUES,
): CardItem[] {
  return sections
    .filter((s) => s.type === CARDS)
    .flatMap((s) => cardsOf(s.items, where, values));
}

/**
 * Одна секція названого типу — і гучно, якщо її немає або їх більше.
 *
 * 🔴 Потрібне там, де СТОРІНКА керує макетом, а не перелік секцій:
 * на головній блок двох лійок стоїть ВСЕРЕДИНІ вступного блоку, між
 * заголовком і наступною секцією. Без цієї перевірки порожній результат
 * фільтра просто нічого б не намалював — головна лишилась би без `h1`,
 * і жоден тип не заперечив би.
 */
export function sectionOf(
  sections: SectionView[],
  type: SectionType,
  where: string,
): SectionView {
  const found = sections.filter((s) => s.type === type);
  if (found.length !== 1) {
    throw new Error(
      `page-sections: ${where} — очікувалась рівно одна секція «${type}», ` +
        `а їх ${found.length}.`,
    );
  }
  return found[0];
}

/**
 * 🔴 СЕКЦІЯ, ЯКУ МАКЕТ НЕ РОЗКЛАВ, НЕ СМІЄ ЗНИКНУТИ МОВЧКИ.
 *
 * `PageSections` чесний: невідомий ТИП він кидає. Але сторінка, яка
 * розкладає секції сама (головна бере `hero` і `steps` і ставить між
 * ними власний макет), передає рендеру не весь перелік — і зайва
 * секція туди просто не доходить.
 *
 * Асиметрія, яку заміряла рецензія #306: СХОВАТИ секцію — вся сторінка
 * падає (`sectionOf` кидає), ДОДАТИ — тиша. Власник додасть секцію в
 * адмінці, не побачить її на сайті й вирішить, що зламалась CMS.
 */
export function assertAllSectionsUsed(
  sections: SectionView[],
  used: readonly SectionType[],
  where: string,
): void {
  const extra = sections
    .map((s) => s.type)
    .filter((t) => !(used as readonly string[]).includes(t));
  if (extra.length > 0) {
    throw new Error(
      `page-sections: ${where} — секції «${extra.join("», «")}» нікуди ` +
        "не малюються. Макет цієї сторінки розкладає секції сам, тож " +
        "нова секція потребує місця в розмітці; мовчки вона не зникне.",
    );
  }
}

export function PageSections({
  sections,
  values,
  compact,
}: {
  sections: SectionView[];
  values?: Values;
  compact?: boolean;
}) {
  const all: Values = values ? { ...PAGE_VALUES, ...values } : PAGE_VALUES;
  return (
    <>
      {sections.map((s, i) => {
        const Render = RENDERERS[s.type as SectionType];
        if (Render) return <Render key={i} section={s} values={all} compact={compact} />;
        throw new Error(
          `page-sections: невідомий тип секції «${s.type}». Відомі: ` +
            `${SECTION_TYPES.join(", ")}. Тип у базі зʼявився без рендера — ` +
            "або додайте рендер, або приберіть секцію; мовчки вона не зникне.",
        );
      })}
    </>
  );
}
