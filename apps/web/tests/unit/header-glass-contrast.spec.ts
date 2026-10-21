import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

// 🔴 CAMP-374 — скло шапки проти найгіршого тла, а не проти тих
// сторінок, якими я ходив.
//
// Рецензія заміряла на живій сторінці: /map у темній темі, світлі
// растрові плитки крізь 18% прозорості, пункт меню дає 3.39:1 — нижче
// за AA. Сторінок, де це видно, я не обійшов би ніколи: під шапкою
// буває будь-що, і завтра це буде інша сторінка.
//
// Тому перевірка не ходить по сторінках, а рахує МЕЖУ: тло, темніше
// або світліше за яке, не буває. Якщо вона тримається, тримається і
// будь-яка справжня сторінка.
//
// 🔴 І САМЕ ТОМУ ВОНА ЧИТАЄ ТОКЕНИ З ФАЙЛУ, А НЕ НОСИТЬ ЇХ У СОБІ.
// Копія чисел тут була б доказом про копію: зміни `--ink-2` у темі —
// і тест лишився б зеленим про колір, якого на сайті немає.

const CSS = join(__dirname, "../../src/app/globals.css");

type Rgb = [number, number, number];

function hex(h: string): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) throw new Error(`не колір у шістнадцятковому вигляді: «${h}»`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Поверхня з непрозорістю `tint`, покладена на тло `behind`. */
const over = (surface: Rgb, tint: number, behind: Rgb): Rgb =>
  surface.map((s, i) => tint * s + (1 - tint) * behind[i]) as Rgb;

/**
 * Усі теми, що оголошують скло: кожна така область зобовʼязана поруч
 * оголосити й поверхню, і колір приглушеного тексту.
 */
function themes() {
  const css = readFileSync(CSS, "utf8");
  const out: Array<{ at: number; surface: Rgb; ink2: Rgb; tint: number }> = [];

  for (const m of css.matchAll(/--glass-tint:\s*(\d+(?:\.\d+)?)%/g)) {
    const at = m.index;
    const before = css.slice(0, at);
    const after = css.slice(at);
    const surface = /--surface:\s*(#[0-9a-f]{6})\s*;[^}]*$/i.exec(before);
    const ink2 = /--ink-2:\s*(#[0-9a-f]{6})\s*;/i.exec(after.slice(0, 2000));
    if (!surface || !ink2) {
      throw new Error(
        `--glass-tint на позиції ${at} не має поруч ` +
          `${surface ? "--ink-2" : "--surface"} — розбір більше не описує файл.`,
      );
    }
    out.push({
      at,
      surface: hex(surface[1]),
      ink2: hex(ink2[1]),
      tint: Number(m[1]) / 100,
    });
  }
  return out;
}

test.describe("🔴 CAMP-374 — шапка читається над будь-чим", () => {
  const found = themes();

  // 🔴 Якщо тем стане менше, ніж станів теми, частина сайту лишиться
  // без перевірки, а підсумок виглядатиме так само зелено.
  test("скло оголошене в усіх трьох станах теми", () => {
    expect(found, "станів теми зі склом не три").toHaveLength(3);
  });

  for (const t of found) {
    // Найгірше тло для світлої поверхні — чорне, для темної — біле:
    // воно тягне поверхню до кольору тексту.
    const dark = luminance(t.surface) < 0.5;
    const behind: Rgb = dark ? [255, 255, 255] : [0, 0, 0];
    const name = dark ? "темна над білим" : "світла над чорним";

    test(`${name} (токен на позиції ${t.at}) тримає AA`, () => {
      const ratio = contrast(over(t.surface, t.tint, behind), t.ink2);
      expect(
        ratio,
        `${name}: ${ratio.toFixed(2)}:1 при непрозорості ` +
          `${(t.tint * 100).toFixed(0)}% — AA вимагає 4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }

  // 🔴 І сама арифметика мусить уміти сказати «ні»: без цього випадок
  // вище був би зелений і тоді, коли `contrast()` завжди віддає багато.
  test("арифметика ловить недостатній контраст", () => {
    const surface: Rgb = [0x21, 0x28, 0x36];
    const ink2: Rgb = [0x9a, 0xa3, 0xb2];
    expect(contrast(over(surface, 0.82, [255, 255, 255]), ink2)).toBeLessThan(
      4.5,
    );
    expect(contrast(over(surface, 1, [255, 255, 255]), ink2)).toBeGreaterThan(
      4.5,
    );
  });
});
