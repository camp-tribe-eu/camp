import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from '@playwright/test';

import { legalPage } from '@/lib/legal';
import { requestReaders, walkImportGraph } from './import-graph';
import { seededHtml } from './legal-cms';
import { visibleText } from './rendered-text';

/**
 * Політика приватності 2.1 — розділ про форму «Report a problem».
 *
 * 🔴 ОДИН ФАКТ У ТРЬОХ МІСЦЯХ: строк зберігання заявок стоїть у коді
 * (`RULES` у `scripts/ops/retention-purge.mjs` — те, що база справді
 * робить), у реєстрі операцій (`docs/GDPR-REGISTER.md`, розділ 10 — те, що
 * покажуть наглядовому органу) і в політиці (те, що обіцяно читачеві).
 * Підстава — у двох останніх. Розбіжність між будь-якими двома — не
 * неточність, а опублікована неправда, тож тут одне джерело (код) звіряється
 * з двома документами, а не документи між собою.
 *
 * 🔴 ЧИТАЄТЬСЯ ВІДРЕНДЕРЕНИЙ ТЕКСТ, не розмітка й не константа: крізь той
 * самий `LegalProse`, що й сторінка, і береться ВИДИМЕ. Текст — із міграцій
 * (`legal-cms.ts`); правка в CMS цьому файлу невидима, що доведено й названо
 * там.
 */

// `__dirname`, а не `import.meta`: Playwright компілює специфікації в CommonJS.
const ROOT = resolve(__dirname, '..', '..', '..', '..');

type Branch = { name: string; months: number };
type Rule = { table: string; branches: Branch[] };

/** Правила строків — із самого сторожа, не переписані сюди. */
async function rules(): Promise<Rule> {
  const mod = (await import(
    pathToFileURL(join(ROOT, 'scripts', 'ops', 'retention-purge.mjs')).href
  )) as { RULES: Rule[] };
  const rule = mod.RULES.find((r) => r.table === 'problem_reports');
  if (!rule) throw new Error('retention-purge.mjs: немає правила для problem_reports');
  return rule;
}

/** Розділ 10 реєстру: рядки таблиці за назвою поля. */
function registerSection10(): Record<string, string> {
  const md = readFileSync(join(ROOT, 'docs', 'GDPR-REGISTER.md'), 'utf8');
  const start = md.indexOf('\n## 10. ');
  if (start < 0) throw new Error('GDPR-REGISTER.md: немає розділу 10');
  const rest = md.slice(start + 1);
  const end = rest.search(/\n(## |---)/);
  const section = end < 0 ? rest : rest.slice(0, end);
  const rows: Record<string, string> = {};
  for (const m of section.matchAll(/^\| \*\*([^*]+)\*\* \| (.*) \|$/gm)) {
    rows[m[1].trim()] = m[2];
  }
  if (!rows['підстава'] || !rows['строк']) {
    throw new Error(
      `GDPR-REGISTER.md розділ 10: немає рядків «підстава»/«строк»; є: ${Object.keys(rows).join(', ')}`,
    );
  }
  return rows;
}

/** Підрозділ {#reports} політики: від його `<h3>` до наступного заголовка. */
function reportsSectionHtml(): string {
  const html = seededHtml('privacy');
  const at = html.search(/<h3\b[^>]*\sid="reports"/);
  expect(at, 'у політиці немає заголовка з якорем «reports»').toBeGreaterThanOrEqual(0);
  const rest = html.slice(at);
  const next = rest.slice(1).search(/<h[23]\b/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

test.describe('політика приватності описує форму «Report a problem»', () => {
  test('🔴 розділ є, і він каже, що зберігається і що ні', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toMatch(/^Reporting a problem with a campsite page/);
    expect(text).toContain('Report a problem');
    // Що збираємо — усе пʼять, і що контакт необовʼязковий.
    expect(text).toContain('which campsite it is about');
    expect(text).toContain('the kind of problem you chose from the list');
    expect(text).toContain('2 000 characters');
    expect(text).toContain('200 characters');
    expect(text).toContain('the moment the report arrived');
    expect(text).toContain('only if you typed one');
    expect(text).toContain('The contact is optional');
    // Що НЕ збираємо, і що зайве поле відхиляється, а не обрізається.
    expect(text).toMatch(/does not send, and the table has no column for, your IP address/);
    expect(text).toContain('user-agent string');
    expect(text).toContain('your location or any account');
    expect(text).toContain('is refused outright, not trimmed');
  });

  test('🔴 IP у лічильнику частоти та в журналі вебсервера названо, а не замовчано', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toContain('counts how many reports arrive from each IP address');
    expect(text).toContain('at most five in ten minutes');
    expect(text).toContain('in memory only');
    expect(text).toContain('never in the database');
    expect(text).toContain('one line in the security log');
    expect(text).toContain('not what you wrote');
  });

  test('🔴 попередження не вписувати персональних даних — своїх чи чужих', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toContain(
      'Please do not put personal details into the description — yours or anyone else’s.',
    );
    expect(text).toContain('we do not filter it');
  });

  test('🔴 підстава — ст. 6(1)(f), і сказано, чому не згода', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toContain('Legal basis:');
    expect(text).toContain('legitimate interest');
    expect(text).toContain('Article 6(1)(f) GDPR');
    expect(text).toContain('We do not ask for your consent');
  });

  test('🔴 права: доступ, виправлення, видалення, заперечення за ст. 21 — і адреса, куди писати', () => {
    const text = visibleText(reportsSectionHtml());
    expect(text).toContain('object to this processing under Article 21 GDPR');
    expect(text).toContain('see, correct or delete a report you sent');
    // Адреса — літералом, не константою: перевіряється те, що читач побачить.
    expect(text).toContain('privacy@camptribe.eu');
    // І в розділі «Your rights» теж, бо саме туди читач іде по права.
    const html = seededHtml('privacy');
    const rights = html.slice(html.search(/<h2\b[^>]*\sid="rights"/));
    const rightsText = visibleText(rights.slice(0, rights.slice(1).search(/<h2\b/) + 1));
    expect(rightsText).toContain('privacy@camptribe.eu');
    expect(html).toContain('href="mailto:privacy@camptribe.eu"');
  });

  test('розділ «How long we keep it» теж називає заявки, і посилання між ними живі', () => {
    const html = seededHtml('privacy');
    const keep = html.slice(html.search(/<h2\b[^>]*\sid="keep"/));
    const keepText = visibleText(keep.slice(0, keep.slice(1).search(/<h2\b/) + 1));
    expect(keepText).toContain('Problem reports');
    expect(html).toContain('href="/legal/privacy#reports"');
    expect(html).toContain('href="/legal/privacy#keep"');
    expect(html).toMatch(/<h2\b[^>]*\sid="keep"/);
  });
});

