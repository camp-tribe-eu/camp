import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { API_SRC, ROOT, pageText, paragraphs, readCode } from './legal-claims';
import { seededHtml } from './legal-cms';
import { visibleText } from './rendered-text';

/**
 * «How this database is made» 1.1 — описання змін за ODbL §4.6, звірене з
 * кодом, який ці зміни робить.
 *
 * 🔴 ЦЕ ЛІЦЕНЗІЙНИЙ ДОКУМЕНТ. Сторінка, що описує інакше, ніж код робить із
 * даними OpenStreetMap, не виконує обов'язку, заради якого існує. Тому нижче
 * не «текст містить слово», а «те, що стверджує сторінка, дорівнює тому, що
 * робить код»: імпорт читається з файлів імпорту, злиття дублікатів —
 * ВИКОНУЄТЬСЯ (`dedupe`, `mergeUnnamed` — ті самі функції, що й на
 * імпорті), а не пересказується.
 */

/** Рядок staging так, як його читає імпорт (лише поля, які читають `dedupe` і `mergeUnnamed`). */
type Staging = {
  osm_ref: string;
  point_wkt: string;
  outline_wkt: string | null;
  admin_region: string | null;
  admin_country: string | null;
  tags: Record<string, string>;
};

/**
 * 🔴 `require`, а не `import`: `import-spots.ts` тягне `pg`, а в `apps/web` для
 * нього немає типів, і `tsc --noEmit` веба червоніє на 8 помилках у ЧУЖОМУ
 * файлі, ледве тест його імпортує за типами. Виконується той самий файл —
 * лише компілятор веба його не розбирає.
 */
// Абзац вище пояснює, ЧОМУ тут `require`: це свідомий CommonJS-міст.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dedupe, mergeUnnamed } = require('../../../api/src/osm/import-spots') as {
  dedupe: (rows: Staging[]) => Staging[];
  mergeUnnamed: (rows: Staging[]) => Staging[];
};

/** Рядки без `# …` — у шелл-скрипті коментар теж не код. */
const shellCode = (file: string): string =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');

test.describe('database §computed: «supermarket»', () => {
  /** Значення `shop=…`, які ІМПОРТ залишає з OSM. */
  const importShops = (): string[] => [
    ...new Set(
      [...shellCode(join(ROOT, 'scripts', 'osm-pipeline', 'load-context.sh')).matchAll(/\b[nwr]\/shop=([a-z_]+)/g)].map(
        (m) => m[1],
      ),
    ),
  ];

  /** Значення, які ЗАПИТ шукає як «найближчий магазин». */
  const queryShops = (): string[] => {
    const code = readCode(join(API_SRC, 'osm', 'context-sql.ts'));
    const out = new Set<string>();
    for (const m of code.matchAll(/\bx\.shop\s*=\s*'([a-z_]+)'/g)) out.add(m[1]);
    for (const m of code.matchAll(/\bx\.shop\s+IN\s*\(([^)]*)\)/gi))
      for (const v of m[1].matchAll(/'([a-z_]+)'/g)) out.add(v[1]);
    return [...out];
  };

  /** Рядок списку про `supermarket`, як його бачить читач. */
  const bullet = (): { noun: string; tag: string } => {
    const li = [...seededHtml('database').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)]
      .map((m) => visibleText(m[1]))
      .find((t) => t.startsWith('supermarket'));
    expect(li, 'у списку «What we compute» немає рядка про supermarket').toBeTruthy();
    const m = /^supermarket — the nearest (.+?) \(OpenStreetMap tag shop=([a-z_]+)\), with its distance and name\.$/.exec(li!);
    expect(m, `рядок про supermarket не того вигляду: «${li}»`).toBeTruthy();
    return { noun: m![1], tag: m![2] };
  };

  test('🔴 сторінка називає рівно ті значення shop=, які імпорт залишає і які запит шукає', () => {
    const fromImport = importShops();
    const fromQuery = queryShops();
    // Якорі: розбір бачить обидва місця.
    expect(fromImport.length, 'load-context.sh: жодного shop= — розбір сліпий').toBeGreaterThan(0);
    expect(fromQuery.length, 'context-sql.ts: жодного x.shop — розбір сліпий').toBeGreaterThan(0);

    const { noun, tag } = bullet();
    expect({ import: fromImport.sort(), query: fromQuery.sort() }).toEqual({ import: [tag], query: [tag] });
    // Іменник на сторінці — це той самий тег, а не ширше слово («shop that sells food»).
    expect(noun).toBe(tag);
  });
});

