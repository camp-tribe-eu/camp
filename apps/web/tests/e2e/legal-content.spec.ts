import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './api-request';
import { legalPath } from '@/lib/legal';
import { SEEDED, seededHtml } from '../unit/legal-cms';
import { visibleText } from '../unit/rendered-text';

// CAMP-365 — текст правових сторінок приходить із бази, і ці два тести читають
// ПОДАНУ сторінку, а не відповідь API чи константу.
//
// Окремий файл, а не доповнення `legal.spec.ts`: той тримає банер згоди, і
// лізти в нього варто лише тоді, коли міняється сам банер.

test.describe('the legal pages: text that comes from the database', () => {
  // 🔴 CAMP-365: ТЕКСТ СТОРІНКИ ПРИХОДИТЬ ІЗ БАЗИ, І ЦЕ ЧИТАЄТЬСЯ З ПОДАНОЇ
  // СТОРІНКИ, а не з відповіді API чи константи. Збірка в CI робиться з
  // фікстури, яку засіяла міграція, тож відрендерене тіло мусить ДОСЛІВНО
  // дорівнювати тому, що міграція несе, пропущеному крізь той самий
  // `LegalProse`. Це доводить, що ланцюг база → API → збірка → HTML нічого
  // не загубив, і тримає на місці корпус юніт-тестів, які читають слова
  // документів із міграції (`tests/unit/legal-cms.ts`).
  //
  // 🔴 ЧОГО ЦЕ НЕ ДОВОДИТЬ: що збігається текст, який власник змінив у CMS
  // ПІСЛЯ засівання, — на фікстурі такої правки немає за побудовою.
  test('🔴 the served body of every legal page is the text the database was seeded with', async ({
    request,
  }) => {
    // Пара: перелік не порожній, інакше цикл нижче нічого не міряє.
    expect(SEEDED.length).toBeGreaterThan(0);
    for (const { slug } of SEEDED) {
      const html = await (await request.get(legalPath(slug))).text();
      const article = /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0] ?? '';
      expect(article, `${slug}: у поданій сторінці немає <article>`).not.toBe('');

      const served = visibleText(article);
      const seeded = visibleText(seededHtml(slug));
      expect(served.length, `${slug}: подано ${served.length} символів, засіяно ${seeded.length}`)
        .toBe(seeded.length);
      expect(served, `${slug}: подане тіло відрізняється від засіяного`).toBe(seeded);
    }
  });

  // 🔴 ПОСИЛАННЯ Й ЯКОРІ ЖИВІ. Раніше сторож `check-internal-links` читав
  // `href="/…"` у вихідниках сторінок-компонентів, і правові тексти
  // потрапляли до нього. Тепер вони в базі, а не у вихідниках, тож
  // перевіряється ПОДАНЕ: кожне внутрішнє посилання в тілі веде на сторінку,
  // що відкривається, а кожен `#якір` існує на сторінці, куди веде.
  //
  // 🔴 І ЯКОРІ, НА ЯКІ ПОСИЛАЮТЬСЯ ІНШІ СТОРІНКИ (`/legal/terms#links` у
  // трьох компонентах). Вони шукаються у вихідниках за літералом, а не
  // вписані сюди: четверте таке посилання, додане завтра, потрапляє в
  // перевірку без правки цього файла.
  test('🔴 every internal link and anchor that points into a legal page resolves', async ({
    request,
  }) => {
    const refs: Array<{ from: string; href: string }> = [];

    for (const { slug } of SEEDED) {
      const html = await (await request.get(legalPath(slug))).text();
      const article = /<article\b[\s\S]*?<\/article>/i.exec(html)?.[0] ?? '';
      for (const m of article.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)) {
        if (m[1].startsWith('/')) refs.push({ from: `/legal/${slug}`, href: m[1] });
      }
    }

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : /\.(tsx?|mdx?)$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const src = join(__dirname, '../../src');
    for (const file of walk(src)) {
      for (const m of readFileSync(file, 'utf8').matchAll(
        /["'`](\/legal\/[a-z-]+#[a-z0-9-]+)["'`]/g,
      )) {
        refs.push({ from: file.slice(src.length), href: m[1] });
      }
    }

    // Пара: і тіла, і вихідники справді дали посилання з якорем, інакше
    // перевірка якорів нижче міряє порожнечу.
    expect(refs.filter((r) => r.href.includes('#')).length).toBeGreaterThan(3);
    expect(refs.some((r) => r.from.startsWith('/legal/'))).toBe(true);
    expect(refs.some((r) => !r.from.startsWith('/legal/'))).toBe(true);

    const broken: string[] = [];
    for (const { from, href } of refs) {
      const [path, fragment] = href.split('#');
      const res = await request.get(path);
      if (res.status() >= 400) {
        broken.push(`${from} → ${href}: ${res.status()}`);
        continue;
      }
      if (fragment) {
        const target = await res.text();
        if (!new RegExp(`\\sid="${fragment}"`).test(target)) {
          broken.push(`${from} → ${href}: на сторінці немає якоря «${fragment}»`);
        }
      }
    }
    expect(broken, 'зламані посилання або якорі').toEqual([]);
  });
})
