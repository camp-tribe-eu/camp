import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { displayName, feature } from './compute-context';

// CAMP-295 — 927 сторінок показували назву міста не латиницею.
//
// 🔴 ЧОМУ ТЕСТ ЧИТАЄ ВИХІДНИЙ ФАЙЛ.
//
// Транслітератор існував і був покритий самотестами — і все одно
// 927 сторінок показували `Крылово` і `Сапарева баня`. Бо його ніхто не
// КЛИКАВ там, де назва стає текстом для читача. Перевірка самої функції
// цього не ловить: вона була зелена весь час, поки дефект жив.

const SOURCE = readFileSync(join(__dirname, 'compute-context.ts'), 'utf8');

describe('назви в context придатні для читання', () => {
  it('виклик стоїть у єдиному місці, де назва стає текстом', () => {
    const feature = SOURCE.slice(
      SOURCE.indexOf('const feature = ('),
      SOURCE.indexOf('async function main'),
    );
    expect(feature).toContain('displayName(name)');
    expect(SOURCE).toContain('displayName(r.water_name)');
  });

  it('🔴 сира назва не проходить крізь feature() — перевірка ПОВЕДІНКИ', () => {
    // Рецензія показала, що попередній сторож був прив'язаний до
    // НАПИСАННЯ: регулярка по вихідному файлу ловила лише
    // `name: r.*name`. Форма `{ name }` — саме та, якою сирий `name`
    // стояв у `feature()` ДО цього PR — проходила 7 of 7 із кирилицею
    // в контексті. Тобто сторож не ловив власного історичного багу.
    //
    // Тому тепер питаємо не «як написано», а «що віддає функція».
    expect(feature(100, 'Крылово')).toEqual({ m: 100 });
    expect(feature(100, 'Сапарева баня')).toEqual({
      m: 100,
      name: 'Sapareva banya',
    });
    expect(feature(100, 'Watten – Éperlecques')).toEqual({
      m: 100,
      name: 'Watten – Éperlecques',
    });
    expect(feature(null, 'Шумен')).toBeUndefined();
  });

  it('болгарську передає за Законом 2009 і лишає регістр', () => {
    // 🔴 Заміряно: слагова `transliterate` віддає `sapareva banya` —
    // усе малими, бо писалась для адрес. Для тексту це зіпсована назва.
    expect(displayName('Сапарева баня')).toBe('Sapareva banya');
    expect(displayName('Шумен')).toBe('Shumen');
  });

  it('грецьку передає за ELOT 743', () => {
    expect(displayName('Αστερίας')).toBe('Asterias');
  });

  it('🔴 те, що лишилось кирилицею, НЕ показує взагалі', () => {
    // `Крылово` — Калінінградська область. `ы` немає в болгарській
    // таблиці, тож слагова функція віддає `krыlovo`. Краще не показати
    // назву, ніж показати таке.
    expect(displayName('Крылово')).toBeNull();
  });

  it('назви, що вже латиницею, лишає незмінними', () => {
    // 60 631 сторінка з 61 558 не має змінитись узагалі.
    for (const name of ['Burgenland', 'Rydzówka', 'Saint-Étienne', 'Ukta']) {
      expect(displayName(name)).toBe(name);
    }
  });

  it('порожнє лишається порожнім', () => {
    expect(displayName(null)).toBeNull();
    expect(displayName('')).toBeNull();
  });
});