test.describe('database §names and web addresses: суфікс слага', () => {
  test('🔴 суфікс призначається по всій базі: запит без WHERE, індекс на одному slug', () => {
    const code = readCode(join(API_SRC, 'osm', 'import-spots.ts'));
    const sql = /`SELECT slug FROM camping_spots([^`]*)`/.exec(code);
    expect(sql, 'в import-spots.ts немає SELECT slug FROM camping_spots — розбір сліпий').toBeTruthy();
    expect(sql![1], 'запит «зайнятих слагів» тепер звужений — суфікс уже не глобальний').not.toMatch(
      /\bWHERE\b|region|country/i,
    );
    expect(code).toMatch(/while \(usedSlugs\.has\(slug\)\)/);

    const init = readFileSync(join(API_SRC, 'migrations', '1789814452827-InitSchema.ts'), 'utf8');
    expect(init, 'унікальний індекс slug уже не лише на одному полі').toMatch(
      /CREATE UNIQUE INDEX "[^"]+" ON "camping_spots"\s+\("slug"\)\s/,
    );

    const sentence = /Where two campsites[^.]*\./.exec(pageText('database'))?.[0];
    expect(sentence, 'на сторінці немає речення про однакові адреси').toBeTruthy();
    expect(sentence).toContain('anywhere in the database');
    expect(sentence, 'сторінка знову звужує суфікс до регіону чи країни').not.toMatch(/region|country/i);
  });
});

test.describe('database §joined: що не лежить у записі', () => {
  test('🔴 у записі кемпінгу немає полів про індексацію регіону й приховану ціну — обидва рішення рахуються', () => {
    // Властивості сутності.
    const entity = readCode(join(API_SRC, 'entities', 'camping-spot.entity.ts'));
    const props = [...entity.matchAll(/^\s{2}(\w+)[?!]?:\s/gm)].map((m) => m[1]);
    const columnNames = [...entity.matchAll(/\bname:\s*'(\w+)'/g)].map((m) => m[1]);
    expect(props.length, 'розбір сутності не знайшов жодного поля — сліпий').toBeGreaterThan(15);
    const decisions = /index|withheld|publish|thin|visible|hidden/i;
    expect([...props, ...columnNames].filter((n) => decisions.test(n))).toEqual([]);

    // Колонки, які додавали міграції до camping_spots.
    const dir = join(API_SRC, 'migrations');
    const added: string[] = [];
    for (const f of readdirSync(dir)) {
      for (const m of readFileSync(join(dir, f), 'utf8').matchAll(
        /ALTER TABLE\s+"?camping_spots"?\s+ADD\s+(?:COLUMN\s+)?(?:IF NOT EXISTS\s+)?"?(\w+)"?/gi,
      ))
        added.push(m[1]);
    }
    expect(added.length, 'жодної ADD COLUMN для camping_spots — розбір міграцій сліпий').toBeGreaterThan(5);
    expect(added.filter((n) => decisions.test(n))).toEqual([]);

    // І обидва рішення справді приймаються в коді запиту, а не лежать у рядку.
    const svc = readCode(join(API_SRC, 'spots', 'spots.service.ts'));
    expect(svc).toMatch(/indexable:\s*r\.spots\s*>=\s*REGION_INDEX_THRESHOLD/);

    const text = pageText('database');
    expect(text).toContain('neither is stored in the campsite record');
    expect(text).toContain('is worked out when the page is built');
    expect(text, 'стара фраза «carries whether» повернулась').not.toContain('record also carries');
  });
});

/**
 * 🔴 CAMP-475. Сторінка описує ПРАВИЛО ПОКАЗУ ЦІНИ, і з 09.11.2026 це вже
 * інше правило: недатовану ціну показуємо, застарілу — ні. Редакція 1.1
 * казала протилежне, і доти, доки це речення не звірялося з кодом, воно
 * могло розійтися з ним мовчки — як і розійшлося.
 *
 * Тому тут жодного літерала-твердження: число 21 береться з
 * `TARIFF_STALE_AFTER_DAYS`, слова «Season not stated» — з
 * `NO_SEASON_LABEL`, а «показуємо незалежно від дати» доводиться тим, що
 * в `DISPLAYABLE_TARIFF_SQL` не лишилось умови про дату.
 */
test.describe('database §joined: правило показу ціни', () => {
  test('🔴 речення про ціну дорівнює тому, що робить код', () => {
    const tariffs = readCode(join(API_SRC, 'spots', 'tariffs.ts'));

    // Число днів — з коду, не з тексту тесту.
    const days = /TARIFF_STALE_AFTER_DAYS\s*=\s*(\d+)/.exec(tariffs);
    expect(days, 'у tariffs.ts немає TARIFF_STALE_AFTER_DAYS — розбір сліпий').toBeTruthy();

    // Умова показу: свіжість є, дати немає. Саме це й каже сторінка.
    const displayable = /DISPLAYABLE_TARIFF_SQL\s*=\s*`([^`]*)`/.exec(tariffs);
    expect(displayable, 'у tariffs.ts немає DISPLAYABLE_TARIFF_SQL — розбір сліпий').toBeTruthy();
    expect(
      displayable![1],
      'умова показу знову дивиться на дату — сторінка про це більше не каже',
    ).not.toContain('DATED_TARIFF_SQL');
    expect(displayable![1], 'умова показу більше не дивиться на свіжість').toContain(
      'FRESH_TARIFF_SQL',
    );

    // Позначка періоду — з коду веба.
    const web = readCode(join(ROOT, 'apps', 'web', 'src', 'lib', 'tariffs.ts'));
    const label = /NO_SEASON_LABEL\s*=\s*'([^']+)'/.exec(web);
    expect(label, 'у web/lib/tariffs.ts немає NO_SEASON_LABEL — розбір сліпий').toBeTruthy();

    const text = pageText('database');
    expect(text, `сторінка не називає строк ${days![1]} днів із TARIFF_STALE_AFTER_DAYS`).toContain(
      `${days![1]} days`,
    );
    expect(text, `сторінка не називає позначку «${label![1]}»`).toContain(label![1]);
    expect(
      text,
      'сторінка знову обіцяє ховати ціну за відсутність дати',
    ).not.toContain('from whether the source gave it any date');

    // І нота біля ціни, про яку сторінка каже, справді є в компоненті.
    const table = readCode(join(ROOT, 'apps', 'web', 'src', 'components', 'tariff-table.tsx'));
    expect(table, 'у tariff-table.tsx немає ноти про джерело ціни').toContain(
      'data-testid="tariffs-price-note"',
    );
  });
});

