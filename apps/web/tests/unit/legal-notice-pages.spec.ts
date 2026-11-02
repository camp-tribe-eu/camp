import { expect, test } from '@playwright/test';

import { LEGAL_PAGES, legalPath } from '@/lib/legal';
import { seededHtml } from './legal-cms';
import { visibleText } from './rendered-text';

/**
 * «Legal notice» 1.1 — розділ «The other pages» перелічує ВСІ інші правові
 * сторінки.
 *
 * 🔴 ЧОМУ ЦЕ ЗВІРЯЄТЬСЯ З РЕЄСТРОМ, А НЕ З ЧИСЛОМ. Перша редакція називала
 * чотири сторінки при шести, і ніхто не помітив, бо перелік був рядком тексту,
 * а реєстр — масивом в іншому файлі. Тепер перелік читається з ВІДРЕНДЕРЕНОЇ
 * сторінки (посилання `<a href>` усередині розділу `#pages` і їхній видимий
 * текст), реєстр — із `lib/legal.ts`, і порівняння йде в обидва боки: нова
 * сторінка в реєстрі без посилання тут і посилання тут на сторінку, якої в
 * реєстрі немає, червоніють однаково. Слаги й назви — з реєстру, не з пам'яті.
 */

/** Посилання в розділі `#pages` примітки: слаг і видимий текст, у порядку на сторінці. */
function listed(): Array<{ slug: string; text: string }> {
  const html = seededHtml('notice');
  const at = html.search(/<h2\b[^>]*\sid="pages"/);
  expect(at, 'у примітці немає розділу з якорем #pages').toBeGreaterThanOrEqual(0);
  const rest = html.slice(at);
  const next = rest.slice(1).search(/<h2\b/);
  const section = next < 0 ? rest : rest.slice(0, next + 1);
  return [...section.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    slug: m[1].replace(/^\/legal\//, ''),
    text: visibleText(m[2]),
  }));
}

test.describe('примітка: «The other pages» = реєстр без самої примітки', () => {
  test('🔴 кожна правова сторінка з реєстру названа, і нічого зайвого', () => {
    const links = listed();
    // Якір: розбір побачив посилання, інакше «рівно ті самі» — це дві порожні множини.
    expect(links.length, 'розділ #pages без посилань — розбір сліпий').toBeGreaterThan(0);
    const inRegistry = LEGAL_PAGES.filter((p) => p.slug !== 'notice').map((p) => p.slug);
    expect(inRegistry.length, 'реєстр порожній').toBeGreaterThan(0);

    const onPage = links.map((l) => l.slug);
    expect({
      missing: inRegistry.filter((s) => !onPage.includes(s)),
      extra: onPage.filter((s) => !inRegistry.includes(s)),
      duplicated: onPage.filter((s, i) => onPage.indexOf(s) !== i),
    }).toEqual({ missing: [], extra: [], duplicated: [] });
  });

  test('🔴 шляхи, назви й порядок — як у реєстрі', () => {
    const links = listed();
    const expected = LEGAL_PAGES.filter((p) => p.slug !== 'notice').map((p) => ({
      href: legalPath(p.slug),
      text: p.title,
    }));
    const html = seededHtml('notice');
    const hrefs = [...html.slice(html.search(/<h2\b[^>]*\sid="pages"/)).matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs).toEqual(expected.map((e) => e.href));
    expect(links.map((l) => l.text)).toEqual(expected.map((e) => e.text));
  });
});
