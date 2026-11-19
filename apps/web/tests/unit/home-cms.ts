import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PageView, SectionView } from "@/lib/page-content";

/**
 * Головна, якою її віддає API після CAMP-365.
 *
 * 🔴 ЦЕЙ ФАЙЛ — КОПІЯ, І САМЕ ТОМУ ПОРУЧ СТОЇТЬ ЗВІРКА З ВИРОБНИКОМ.
 *
 * Текст головної живе в базі, тобто в міграції. Юніт-тест, який
 * рендерить сторінку на підміннику, доводить РЕНДЕР — а твердження на
 * кшталт «вступ каже *a railway stop*, а не *railway station*» стосується
 * ЗМІСТУ. Якби підмінник просто носив ту фразу, тест перевіряв би сам
 * себе: корпус і твердження ділили б одне поле.
 *
 * Тому `migrationSays()` нижче читає САМЕ ту міграцію, що засіває базу,
 * і `home-cms.spec.ts` вимагає збіжності слово в слово. Розійдуться —
 * впаде звірка з назвою рядка, а не мовчки позеленіє тест про зміст.
 */

export const MIGRATION = join(
  __dirname,
  "../../../api/src/migrations/1792700000000-SeedHomePage.ts",
);

export const HOME_STEP_MIGRATION = join(
  __dirname,
  "../../../api/src/migrations/1797450000000-KitchenTwoTexts.ts",
);

/**
 * 🔴 ЩО САМЕ ЗАСІВАЄ МІГРАЦІЯ — ВИТЯГНУТЕ З НЕЇ, А НЕ «ЧИ Є ТАКИЙ РЯДОК».
 *
 * Перша редакція робила `src.includes(value)` по тексту файла. Рецензія
 * показала, що це перевірка в ОДИН бік і ловить майже ніщо:
 *
 *   • міграція засіває інший `body` героя, а `this.lead` лишається
 *     мертвим полем → зелено;
 *   • міграція дістає ЧЕТВЕРТИЙ крок → зелено (підмінник ⊆ файл);
 *   • `meta_description` переписано → зелено, і в e2e про опис головної
 *     не було жодного твердження.
 *
 * Тепер значення дістаються з полів класу і звіряються `toEqual`:
 * розійтись у будь-який бік, включно з кількістю кроків, більше нема як.
 */
export function migrationSeeds(): {
  h1: string;
  metaDescription: string;
  lead: string;
  steps: Array<{ term: string; text: string }>;
} {
  const src = readFileSync(MIGRATION, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const field = (name: string) => {
    const m = new RegExp(
      `private readonly ${name} =\\s*\n?\\s*'((?:[^'\\\\]|\\\\.)*)';`,
    ).exec(src);
    if (!m) {
      throw new Error(
        `home-cms: у ${MIGRATION} не знайдено поля «${name}». ` +
          "Розбір більше не описує міграцію, тож звірка нічого не вартує.",
      );
    }
    return m[1];
  };

  const block = /private readonly steps = \[([\s\S]*?)\n  \];/.exec(src);
  if (!block) {
    throw new Error(`home-cms: у ${MIGRATION} не знайдено переліку кроків.`);
  }
  const seeded = [
    ...block[1].matchAll(
      /term:\s*'([^']*)',\s*\n?\s*text:\s*\n?\s*'([^']*)',/g,
    ),
  ].map((m) => ({ term: m[1], text: m[2] }));

  // 🔴 CAMP-463 коло 2: ПІСЛЯ засіву на крок накладається міграція
  // `KitchenTwoTexts` (UPDATE). Підмінник описує базу ПІСЛЯ неї, тож і
  // звірка читає її константи — і кидає, якщо старого тексту в засіві
  // нема (інакше заміна нічого б не міняла й нічого б не доводила).
  const later = readFileSync(HOME_STEP_MIGRATION, "utf8");
  const pick = (name: string) => {
    const m = new RegExp(`${name} =\\s*'((?:[^'\\\\]|\\\\.)*)';`).exec(later);
    if (!m) throw new Error(`home-cms: у ${HOME_STEP_MIGRATION} немає ${name}.`);
    return m[1];
  };
  const [from, to] = [pick("OLD_HOME_STEP"), pick("NEW_HOME_STEP")];
  if (!seeded.some((x) => x.text === from)) {
    throw new Error(`home-cms: засів не містить тексту, який міняє ${HOME_STEP_MIGRATION}.`);
  }
  const steps = seeded.map((x) => (x.text === from ? { ...x, text: to } : x));
  if (steps.length === 0) {
    throw new Error(`home-cms: перелік кроків у ${MIGRATION} розібрався в нуль.`);
  }

  return {
    h1: field("h1"),
    metaDescription: field("metaDescription"),
    lead: field("lead"),
    steps,
  };
}

export const HOME_H1 = "Every campsite, and what is around it";

export const HOME_META =
  "Campsites, motorhome parks and camper stops across the EU-27, with what is around each one.";

export const HOME_LEAD =
  "{{lead}}, each with the distance to water, to the nearest town and to a railway stop, its elevation and its terrain — calculated by us, published by nobody else.";

export const HOME_STEPS = [
  {
    term: "Find places",
    text: "Campsites from OpenStreetMap, refreshed weekly, with the gaps shown as gaps rather than filled in with guesses.",
  },
  {
    term: "See the surroundings",
    text: "How far the lake is, how high the site sits, whether a train stops within walking distance — computed for every campsite.",
  },
  {
    term: "Plan the drive",
    text: "Routes across the EU, stop by stop, with the campsites and services nearest each stop.",
  },
];

const section = (s: Partial<SectionView> & { type: string }): SectionView => ({
  variant: null,
  slot: null,
  heading: null,
  subheading: null,
  body: null,
  imageUrl: null,
  imageAlt: null,
  ctaHref: null,
  ctaLabel: null,
  items: [],
  ...s,
});

export const HOME_PAGE: PageView = {
  slug: "home",
  title: HOME_H1,
  metaTitle: null,
  metaDescription: HOME_META,
  bannerTicker: null,
  noindex: false,
  sections: [
    section({ type: "hero", heading: HOME_H1, body: HOME_LEAD }),
    section({ type: "steps", heading: "How this works", items: HOME_STEPS }),
  ],
};
