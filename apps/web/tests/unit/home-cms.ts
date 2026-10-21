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

/** Сирий текст міграції — для звірки, а не для розбору. */
export function migrationSays(): string {
  return readFileSync(MIGRATION, "utf8");
}

export const HOME_H1 = "Every campsite, and what is around it";

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
    text: "Route planning and weather along the way are being built. Nothing here pretends they are ready.",
  },
];

const section = (s: Partial<SectionView> & { type: string }): SectionView => ({
  variant: null,
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
  metaDescription:
    "Campsites, motorhome parks and camper stops across the EU-27, with what is around each one.",
  noindex: false,
  sections: [
    section({ type: "hero", heading: HOME_H1, body: HOME_LEAD }),
    section({ type: "steps", heading: "How this works", items: HOME_STEPS }),
  ],
};
