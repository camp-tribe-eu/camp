import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';

/**
 * CAMP-365 — правовий текст у базі мусить бути ТИМ САМИМ текстом.
 *
 * 🔴 ЦЕ ЄДИНА ПЕРЕВІРКА, ЩО СТОЇТЬ МІЖ МІГРАЦІЄЮ І ЮРИДИЧНИМ
 * ДОКУМЕНТОМ. Картка називає це пасткою номер один: «будь-яка втрата
 * слова — це неправда в юридичному документі. Звіряти посимвольно, а
 * не оком».
 *
 * Порівнюється база з файлами `apps/web/src/content/legal/markup/*.md`,
 * чия дослівна рівність компонентам JSX доведена окремо (#309,
 * `legal-markup.spec.tsx`: видимий текст посимвольно + скелет елементів
 * із якорями). Тобто ланцюг повний: JSX → розмітка → база.
 *
 * 🔴 І ПЕРЕЛІК БЕРЕТЬСЯ З ТЕКИ, А НЕ ВПИСАНИЙ ЧИСЛОМ. Сьомий документ,
 * доданий у теку й забутий у міграції, мусить впасти тут. Константа
 * «7» зробила б цей тест сліпим рівно до того, заради чого він є.
 */
const MARKUP = join(
  __dirname,
  '..',
  '..',
  '..',
  'web',
  'src',
  'content',
  'legal',
  'markup',
);

/**
 * 🔴 ПЕРЕЛІК ЧИТАЄТЬСЯ З ТЕКИ, А НЕ ВПИСАНИЙ ЧИСЛОМ. Восьмий документ,
 * доданий у теку й забутий у міграції, мусить впасти тут. Константа «7»
 * зробила б цей тест сліпим рівно до того, заради чого він є.
 */
const SLUGS = readdirSync(MARKUP)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.slice(0, -3))
  .sort();

describe('SeedLegalPages: база несе той самий текст, що й джерело', () => {
  let ds: DataSource;
  let rows: Array<{
    slug: string;
    body: string;
    title: string;
    version: string;
  }>;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      // Та сама конвенція, що в `pages.service.spec.ts`. Відсутня база —
      // це падіння, а не пропуск.
      url:
        process.env.CAMP_TEST_DATABASE_URL ??
        process.env.CI_DATABASE_URL ??
        'postgres://localhost:5432/camptribe_dev',
    });
    await ds.initialize();
    rows = (await ds.query(
      `SELECT lp.slug, lp.version, t.title, t.body
         FROM legal_pages lp
         JOIN legal_page_translations t ON t.legal_page_id = lp.id
        WHERE t.language_code = 'en'
        ORDER BY lp.slug`,
    )) as typeof rows;
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('у базі рівно ті документи, що лежать у теці розмітки', () => {
    expect(rows.map((r) => r.slug)).toEqual(SLUGS);
  });

  it('кожен документ опублікований і має версію', async () => {
    const bad = (await ds.query(
      `SELECT slug FROM legal_pages WHERE status <> 'published' OR version = ''`,
    )) as Array<{ slug: string }>;
    expect(bad.map((b) => b.slug)).toEqual([]);
  });

  // 🔴 ПОСИМВОЛЬНО, І КОЖЕН ОКРЕМО. Один тест на всі сім сказав би
  // «щось розійшлось», а не «розійшовся privacy».
  it.each(SLUGS)(
    '%s: текст у базі збігається з джерелом посимвольно',
    (slug) => {
      const source = readFileSync(join(MARKUP, `${slug}.md`), 'utf8');
      const row = rows.find((r) => r.slug === slug);
      if (!row) throw new Error(`${slug}: рядка немає в базі`);
      // 🔴 Довжини першими: розбіжність у 10 000 символів без них
      // нечитабельна, і звіт покаже стіну тексту замість місця.
      if (row.body.length !== source.length) {
        throw new Error(
          `${slug}: джерело ${source.length} символів, база ${row.body.length}`,
        );
      }
      expect(row.body).toBe(source);
    },
  );

  // 🔴 Підстановки мусять лишитись підстановками: заморожена адреса
  // компанії розірвала б рішення CAMP-188.
  it('підстановки не розкриті в базі', () => {
    const frozen = rows.filter((r) =>
      /Kapucinessenstraat|2000 Antwerpen/.test(r.body),
    );
    expect(frozen.map((r) => r.slug)).toEqual([]);
    const withSubstitutions = rows.filter((r) => r.body.includes('{{company.'));
    expect(withSubstitutions.length).toBeGreaterThan(0);
  });
});
