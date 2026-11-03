#!/usr/bin/env node
// CAMP-39: the sitemap says what we mean, and llms.txt exists.
//
//   node scripts/seo/check-sitemap.mjs [--dir apps/web/.next/server/app]
//
// XSD validation is done separately with xmllint against the committed
// schemas in scripts/seo/schemas/ — this checks the things a schema
// cannot express, which are the things that actually go wrong:
//
// 🔴 1. No URL in the sitemap may carry `noindex`. The two are
//       contradictory instructions about one page, and the resolution is
//       Google's choice, not ours. This is the check that matters: the
//       XML stays perfectly valid while the meaning is wrong.
//    2. Every child named by the index exists and is non-empty.
//    3. Every `loc` is absolute, https, and on our host.
//    4. `lastmod` is a real W3C date, and not all identical — a sitemap
//       that stamps today on every page teaches a crawler to ignore the
//       field entirely.
//    5. Chunks stay under the protocol's 50,000-URL limit.
//    6. llms.txt is served and has the shape llmstxt.org describes.

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

const args = process.argv.slice(2);

// ── чисті функції: те, що самоперевірка може кликати з фікстурою ───────
//
// 🔴 CAMP-300. ДО ЦЬОГО ЇХ НЕ БУЛО, І САМЕ ТОМУ ПЕРЕВІРЯТИ БУЛО НІЧИМ.
//
// Перевірку «кожен розділ мапи названий у llms.txt» відрепетирували
// руками в скретчпаді сесії, на фікстурі, якої більше ніхто не побачить.
// Рецензія PR #194 знайшла в ній ДВА дефекти, яких репетиція не
// спіймала б, — і обидва живуть нижче окремими випадками.
//
// Доки логіка сиділа в суцільному потоці над каталогом збірки, її не
// можна було покликати ні з чим, окрім справжньої збірки. Тепер можна.

/** Верхній сегмент шляху, або `null` для кореня. */
export function sectionOf(url) {
  // Кидає на тому, що не розібралось: усі ці адреси вже перевірені як
  // абсолютні https вище. `catch`, що ковтає форму, колись перетворив
  // КОЖЕН розділ на '' — сторож, який не міг спрацювати ніколи.
  return new URL(url).pathname.split('/').filter((x) => x !== '')[0] ?? null;
}

/**
 * Розділи, які публікує мапа сайту.
 *
 * 🔴 Корінь НАЗИВАЄТЬСЯ `null` і відсівається, а не перетворюється на ''.
 * Мутація, що прибирала відсів, пережила всю репетицію: '' потрапляв у
 * множину, а стара підрядкова перевірка питала `llms.includes('/')` —
 * істинне для кожної адреси у файлі. Порожній розділ був «названий» за
 * побудовою.
 */
export function sectionsOf(urls) {
  return [...new Set(urls.map(sectionOf).filter((x) => x !== null))].sort();
}

/**
 * Розділи, названі посиланнями в `llms.txt`.
 *
 * 🔴 ПОРІВНЮЮТЬСЯ СЕГМЕНТИ, А НЕ ПІДРЯДКИ. Перша редакція питала
 * `llms.includes('/camper')` — і рядок `/camper-rental` задовольняв її.
 * Цілий розділ мапи вважався названим, не бувши названим.
 */
export function namedIn(llms) {
  return new Set(
    [...llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)]
      .map((m) => {
        try {
          return sectionOf(m[1]) ?? '';
        } catch {
          return '';
        }
      })
      .filter(Boolean),
  );
}

/** Розділи мапи, яких `llms.txt` не називає. */
export function unlistedOf(sections, named) {
  return sections.filter((x) => !named.has(x));
}
const modeIndex = args.indexOf('--mode');
/**
 * 🔴 CAMP-90 made this two-sided instead of optional.
 *
 * When the whole site is closed, every page carries noindex, so the
 * rule "nothing in the sitemap is noindex" would fail on every URL. The
 * tempting fix is to skip the rule in closed mode — which is how a
 * check quietly stops checking and then passes everything for ever.
 *
 * So it inverts instead. In a closed build the sitemap must be entirely
 * noindex, for the same reason it must be entirely indexable in a
 * public one: the sitemap and the pages have to agree, whichever way
 * round that is.
 */
const MODE = modeIndex >= 0 ? args[modeIndex + 1] : 'public';
if (MODE !== 'public' && MODE !== 'closed') {
  console.error('--mode must be "public" or "closed"');
  process.exit(2);
}
const expectIndexable = MODE === 'public';
const dirIndex = args.indexOf('--dir');
const ROOT =
  dirIndex >= 0 && args[dirIndex + 1]
    ? args[dirIndex + 1]
    : 'apps/web/.next/server/app';