test.describe('🔴 строк і підстава однакові в коді, реєстрі й політиці', () => {
  test('строки з RULES стоять дослівно у політиці — обидві гілки', async () => {
    const rule = await rules();
    // Пара: правило справді має дві гілки, інакше цикл нижче міряє порожнечу.
    expect(rule.branches.map((b) => b.name).sort()).toEqual(['closed', 'open']);
    const text = visibleText(seededHtml('privacy'));
    const keep = visibleText(reportsSectionHtml());
    for (const b of rule.branches) {
      expect(keep, `гілка «${b.name}»`).toContain(`${b.months} months`);
      // Число з коду зустрічається у політиці щонайменше двічі: розділ про
      // форму і «How long we keep it».
      expect(text.split(`${b.months} months`).length - 1, `«${b.months} months» у політиці`)
        .toBeGreaterThanOrEqual(2);
    }
    // І що жодного ТРЕТЬОГО числа місяців у розділі немає: «12 and 36» не пройде.
    const stated = [...keep.matchAll(/(\d+) months/g)].map((m) => Number(m[1]));
    expect(new Set(stated)).toEqual(new Set(rule.branches.map((b) => b.months)));
  });

  test('строки з RULES стоять у реєстрі (розділ 10), і він більше не каже «не вирішено»', async () => {
    const rule = await rules();
    const rows = registerSection10();
    for (const b of rule.branches) {
      expect(rows['строк'], `гілка «${b.name}»`).toMatch(
        new RegExp(`\\*\\*${b.months} місяц(і|ів)\\*\\*`),
      );
    }
    expect(rows['строк']).not.toMatch(/не вирішено/);
    expect(rows['строк']).toContain('retention-purge.mjs');
  });

  test('підстава в реєстрі й у політиці — одна: 6(1)(f)', () => {
    const rows = registerSection10();
    expect(rows['підстава']).toContain('6(1)(f)');
    expect(rows['підстава']).not.toMatch(/не вирішено/);
    expect(visibleText(reportsSectionHtml())).toContain('Article 6(1)(f)');
  });

  test('реєстр відсилає до того самого якоря політики, що існує', () => {
    const rows = registerSection10();
    const row = Object.values(rows).find((v) => v.includes('/legal/privacy#'));
    expect(row, 'у розділі 10 немає посилання на політику').toBeDefined();
    const anchor = /\/legal\/privacy#([a-z-]+)/.exec(row!)![1];
    expect(seededHtml('privacy')).toMatch(new RegExp(`<h[23]\\b[^>]*\\sid="${anchor}"`));
  });
});

test.describe('реєстр правових сторінок і сама сторінка', () => {
  test('версія політики піднята разом із текстом: 2.1 від 30.10.2026', () => {
    const p = legalPage('privacy')!;
    expect(p.version).toBe('2.1');
    expect(p.effectiveFrom).toBe('2026-10-30');
  });

  // 🔴 Політика лишається статичною: ні сторінка, ні будь-що, що вона
  // імпортує, не читає запиту. Та сама прогулянка графом імпортів, що й у
  // `report-problem.spec.tsx` для сторінки кемпінгу.
  test('🔴 сторінка /legal/[slug] і все, що вона імпортує, не читають запиту', () => {
    const SRC = resolve(__dirname, '..', '..', 'src');
    const page = join(SRC, 'app', 'legal', '[slug]', 'page.tsx');
    const seen = walkImportGraph(SRC, [page]);
    const names = [...seen].map((f) => f.slice(SRC.length + 1));
    expect(names).toContain('lib/legal-content.ts');
    expect(names).toContain('components/legal-prose.tsx');
    expect(seen.size).toBeGreaterThan(5);
    const offenders = requestReaders(SRC, seen);
    if (/\bsearchParams\b/.test(readFileSync(page, 'utf8'))) {
      offenders.push('page.tsx: searchParams in a page');
    }
    expect(offenders).toEqual([]);
    expect(readFileSync(page, 'utf8')).toContain('export const dynamicParams = false');
  });
});
