import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";

// 🔴 CAMP-427, пункт 5 «Способу перевірки»: «вигляд звірено з темою Fuse
// / Figma, а не намальовано з голови».
//
// ЧОМУ ЦЕ ТЕСТ, А НЕ ОКО. Рішення власника 18.10.2026 дослівно: «код в
// тебе свій може бути, стилі можуть трішки розходитися, але головне
// треба наслідувати те що я дав». Тобто свобода в реалізації, не у
// вигляді. Проєкт уже має шар токенів, знятий із теми: кольори
// (`--color-ink`, `--color-line`, `--color-btn`), радіуси, криві руху й
// ширину контейнера 1180 px.
//
// 🔴 І ОСЬ ЗАМІР, ЩО РОБИТЬ ЦЕЙ ФАЙЛ МОЖЛИВИМ, 03.11.2026:
//
//   <main> із `mx-auto max-w-wrap px-4`          25 сторінок
//   <main> з іншою шириною                        2 сторінки (мої)
//   файлів із сирою палітрою Tailwind             1 зі 118 (мій)
//
// Тобто порушення було не «скрізь потроху», а рівно у двох поверхнях
// каталогу компаній. Площа цього сторожа дорівнює площі дефекту — саме
// тому його можна поставити на ВЕСЬ застосунок, не ламаючи нічого, що
// вже є. Якби порушень було 40, цей тест був би запобіжником, дорожчим
// за дефект, і я б його не писав.

const APP = join(__dirname, "../../src/app");
const COMPONENTS = join(__dirname, "../../src/components");

function tsxFiles(): string[] {
  return [
    ...globSync("**/*.tsx", { cwd: APP }).map((f) => join(APP, f)),
    ...globSync("**/*.tsx", { cwd: COMPONENTS }).map((f) =>
      join(COMPONENTS, f),
    ),
  ];
}

/** Сира палітра Tailwind — тобто колір, якого немає в темі. */
const RAW_PALETTE =
  /\b(?:border|text|bg|ring|divide|outline|fill|stroke|shadow|from|via|to)-(?:neutral|gray|slate|zinc|stone)-\d{2,3}\b/;

test.describe("мова теми, а не стокова палітра", () => {
  test("🔴 жоден файл не фарбує сирою палітрою Tailwind", () => {
    const files = tsxFiles();
    // Знаменник названий: перелік справді прочитано.
    expect(files.length).toBeGreaterThan(100);
    const guilty = files.filter((f) =>
      RAW_PALETTE.test(readFileSync(f, "utf8")),
    );
    expect(guilty.map((f) => f.replace(/.*\/src\//, "src/"))).toEqual([]);
  });

  test("🔴 перевірка не сліпа — підроблений рядок вона ловить", () => {
    // Негативний контроль: без нього «нуль винних» так само вірно для
    // регулярки, яка не збігається ні з чим.
    for (const sample of [
      'className="border-neutral-300"',
      'className="bg-gray-100 text-slate-700"',
      'className="divide-zinc-200"',
    ]) {
      expect(RAW_PALETTE.test(sample), sample).toBe(true);
    }
    // І не ловить те, що ловити не треба.
    for (const ok of [
      'className="border-line bg-surface text-ink"',
      'className="text-ink-2"',
      'className="grid-cols-3 gap-4"',
    ]) {
      expect(RAW_PALETTE.test(ok), ok).toBe(false);
    }
  });

  test("🔴 кожна сторінка має ту саму ширину контейнера, що й решта", () => {
    const mains: { file: string; cls: string }[] = [];
    for (const f of tsxFiles()) {
      for (const m of readFileSync(f, "utf8").matchAll(
        /<main className="([^"]*)"/g,
      )) {
        mains.push({ file: f.replace(/.*\/src\//, "src/"), cls: m[1] });
      }
    }
    // Знаменник: сторінок справді багато, і тест їх справді знайшов.
    expect(mains.length).toBeGreaterThan(20);
    const wrong = mains.filter((m) => !m.cls.includes("max-w-wrap"));
    expect(wrong).toEqual([]);
  });
});