const MAX_URLS = 50_000;
const errors = [];
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

// ── the index ────────────────────────────────────────────────────────────

// ── точка входу ───────────────────────────────────────────────────────
//
// 🔴 CAMP-286: прапорець, якого цей файл не знає, — помилка, а не знизані
// плечі. І САМОПЕРЕВІРКА СТОЇТЬ ПЕРЕД ЖИВИМ ПРОХОДОМ: інакше `--self-test`
// провалився б у обхід каталогу збірки, якого на ноуті немає, і впав би
// з «No sitemap index built» — тобто з неправильної причини.
//
// 🔴 А живий прохід загорнуто у функцію, бо інакше сам ІМПОРТ цього
// модуля його запускає. Заміряно: `import()` друкував «No sitemap index
// built … Build first» ще до того, як викликали хоч щось.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  chooseAction(args, ['--self-test', '--mode', '--dir'], 'check-sitemap.mjs', {
    takesValue: ['--mode', '--dir'],
  });
}

// ── самоперевірка ─────────────────────────────────────────────────────
//
// 🔴 CAMP-300. ВИПАДКИ НА МНОЖИНУ РОЗДІЛІВ, А НЕ ЛИШЕ НА ВИРОК.
//
// Саме цього бракувало в репетиції з PR #194: матриця пінила
// «червоно/зелено», а НАБІР розділів лишався неперевіреним — і мутація
// в ньому виживала. Тому більшість випадків нижче стверджують про
// `sectionsOf` і `namedIn`, а не про те, скільки знайшлось помилок.

const EXPECTED_CASES = 13;

const U = (p) => `https://camptribe.eu${p}`;

