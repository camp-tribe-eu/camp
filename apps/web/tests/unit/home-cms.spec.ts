import { expect, test } from "@playwright/test";
import {
  HOME_H1,
  HOME_LEAD,
  HOME_META,
  HOME_PAGE,
  HOME_STEPS,
  MIGRATION,
  migrationSeeds,
} from "./home-cms";

// 🔴 ЗВІРКА ПІДМІННИКА З ВИРОБНИКОМ.
//
// Два юніт-прогони рендерять головну на `HOME_PAGE`. Якщо цей підмінник
// розійдеться з міграцією, вони лишаться зеленими, а сторінка в проді
// казатиме інше — рівно той клас, коли доказ зроблений із того самого,
// що доводить.
//
// 🔴 І ЗВІРКА ДВОБІЧНА, бо однобічна ловила майже ніщо. Рецензія #306
// провела три мутації через `src.includes(value)` і всі три лишились
// зеленими: інший `body` героя при живому мертвому полі, ЧЕТВЕРТИЙ
// крок, переписаний `meta_description`. Тепер значення дістаються з
// полів класу й порівнюються цілком.
test.describe("🔴 CAMP-365 — підмінник головної не розходиться з базою", () => {
  test("засів міграції й підмінник — те саме, у обидва боки", () => {
    expect(migrationSeeds(), `розійшлось із ${MIGRATION}`).toEqual({
      h1: HOME_H1,
      metaDescription: HOME_META,
      lead: HOME_LEAD,
      steps: HOME_STEPS,
    });
  });

  // 🔴 І сама звірка мусить уміти почервоніти на кожному полі окремо,
  // інакше `toEqual` над обʼєктом, зібраним із того самого джерела, був
  // би істинним за побудовою.
  test("звірка ловить підміну кожного поля", () => {
    const real = migrationSeeds();
    expect(real.h1).not.toBe("Every campsite, and what is beside it");
    expect(real.lead).not.toBe(HOME_LEAD.replace("railway stop", "station"));
    expect(real.steps).toHaveLength(HOME_STEPS.length);
    expect(real.steps.map((s) => s.term)).toEqual(HOME_STEPS.map((s) => s.term));
  });

  test("розбір міграції не мовчить, коли не розібрав", () => {
    // Поля, якого немає, бути не може: витягувач кидає, а не віддає
    // порожнє. Без цього «0 кроків» виглядало б як збіг.
    expect(migrationSeeds().steps.length).toBeGreaterThan(0);
    expect(migrationSeeds().h1.length).toBeGreaterThan(0);
    expect(migrationSeeds().metaDescription.length).toBeGreaterThan(0);
  });

  // 🔴 І форма підмінника мусить бути тією, що її чекає рендер: рівно
  // одна секція кожного типу, інакше `sectionOf` кине ще до тверджень.
  test("підмінник має рівно по одній секції hero і steps", () => {
    const types = HOME_PAGE.sections.map((s) => s.type);
    expect(types.filter((t) => t === "hero")).toHaveLength(1);
    expect(types.filter((t) => t === "steps")).toHaveLength(1);
  });
});
