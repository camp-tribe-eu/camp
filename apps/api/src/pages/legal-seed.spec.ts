import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { seededLegalPages } from './legal-seeded';

/**
 * CAMP-365 — правовий текст у базі мусить бути ТИМ САМИМ текстом, яким його
 * засіяла міграція.
 *
 * 🔴 ЦЕ ПЕРЕВІРКА ВІРНОСТІ ЗАСІВАННЯ, І МЕЖА ЇЇ ПЕРЕЛІЧЕНА. Раніше джерелом
 * були файли `apps/web/src/content/legal/markup/*.md`, а їхню рівність
 * компонентам JSX доводив `legal-markup.spec.tsx` (#309): ланцюг
 * JSX → розмітка → база. Файли й компоненти видалено, коли сторінка
 * перемкнулась на базу, — з `apps/web/src` текст правових документів
 * прибрано, бо картка цього вимагала. Ланку «JSX → розмітка» закрито на
 * збірці (текст до і після, усі сім сторінок), а цей файл тримає останню:
 * що в базу потрапило те, що стоїть у міграції, символ у символ — без
 * втрат на екрануванні шаблонного рядка, на `\`, `${}`, зворотних лапках.
 *
 * Корпус тут — самі міграції: посів і кожна пізніша міграція правового
 * тексту, накладені одна на одну в `legal-seeded.ts` (з 30.10.2026 посів
 * один уже не описує базу: `PrivacyProblemReports` підняла privacy до 2.1).
 * Корпус ділить джерело з тим, ЩО ВСТАВИЛО РЯДКИ, тож цей файл НЕ доводить,
 * що текст у міграції правильний: це доводили #309 і #315, поки був другий
 * бік. Він доводить, що база його не спотворила — і що жодну міграцію
 * тексту не забули накласти: забута впала б тут посимвольно.
 *
 * 🔴 І ПЕРЕЛІК БЕРЕТЬСЯ З МІГРАЦІЇ, А НЕ ВПИСАНИЙ ЧИСЛОМ. Документ, доданий
 * до міграції й відсутній у реєстрі (або навпаки), мусить впасти тут.
 */
const SEEDED = seededLegalPages();

/**
 * Реєстр правових сторінок у вебі — файл, який розбирається нижче.
 */
const LEGAL_TS = join(
  __dirname,
  '..',
  '..',
  '..',
  'web',
  'src',
  'lib',
  'legal.ts',
);

/**
 * Реєстр правових сторінок, яким ЖИВЕ МАРШРУТ.
 *
 * 🔴 ЧОМУ ЦЕ ТУТ. Рецензія #315 заміряла: сторож перевіряв лише `body`,
 * а `title` і `version` ТЯГНУВ із бази й нікуди не дивився — мертвий
 * доказ. Чотири мутації міграції (назва, версія, дата чинності, опис)
 * лишали ВСІ 10 випадків зеленими. Тобто база могла мовчки розійтись
 * із тим, що читач бачить у переліку документів.
 *
 * Розбір поле за полем, а не одним шаблоном на обʼєкт: записи в цьому
 * файлі не однакової форми, і один крихкий шаблон уже знаходив 5 із 7.
 */
function registry(): Record<
  string,
  { title: string; summary: string; version: string; effectiveFrom: string }
> {
  const src = readFileSync(LEGAL_TS, 'utf8');
  const block = src.slice(src.indexOf('export const LEGAL_PAGES'));
  const body = block.slice(block.indexOf('['), block.indexOf('\n];') + 2);
  const field = (chunk: string, name: string): string | null => {
    const m = new RegExp(
      `${name}\\s*:\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`,
    ).exec(chunk);
    return m ? m[1].replace(/\\'/g, "'") : null;
  };
  const out: Record<
    string,
    {
      title: string;
      summary: string;
      version: string;
      effectiveFrom: string;
    }
  > = {};
  for (const chunk of body.split(/\n  \{\n/).slice(1)) {
    const slug = field(chunk, 'slug');
    const title = field(chunk, 'title');
    const summary = field(chunk, 'summary');
    const version = field(chunk, 'version');
    const effectiveFrom = field(chunk, 'effectiveFrom');
    if (!slug) continue;
    if (!title || !summary || !version || !effectiveFrom) {
      throw new Error(`реєстр: у «${slug}» бракує поля`);
    }
    out[slug] = { title, summary, version, effectiveFrom };
  }
  return out;
}

const REGISTRY = registry();

const SLUGS = SEEDED.map((d) => d.slug).sort();

describe('SeedLegalPages: база несе той самий текст, що й джерело', () => {
  let ds: DataSource;
  let rows: Array<{
    slug: string;
    body: string;
    title: string;
    version: string;
    plain_summary: string;
    effective_from: string;
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
      `SELECT lp.slug, lp.version, lp.effective_from::text AS effective_from,
              t.title, t.plain_summary, t.body
         FROM legal_pages lp
         JOIN legal_page_translations t ON t.legal_page_id = lp.id
        WHERE t.language_code = 'en'
        ORDER BY lp.slug`,
    )) as typeof rows;
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('у базі рівно ті документи, що засіває міграція', () => {
    // Пара: міграція справді щось несе, інакше порівняння двох порожніх
    // переліків було б зеленим.
    expect(SLUGS.length).toBeGreaterThan(0);
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
    '%s: текст у базі збігається з міграцією посимвольно',
    (slug) => {
      const source = SEEDED.find((d) => d.slug === slug)?.body ?? '';
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

  // 🔴 D3 З РЕЦЕНЗІЇ #315: назва, версія, дата й опис теж мусять
  // збігатись. Чотири мутації міграції лишали всі випадки зеленими,
  // бо ці поля ніхто не читав.
  it.each(SLUGS)(
    '%s: назва, версія, дата й опис збігаються з реєстром',
    (slug) => {
      const want = REGISTRY[slug];
      if (!want) throw new Error(`${slug}: у реєстрі LEGAL_PAGES його немає`);
      const row = rows.find((r) => r.slug === slug);
      if (!row) throw new Error(`${slug}: рядка немає в базі`);
      expect({
        title: row.title,
        summary: row.plain_summary,
        version: row.version,
        effectiveFrom: row.effective_from,
      }).toEqual(want);
    },
  );

  it('реєстр і міграція називають ті самі документи', () => {
    expect(Object.keys(REGISTRY).sort()).toEqual(SLUGS);
  });
});