function selfTest() {
  let pass = 0;
  let fail = 0;
  const check = (what, got) => {
    if (got) {
      console.log(`  ✓ ${what}`);
      pass += 1;
    } else {
      console.error(`  ✗ ${what}`);
      fail += 1;
    }
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ── sectionOf ──
  check('верхній сегмент шляху', sectionOf(U('/camping/fr/x')) === 'camping');
  check('корінь — це null, а не порожній рядок', sectionOf(U('/')) === null);
  check(
    'адреса без шляху теж null',
    sectionOf('https://camptribe.eu') === null,
  );

  // ── sectionsOf ──
  check(
    'розділи унікальні й відсортовані',
    same(sectionsOf([U('/tools/a'), U('/camping/x'), U('/tools/b')]), [
      'camping',
      'tools',
    ]),
  );
  // 🔴 ДЕФЕКТ 1 З РЕЦЕНЗІЇ #194, ПОІМЕННО.
  //
  // Мутація «прибрати відсів кореня» пережила всю репетицію: '' падав у
  // множину, а стара підрядкова перевірка питала `llms.includes('/')` —
  // істинне для кожної адреси у файлі. Порожній розділ був «названий» за
  // побудовою, тобто сторож не міг спрацювати.
  check(
    '🔴 корінь НЕ стає порожнім розділом у наборі',
    same(sectionsOf([U('/'), U('/camping/x')]), ['camping']),
  );
  check('порожній вхід — порожній набір', same(sectionsOf([]), []));

  // ── namedIn ──
  check(
    'розділ, названий посиланням, потрапляє в набір',
    namedIn(`- [Camping](${U('/camping')})`).has('camping'),
  );
  check(
    'посилання на корінь не дає порожнього розділу',
    !namedIn(`- [Home](${U('/')})`).has(''),
  );
  check(
    'текст без посилань нічого не називає',
    namedIn('## Tools\n\nвсе про /tools, але без лінка').size === 0,
  );

  // ── вирок ──
  check(
    'усе назване — порожній перелік',
    same(unlistedOf(['camping'], new Set(['camping'])), []),
  );
  check(
    'неназване називається поіменно',
    same(unlistedOf(['camping', 'tools'], new Set(['camping'])), ['tools']),
  );

  // 🔴 ДЕФЕКТ 2 З РЕЦЕНЗІЇ #194, ПОІМЕННО.
  //
  // Підрядок `llms.includes('/camper')` задовольнявся рядком
  // `/camper-rental`: цілий розділ мапи вважався названим, не бувши
  // названим. Тут порівнюються СЕГМЕНТИ, тож сусід із тим самим початком
  // іншого розділу не закриває.
  check(
    '🔴 `/camper-rental` НЕ називає розділ `/camper`',
    same(
      unlistedOf(['camper'], namedIn(`- [Rental](${U('/camper-rental')})`)),
      ['camper'],
    ),
  );
  check(
    'а сам `/camper-rental` себе називає',
    same(
      unlistedOf(
        ['camper-rental'],
        namedIn(`- [Rental](${U('/camper-rental')})`),
      ),
      [],
    ),
  );

  // 🔴 Літерал проти виконаного: випадок, який ніхто не покликав,
  // інакше лишився б непоміченим, а число у звіті — правдоподібним.
  const ran = pass + fail;
  if (ran !== EXPECTED_CASES) {
    console.error(
      `  ✗ виконано ${ran} випадків, а EXPECTED_CASES каже ${EXPECTED_CASES}`,
    );
    fail += 1;
  }

  if (fail) {
    console.error(`\n✗ check-sitemap self-test: ${fail} case(s) behaved wrongly`);
    process.exit(1);
  }
  console.log(`\n✓ check-sitemap self-test: ${pass} cases`);
}

function live() {

  const indexPath = path.join(ROOT, 'sitemap.xml.body');
  const indexXml = read(indexPath) ?? read(path.join(ROOT, 'sitemap.xml'));
  if (!indexXml) {
    console.error(`No sitemap index built under ${ROOT}. Build first.`);
    process.exit(1);
  }
  if (!indexXml.includes('<sitemapindex')) {
    errors.push('sitemap.xml is not a <sitemapindex>');
  }

  const children = locs(indexXml);
  if (children.length === 0) errors.push('sitemap index lists no children');

  // ── the children ─────────────────────────────────────────────────────────
  const allUrls = [];
  const lastmods = new Set();

  for (const child of children) {
    const name = child.split('/').pop();
    const file =
      read(path.join(ROOT, 'sitemaps', `${name}.body`)) ??
      read(path.join(ROOT, 'sitemaps', name));
    if (!file) {
      errors.push(`index points at ${name}, which was not built`);
      continue;
    }
    const urls = locs(file);
    if (urls.length === 0) errors.push(`${name} contains no URLs`);
    if (urls.length > MAX_URLS) {
      errors.push(`${name} has ${urls.length} URLs, over the ${MAX_URLS} limit`);
    }
    for (const m of file.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
      const v = m[1];
      if (!/^\d{4}-\d{2}-\d{2}(T[\d:.+\-Z]+)?$/.test(v)) {
        errors.push(`${name}: lastmod "${v}" is not a W3C datetime`);
      }
      lastmods.add(v);
    }
    allUrls.push(...urls.map((u) => ({ url: u, from: name })));
  }

  // ── the URLs themselves ──────────────────────────────────────────────────
  const seen = new Set();
  for (const { url, from } of allUrls) {
    if (!/^https:\/\//.test(url)) {
      errors.push(`${from}: "${url}" is not an absolute https URL`);
    }
    if (seen.has(url)) errors.push(`${from}: "${url}" appears twice`);
    seen.add(url);
  }

  // 🔴 The check this script exists for — in whichever direction applies.
  let noindexed = 0;
  const disagree = [];
  for (const { url, from } of allUrls) {
    const p = new URL(url).pathname.replace(/^\/|\/$/g, '') || 'index';
    const html = read(path.join(ROOT, `${p}.html`));
    if (html === null) {
      errors.push(`${from}: "${url}" has no built page`);
      continue;
    }
    const isNoindex = /<meta name="robots"[^>]*content="[^"]*noindex/i.test(html);
    if (isNoindex) noindexed++;
    if (isNoindex === expectIndexable) disagree.push(`${from}: ${url}`);
  }
  if (disagree.length) {
    errors.push(
      expectIndexable
        ? `${disagree.length} URL(s) in the sitemap carry noindex: ${disagree[0]}`
        : `${disagree.length} URL(s) in a closed build are still indexable: ${disagree[0]}`,
    );
  }

  // 🔴 CAMP-211. Один підрахунок на перевірку й на підсумок.
  //
  // 🔴 `allUrls` holds `{ url, from }`, not strings. The first version of
  // this mapped the OBJECT through `new URL(...)`, which throws, and the
  // catch turned every section into '' — a guard that could never fire,
  // passing because it saw nothing. So: no `catch` that swallows the
  // shape. A URL that does not parse is an error here, because every one
  // of them has already been checked as absolute https above.
  //
  // 🔴 `null` is the ROOT PAGE, named rather than filtered for truth.
  // `.filter(Boolean)` here was a mutation that survived the whole
  // rehearsal: dropping it put '' in the set, and the old substring test
  // asked `llms.includes('/')`, which every URL in the file satisfies.
  // An empty section was therefore "named" by construction. Below it
  // cannot be: '' is not a path segment any link produces.
  const sections = sectionsOf(allUrls.map(({ url }) => url));
  let unlisted = [];
  let sectionsChecked = false;

  // ── llms.txt ─────────────────────────────────────────────────────────────
  const llms =
    read(path.join(ROOT, 'llms.txt.body')) ?? read(path.join(ROOT, 'llms.txt'));
  if (!llms) {
    errors.push('llms.txt was not built');
  } else {
    if (!/^# \S/m.test(llms)) errors.push('llms.txt has no H1 title');
    if (!/^> \S/m.test(llms)) errors.push('llms.txt has no blockquote summary');
    if (!/^## /m.test(llms)) errors.push('llms.txt has no sections');
    if (!llms.includes('/sitemap.xml')) {
      errors.push('llms.txt does not point at the sitemap');
    }

    // 🔴 CAMP-211. EVERY SECTION THE SITEMAP PUBLISHES MUST BE NAMED HERE.
    //
    // Measured 12.10.2026: the sitemap published five top-level sections
    // and llms.txt named two. `/guides`, `/tools` and `/routes` were
    // absent from it entirely — so the one file we hand an assistant as
    // "here is what we have" did not mention 1 256 guides, twelve curated
    // routes or either calculator.
    //
    // The shape checks above cannot see this: a file with an H1, a
    // blockquote, sections and a sitemap link passes all four while
    // describing a third of the site. This asks the sitemap what exists
    // instead of asking llms.txt whether it looks well-formed.
    //
    // It matters more than it used to. Google retired `HowTo` (2023) and
    // `SpecialAnnouncement` (31 July 2025) and narrowed `FAQPage` to
    // government and health sites, so the rich results that markup aimed
    // at are gone — while assistants still read this file.
    // 🔴 ЗВІРЯЄМО З ПОСИЛАННЯМИ, ЯКІ ФАЙЛ СПРАВДІ ДАЄ — не підрядком.
    //
    // `llms.includes(`/${x}`)` було ХИБНИМ ПРОХОДЖЕННЯМ, і рецензія це
    // показала випадком: розділ `/camper/...` у мапі «названий», бо в
    // файлі стоїть `/camper-rental`. Так само мовчки пройшли б `/camp`,
    // `/guide`, `/route`, `/tool` — тобто рівно ті назви, які ми й
    // заводимо. Підрядок відповідає на інше питання, ніж тут поставлене.
    //
    // Тому: беремо перший сегмент КОЖНОГО посилання у файлі й порівнюємо
    // множини. Згадка в прозі без посилання не рахується — агент ходить
    // по посиланнях, а не по прикметниках.
    unlisted = unlistedOf(sections, namedIn(llms));
    sectionsChecked = true;
    if (unlisted.length) {
      errors.push(
        `llms.txt never mentions ${unlisted.length} of ${sections.length} ` +
          `sitemap section(s): ${unlisted.join(', ')}`,
      );
    }
  }

  console.log(`mode            ${MODE}`);
  console.log(`children        ${children.length}`);
  console.log(`urls            ${allUrls.length}`);
  console.log(`distinct dates  ${lastmods.size}`);
  console.log(`noindex in map  ${noindexed}`);
  console.log(`llms.txt        ${llms ? `${llms.split('\n').length} lines` : 'MISSING'}`);
  // 🔴 Рядок не сміє ЗВІТУВАТИ про перевірку, якої не було. Рецензія
  // показала: `unlisted` оголошено вище блоку, тож без зібраного
  // llms.txt друкувалось «MISSING» і «5 of 5 named» поруч — підпис під
  // перевіркою, яка не виконалась.
  console.log(
    sectionsChecked
      ? `llms sections   ${sections.length - unlisted.length} of ${sections.length} named` +
          (unlisted.length ? ` — missing: ${unlisted.join(', ')}` : '')
      : `llms sections   not checked — ${sections.length} in sitemap, llms.txt absent`,
  );

  if (lastmods.size === 1 && allUrls.length > 50) {
    console.warn(
      '\n⚠ every lastmod is identical — the field carries no information',
    );
  }

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors.slice(0, 20)) console.error(`   ${e}`);
    if (errors.length > 20) console.error(`   … and ${errors.length - 20} more`);
    process.exit(1);
  }

  console.log(
    `\n✓ sitemap and pages agree — all ${allUrls.length} are ` +
      `${expectIndexable ? 'indexable' : 'noindex, as a closed build requires'}`,
  );

}

if (invokedDirectly) {
  if (args.includes('--self-test')) selfTest();
  else live();
}
