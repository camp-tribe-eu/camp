import { expect, test } from "@playwright/test";
import {
  HOME_H1,
  HOME_LEAD,
  HOME_PAGE,
  HOME_STEPS,
  MIGRATION,
  migrationSays,
} from "./home-cms";

// 🔴 ЗВІРКА ПІДМІННИКА З ВИРОБНИКОМ.
//
// Два юніт-прогони рендерять головну на `HOME_PAGE`. Якщо цей підмінник
// розійдеться з міграцією, вони лишаться зеленими, а сторінка в проді
// казатиме інше — рівно той клас, коли доказ зроблений із того самого,
// що доводить.
test.describe("🔴 CAMP-365 — підмінник головної не розходиться з базою", () => {
  const src = migrationSays();

  test("кожен рядок підмінника є в міграції дослівно", () => {
    for (const [name, value] of [
      ["заголовок", HOME_H1],
      ["вступ", HOME_LEAD],
      ["заголовок кроків", "How this works"],
      ...HOME_STEPS.flatMap((s, i) => [
        [`крок ${i + 1}: назва`, s.term],
        [`крок ${i + 1}: текст`, s.text],
      ]),
    ] as Array<[string, string]>) {
      expect(
        src.includes(value),
        `${name} у підміннику не знайдено в ${MIGRATION}: «${value.slice(0, 60)}…»`,
      ).toBe(true);
    }
  });

  // 🔴 І НАВПАКИ: сама звірка мусить уміти почервоніти. Рядок, якого в
  // міграції немає, зобовʼязаний провалитись — інакше `includes` по
  // порожньому файлу був би зеленим, і попередній випадок нічого не
  // вартий.
  test("звірка ловить вигаданий рядок", () => {
    expect(src.includes("Every campsite, and what is beside it")).toBe(false);
  });

  // 🔴 І форма підмінника мусить бути тією, що її чекає рендер: рівно
  // одна секція кожного типу, інакше `sectionOf` кине ще до тверджень.
  test("підмінник має рівно по одній секції hero і steps", () => {
    const types = HOME_PAGE.sections.map((s) => s.type);
    expect(types.filter((t) => t === "hero")).toHaveLength(1);
    expect(types.filter((t) => t === "steps")).toHaveLength(1);
  });
});