test.describe('database §joined: переможений дублікат', () => {
  const named = (ref: string, lon: number, tags: Record<string, string>): Staging =>
    ({
      osm_ref: ref,
      point_wkt: `POINT(${lon} 46.36)`,
      outline_wkt: null,
      admin_region: 'Bled',
      admin_country: 'SI',
      tags: { name: 'Camping Test', ...tags },
    }) satisfies Staging;
  const unnamed = (ref: string, lon: number, tags: Record<string, string>): Staging =>
    ({
      osm_ref: ref,
      point_wkt: `POINT(${lon} 46.36)`,
      outline_wkt: null,
      admin_region: 'Bled',
      admin_country: 'SI',
      tags: { ...tags },
    }) satisfies Staging;

  /** Те, що стверджує сторінка про переможеного, — з відрендереного тексту. */
  const claim = () => {
    const para = paragraphs('database').find((p) => p.text.includes('The record that loses is not kept'));
    expect(para, 'на сторінці немає абзацу про переможеного').toBeTruthy();
    return para!.text;
  };

  for (const [label, make, merge] of [
    ['з назвою (dedupe)', named, dedupe],
    ['без назви (mergeUnnamed)', unnamed, mergeUnnamed],
  ] as const) {
    test(`🔴 ${label}: переможений не лишається записом, його теги зливаються, спільні — за переможцем`, () => {
      // Вузол і контур одного місця, 20 м одне від одного: контур переможе.
      const way = make('w100', 14.0, { shower: 'yes', website: 'https://survivor.example' });
      const node = make('n200', 14.0003, { toilets: 'yes', website: 'https://loser.example', wifi: 'wlan' });
      const survivorOwn = { ...way.tags };
      const loserOwn = { ...node.tags };

      const out = merge([way, node]);

      // 1. Переможений не лишається окремим записом.
      expect(out.map((r) => r.osm_ref)).toEqual(['w100']);
      // 2. Теги, яких переможець не мав, скопійовано.
      for (const [k, v] of Object.entries(loserOwn)) {
        if (!(k in survivorOwn)) expect(out[0].tags[k], `тег ${k} переможеного не скопійовано`).toBe(v);
      }
      // 3. Де тег є в обох, стоїть значення переможця.
      expect(out[0].tags.website).toBe(survivorOwn.website);
      // Власні теги переможця не втрачені.
      expect(out[0].tags.shower).toBe('yes');

      // …і саме це стверджує сторінка.
      const text = claim();
      expect(text).toContain('is not kept as a record of its own');
      expect(text).toContain('every tag it had that the surviving record lacked is copied into the survivor');
      expect(text).toContain('where both carry the same tag the survivor’s value stands');
    });
  }
});
