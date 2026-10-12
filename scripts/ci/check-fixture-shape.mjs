#!/usr/bin/env node
// 🔴 Does the fixture still hold the SHAPES the tests stand on?
//
// CAMP-173. `check-fixture-not-shrunk.mjs` counts HOW MANY rows, and a
// regeneration from a newer database passed it — 73 → 90 campsites,
// 43 → 62 bathing waters — while producing a fixture nothing could use:
// 89 campsites across 9 countries with **no Slovenia at all**, one
// surviving id out of 72, and a load that died on the gone block with
// "expected to mark exactly one campsite gone, marked 0".
//
// The tool worked, the guard said "not smaller", and the result was
// rubbish. A count is not a shape.
//
// `_select.sql` builds this fixture out of deliberate pieces — a region
// big enough to paginate, a region of exactly one, a campsite that says
// it has toilets and one that says it has none — and every one of those
// is a test's subject. None of them is named anywhere that fails when it
// disappears. This file names them.
//
// 🔴 It guards the COMMITTED fixture, in CI. `regenerate.sh` only
// prints a reminder to run it — it does not run it, and an earlier
// draft of this header said it did. A file that describes a guard it
// does not have is the same failure as a guard that does not bite, so
// the sentence is corrected rather than the script quietly changed:
// wiring it into regenerate.sh is CAMP-173's follow-up, not a claim to
// make here.
//
// Run it by hand on a candidate:  node scripts/ci/check-fixture-shape.mjs <file>

import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SEED = join(ROOT, 'apps', 'api', 'test', 'fixtures', 'ci-seed.sql');
const API_FILE = join(ROOT, 'apps', 'web', 'src', 'lib', 'api.ts');

/**
 * The paginator's own page size, read from the paginator.
 *
 * 🔴 Retyped as `24` and compared with `>=`, this guard certified "it
 * paginates" for a fixture whose biggest region holds exactly 24 — the
 * state in which `hubs.spec.ts` calls `test.skip('No region currently
 * exceeds 24 campsites, so nothing paginates')`. The guard's own error
 * text said the words the paginator was printing as it skipped.
 *
 * So the number is read, and the comparison below is `>`, which is the
 * predicate hubs.spec.ts uses: `all.find(r => r.spots > REGION_PER_PAGE)`.
 */
export function regionPerPage(src) {
  const m = /export const REGION_PER_PAGE\s*=\s*(\d+)/.exec(src);
  return m ? Number(m[1]) : null;
}

/**
 * Split one SQL tuple on its top-level commas.
 *
 * ⚠️ The same twenty lines live in check-fixture-counts.mjs. They are
 * duplicated on purpose for now, because the two arrived on separate
 * branches and sharing a module across both would have made each one
 * wait for the other. Fold them together once both have landed — and
 * until then, a change to one is a change to both.
 */
export function splitTuple(s) {
  const out = [];
  let buf = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === "'" && s[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      if (c === "'") quoted = false;
      buf += c;
      continue;
    }
    if (c === "'") {
      quoted = true;
      buf += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  out.push(buf.trim());
  return out;
}

/** `'paid'::enum` → `paid`; `NULL` → null. */
export function literal(v) {
  const bare = v.replace(/::[A-Za-z_][\w.]*$/, '').trim();
  if (/^NULL$/i.test(bare)) return null;
  const m = /^'([\s\S]*)'$/.exec(bare);
  return m ? m[1].replace(/''/g, "'") : bare;
}

/** The literal `INSERT INTO camping_spots` rows, as objects. */
export function readSpots(sql) {
  const rows = [];
  rows.skipped = [];
  const re =
    /INSERT INTO camping_spots\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\);\s*$/gm;
  for (const m of sql.matchAll(re)) {
    const cols = m[1].split(',').map((c) => c.trim());
    const vals = splitTuple(m[2]);
    if (cols.length !== vals.length) {
      // 🔴 Counted, never dropped quietly. `check-fixture-not-shrunk.mjs`
      // states the policy this file has to share: a row it cannot count
      // throws, because "cannot count" that reads as zero is how a guard
      // becomes a no-op. Today this skips exactly the one computed twin;
      // a parser that started skipping forty would otherwise report a
      // confident ✓ over a third of the fixture.
      rows.skipped.push(cols[0] ?? '?');
      continue;
    }
    const row = {};
    cols.forEach((c, i) => (row[c] = literal(vals[i])));
    rows.push(row);
  }
  return rows;
}

/**
 * The row the gone DO block in `ci-seed.sql` (line 146) marks at load.
 *
 * 🔴 Not "the final DO block", which is what this said until a review
 * checked it: the LAST block in that file seeds webcams (line 717), and
 * an air-quality block sits between them. A docstring pointing at the
 * wrong block sends the next reader to confirm this mirror against
 * something it does not mirror.
 *
 * Mirrors it exactly: a region, no explicit toilets answer, no computed
 * context, `ORDER BY slug DESC LIMIT 1`. `undefined` means the block
 * will mark nothing and the load will raise.
 */
export function goneTarget(present) {
  return present
    .filter((r) => toilets(r) === 'unknown' && (r.context ?? '{}') === '{}')
    .sort((a, b) => String(b.slug).localeCompare(String(a.slug)))[0];
}

/**
 * The row that must stay THIN after the gone block has taken its own.
 *
 * 🔴 TWO TESTS WANT AN EMPTY CONTEXT AND THEY ARE NOT THE SAME ROW.
 *
 * `goneTarget` above takes the highest such slug and the loader marks it
 * `missing_since`, which removes it from `/spots/index` entirely. So a
 * fixture with exactly ONE empty-context row has a gone subject and no
 * thin one, and `sitemap.spec.ts` fails with "no campsite carries
 * nothing — the rule has no subject".
 *
 * That is precisely what happened: filling the 36 missing contexts for
 * CAMP-199 left `kamp-vinia` as the only candidate, and it is the gone
 * row. The two fixtures collided and the e2e job was the first thing to
 * notice. This says so here instead, before a build.
 */
export function thinTarget(present) {
  const gone = goneTarget(present);
  return present
    .filter(
      (r) =>
        r.slug !== gone?.slug &&
        (r.context ?? '{}') === '{}' &&
        !hasKnownAmenity(r) &&
        !r.description &&
        !r.stars,
    )
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))[0];
}

/** `NOTHING_TO_SAY_SQL`'s first clause: any amenity answered yes or no. */
function hasKnownAmenity(row) {
  try {
    return Object.values(JSON.parse(row.amenities ?? '{}')).some(
      (v) => v === 'yes' || v === 'no',
    );
  } catch {
    return false;
  }
}

const toilets = (row) => {
  try {
    return JSON.parse(row.amenities ?? '{}').toilets ?? 'unknown';
  } catch {
    return 'unknown';
  }
};

/**
 * Everything the fixture must still contain, each with the test that
 * stops meaning anything without it.
 *
 * 🔴 Named, not counted. "At least as many rows" is what let a fixture
 * with no Slovenia through.
 */
export function shapeProblems(rows, perPage = 24) {
  const problems = [];
  const present = rows.filter((r) => r.region && r.missing_since === null);

  // 🔴 The file is not the database. `ci-seed.sql` ends with a DO block
  // that marks ONE more row gone at load time — the highest slug among
  // rows with a region, no explicit toilets answer and no computed
  // context — so every count taken from the file is one row generous
  // for exactly that region.
  //
  // It matters at the edges, which is the only place this guard lives:
  // on the committed fixture the doomed row is `kamp-vinia`, the sole
  // member of Bjelovarsko-bilogorska. Read from the file that region
  // holds 1 and the "exactly one" subject is satisfied; after loading it
  // holds 0. A fixture can therefore pass this guard and still leave
  // `hubs.spec.ts` throwing "Need at least one indexable and one thin
  // region" — the CAMP-71 subject this guard exists to protect.
  const doomed = goneTarget(present);
  const live = present.filter((r) => r !== doomed);

  const byCountry = {};
  for (const r of live) {
    const c = String(r.country).toUpperCase();
    byCountry[c] = (byCountry[c] ?? 0) + 1;
  }
  // `/camping/si/…` is written into seven e2e assertions. A fixture
  // without Slovenia leaves them testing a 404.
  for (const c of ['SI', 'HR']) {
    if (!byCountry[c]) problems.push(`no ${c} campsites at all — e2e paths under /camping/${c.toLowerCase()}/ have no subject`);
  }

  const byRegion = {};
  for (const r of live) byRegion[r.region] = (byRegion[r.region] ?? 0) + 1;
  const sizes = Object.values(byRegion);

  if (!sizes.some((n) => n > perPage)) {
    problems.push(
      `no region holds more than ${perPage} campsites — nothing paginates, ` +
        'so the paginator tests have no subject (hubs.spec.ts skips itself)',
    );
  }
  if (!sizes.some((n) => n === 1)) {
    problems.push('no region holds exactly 1 campsite — the "reachable but not indexed" case (CAMP-71) has no subject');
  }

  for (const want of ['yes', 'no']) {
    if (!live.some((r) => toilets(r) === want)) {
      problems.push(`no campsite answers toilets="${want}" — the three-state amenity model has no ${want === 'no' ? 'honest negative' : 'positive'}`);
    }
  }

  // 🔴 CAMP-199. The fixture must carry the surroundings we compute,
  // because the pages that need them most are the ones it was missing
  // them on.
  //
  // Measured 04.10.2026: in production, 61 557 campsites of 61 557 have
  // a computed context. In this fixture, 37 of 73 rows had `'{}'` — and
  // all ten of the Zadarska campsites failing the duplicate-page guard
  // were among them. So the paragraph built from those figures rendered
  // EMPTY on exactly the pages it was written to rescue, the guard's
  // verdict did not move by a decimal, and the whole change looked
  // ineffective when it had simply never run.
  //
  // A fixture that lacks a field every real row has is not a smaller
  // sample. It is a different site.
  const withContext = live.filter((r) => (r.context ?? '{}') !== '{}').length;
  if (withContext * 2 < live.length) {
    problems.push(
      `only ${withContext} of ${live.length} campsites carry a computed context — ` +
        'in production every one does, so anything built from those figures is ' +
        'untested here (CAMP-199)',
    );
  }

  // 🔴 CAMP-105's subject, which the gone block must not have eaten.
  // See `thinTarget`: both want an empty context, and the loader hides
  // the gone one from the index.
  // `present`, not `live`: `thinTarget` removes the gone row itself, and
  // handing it a list the gone row has already left would make it drop a
  // second one.
  if (thinTarget(present) === undefined) {
    problems.push(
      'no LIVE campsite carries nothing but a name — `sitemap.spec.ts` ' +
        'will fail with "the rule has no subject". Production has none ' +
        'either (0 of 58 436 on 04.10.2026), so this fixture is the only ' +
        'place the noindex branch is reachable: leave one row with an ' +
        'empty context, and give it a slug sorting below the gone row',
    );
  }

  // Zero candidates is the load error the card quotes: "marked 0".
  if (doomed === undefined) {
    problems.push('nothing is eligible for the gone block — loading will die with "expected to mark exactly one campsite gone, marked 0"');
  }

  return problems;
}

function run(file, log = console, apiSrc = undefined) {
  let sql;
  try {
    sql = readFileSync(file, 'utf8');
  } catch (err) {
    log.error(`✗ cannot read ${file}: ${(err && err.message) || err}`);
    return 1;
  }
  const rows = readSpots(sql);
  if (rows.length === 0) {
    log.error(`✗ ${file} holds no camping_spots rows at all`);
    return 1;
  }
  // 🔴 A row the parser could not read is a row this guard did not
  // check. One is the known computed twin; more than one means the
  // parser has fallen behind the fixture's syntax, and a ✓ over the
  // remainder would be a smaller claim than it looks.
  if (rows.skipped.length > 1) {
    log.error(
      `✗ ${file}: ${rows.skipped.length} INSERT rows could not be parsed ` +
        '(column and value counts disagree), so they were not checked.\n' +
        '  One is the computed twin and expected. More than one means this\n' +
        '  parser no longer reads the fixture it is guarding.',
    );
    return 1;
  }

  const perPage = regionPerPage(apiSrc ?? readFileSync(API_FILE, 'utf8'));
  if (perPage === null) {
    log.error(
      '✗ REGION_PER_PAGE could not be read from apps/web/src/lib/api.ts —\n' +
        '  without it the pagination subject would be checked against a\n' +
        '  number retyped here, which is how this guard certified a fixture\n' +
        '  that made the paginator skip itself.',
    );
    return 1;
  }

  const problems = shapeProblems(rows, perPage);
  if (problems.length > 0) {
    log.error('✗ The fixture no longer holds what the tests stand on:\n');
    for (const p of problems) log.error(`  ${p}`);
    log.error(
      '\n  A regeneration can satisfy check-fixture-not-shrunk.mjs — which\n' +
        '  counts rows — and still produce this. Fix the selection in\n' +
        '  apps/api/test/fixtures/_select.sql rather than the expectation\n' +
        '  here: every line above names a test that would otherwise pass\n' +
        '  over missing data.',
    );
    return 1;
  }
  // 🔴 Names the FILE. The old line printed only the parser's own count,
  // so a run against the wrong file looked exactly like a run against
  // the right one.
  log.log(
    `✓ ${file}: ${rows.length} campsites parsed` +
      (rows.skipped.length ? ` (${rows.skipped.length} skipped)` : '') +
      `, paginator floor >${perPage}, every subject the tests stand on is present`,
  );
  return 0;
}

// Prove each assertion can fail.
//
// 🔴 Майже нічого тут не читає справжню фікстуру — ВИНЯТОК один, і він
// названий: пара `run(SEED, …)` нижче. Раніше цей коментар казав
// «Nothing here reads the real fixture», і це було неправдою, через яку
// випадок про розмір сторінки роками проходив, не випробувавши свою
// гілку. Якщо додаєш сюди ще одне читання SEED — або дай йому контроль,
// або перепиши цей рядок.
function selfTest() {
  let rc = 0;
  const bad = (m) => {
    console.error(`✗ REHEARSAL FAILED: ${m}`);
    rc = 1;
  };
  // 🔴 CAMP-286. Every assertion registers HERE, as it runs. A case that
  // stopped executing prints exactly what a case that passed prints, so
  // the count of cases that ACTUALLY RAN is the only thing that separates
  // them. The `breaks` loop contributes two per entry for that reason: a
  // shortened table is a case that stopped running.
  const cases = [];
  const failIf = (cond, m) => {
    cases.push(m);
    if (cond) bad(m);
  };
  const quiet = { log: () => {}, error: () => {} };
  const PER_PAGE = 24;

  // 🔴 Context defaults to a real value now, not '{}': the new subject
  // below requires most rows to carry one, and a rehearsal whose own
  // baseline failed it would report the wrong thing everywhere.
  const spot = (slug, country, region, toiletsValue = 'unknown', context = '{"at":{"lat":1,"lon":1}}') => ({
    slug,
    country,
    region,
    missing_since: null,
    amenities: `{"toilets": "${toiletsValue}"}`,
    context,
  });

  /**
   * A fixture that satisfies every shape, as the baseline to break.
   *
   * 🔴 Laid out so that ONE break reports ONE problem. The earlier
   * version put the big region, the "yes" row and every gone candidate
   * in Slovenia, so "Slovenia gone" reported three problems at once and
   * the assertion `found.some(matches)` could not tell which rule had
   * actually fired. Each subject now lives in a third country that no
   * country break touches.
   *
   * 🔴 `zzz-doomed` is the row `ci-seed.sql` would mark gone at load,
   * and it is alone in its region ON PURPOSE: that is the shape that
   * used to slip through — a region of one in the file and of zero in
   * the database.
   */
  const whole = () => [
    ...Array.from({ length: PER_PAGE + 1 }, (_x, i) =>
      spot(`pag-${String(i).padStart(2, '0')}`, 'AT', 'Big')),
    // 🔴 Not in `Big`. Parked there, they padded it past the page size
    // and the "exactly a page" break below could not reach the boundary
    // it exists to test.
    spot('yes-at', 'AT', 'Side', 'yes'),
    spot('no-at', 'AT', 'Side', 'no'),
    spot('thin-at', 'AT', 'Lonely'),
    // The one the loader will mark gone: empty context by definition,
    // because that is what the DO block selects on. Its slug is the
    // HIGHEST in the file, which is how the DO block finds it.
    spot('zzz-doomed', 'AT', 'Doomed', 'unknown', '{}'),
    // 🔴 And the one that stays thin AFTER the gone row is taken —
    // `sitemap.spec.ts`'s subject. Two rows, not one, because the
    // loader hides the gone row from `/spots/index`. Its slug sorts
    // below `zzz-doomed` so it cannot steal the gone role.
    //
    // It shares `Side` with the yes/no rows rather than taking a region
    // of its own, so that "no region of one" still has exactly one
    // subject and one break still reports one problem.
    spot('aaa-thin', 'AT', 'Side', 'unknown', '{}'),
    spot('si-a', 'SI', 'Bovec'),
    spot('si-b', 'SI', 'Bovec'),
    spot('hr-a', 'HR', 'Zagreb'),
    spot('hr-b', 'HR', 'Zagreb'),
  ];

  const first = shapeProblems(whole(), PER_PAGE);
  failIf(
    first.length !== 0,
    `a complete fixture was reported broken: ${first.join('; ')}`,
  );

  // 🔴 The load simulation, asserted rather than assumed: `zzz-doomed`
  // is the row the DO block picks, and `Doomed` must therefore not
  // count as the region of exactly one.
  const picked = goneTarget(whole().filter((r) => r.region && r.missing_since === null));
  failIf(
    picked?.slug !== 'zzz-doomed',
    `gone target is ${picked?.slug}, not zzz-doomed`,
  );
  const onlyDoomedIsThin = whole().filter((r) => r.slug !== 'thin-at');
  failIf(
    !shapeProblems(onlyDoomedIsThin, PER_PAGE).some((p) => /exactly 1/.test(p)),
    'a region of one that the loader empties was accepted as the subject',
  );

  // 🔴 CAMP-293. ТРИ РАННІ ВИХОДИ `run()` — ПО ПРИЧИНІ, А НЕ ПО КОДУ.
  //
  // Рецензія заміряла, що всі три переживають мутацію. Перша моя спроба
  // це полагодити перевіряла `run(...) !== 1` — і мутації ПЕРЕЖИЛИ ЇЇ
  // теж, бо `run` віддає 1 із ПʼЯТИ місць: файл без рядків падає
  // далі на `shapeProblems`, і код виходу однаковий.
  //
  // 🔴 І «ЧОТИРЬОХ» тут теж було неправдою — місць пʼять, а
  // непокритим лишився саме пʼятий, головний: вирок про форму.
  // Див. випадок `no-si.sql` нижче.
  //
  // Та сама пастка, яку ця картка й закриває: код «1» не каже, ЧОМУ.
  // Тому перехоплюємо повідомлення й питаємо причину поіменно.
  {
    const tmp = mkdtempSync(join(tmpdir(), 'fixture-shape-'));
    const api = `export const REGION_PER_PAGE = ${PER_PAGE};`;
    // 🔴 Повертаємо І код, І сказане. Лише повідомлення мало: гілку
    // можна лишити балакучою й віддати 0, і сторож пропустить зниклу
    // фікстуру мовчки. Лише код мало теж: `run` віддає 1 із чотирьох
    // місць. Доводить тільки пара.
    const said = (file, src = api) => {
      const lines = [];
      const code = run(
        file,
        { log: () => {}, error: (m) => lines.push(String(m)) },
        src,
      );
      return { code, text: lines.join('\n') };
    };
    const refused = (file, reason, src = api) => {
      const r = said(file, src);
      return r.code === 1 && reason.test(r.text);
    };

    try {

      failIf(
        !refused(join(tmp, 'there-is-no-such-file.sql'), /cannot read/),
        'an unreadable file was not refused BY NAME',
      );

      const empty = join(tmp, 'empty.sql');
      writeFileSync(empty, '-- no INSERT here at all\n');
      failIf(
        !refused(empty, /holds no camping_spots rows/),
        'a file with no rows was not refused BY NAME',
      );

      // Два нерозбірні рядки плюс один справний, щоб спрацював саме поріг
      // `skipped > 1`, а не «жодного рядка».
      const broken = join(tmp, 'two-broken.sql');
      writeFileSync(
        broken,
        "INSERT INTO camping_spots (slug, country, region, missing_since, amenities, context) " +
          "VALUES ('ok', 'SI', 'Bled', NULL, '{}', '{}');\n" +
          'INSERT INTO camping_spots (a, b) VALUES (1);\n'.repeat(2),
      );
      failIf(
        !refused(broken, /could not be parsed/),
        'two unparseable rows were not refused BY NAME',
      );

      // 🔴 CAMP-293, рецензія PR #193. ПʼЯТИЙ ВИХІД `run()` — ГОЛОВНИЙ,
      // І ВІН НЕ МАВ ЖОДНОГО ВИПАДКУ.
      //
      // Заміряно: `if (problems.length > 0)` → `if (false)` ПЕРЕЖИВАЛА всі
      // 42 випадки И справжній прогін. Один рядок вимикав увесь сенс
      // файлу, а сторож друкував ✓ і код 0.
      //
      // Чотири випадки вище міряють РАННІ виходи — вони спрацьовують ДО
      // `shapeProblems`. Жоден не доходив до вироку про форму, тому
      // вирок можна було видалити безкарно.
      //
      // Файл нижче розбирається бездоганно: рядки є, нерозібраних нема,
      // розмір сторінки читається. Єдине, що з ним не так, — форма.
      const asSql = (rows) =>
        rows
          .map(
            (r) =>
              'INSERT INTO camping_spots (slug, country, region, missing_since, amenities, context) ' +
              `VALUES ('${r.slug}', '${r.country}', '${r.region}', NULL, '${r.amenities}', '${r.context}');`,
          )
          .join('\n') + '\n';

      const wholeSql = join(tmp, 'whole.sql');
      writeFileSync(wholeSql, asSql(whole()));

      // Контроль ПЕРШИЙ. Без нього випадок нижче лишався б зеленим і
      // тоді, коли файл не проходить із якоїсь зовсім іншої причини.
      failIf(
        said(wholeSql).code !== 0,
        `the control failed: a complete fixture written to disk did not pass (${said(wholeSql).text || 'no reason given'}), so the shape verdict below proves nothing`,
      );

      const noSi = join(tmp, 'no-si.sql');
      writeFileSync(noSi, asSql(whole().filter((r) => r.country !== 'SI')));
      failIf(
        !refused(noSi, /no SI campsites/),
        'a file that parses cleanly and is broken only in SHAPE was not refused — the verdict branch has no case',
      );

      // 🔴 CAMP-293, рецензія. РОЗМІР СТОРІНКИ ПРОЧИТАНО ≠ ПЕРЕДАНО.
      //
      // `const problems = shapeProblems(rows, perPage)` → `…, 24)`
      // ПЕРЕЖИВАЛА: випадки `regionPerPage(...)` доводять читача, а не
      // передачу. Підніми `REGION_PER_PAGE` до 31 — сторож і далі мірив би
      // 24, мовчки сертифікуючи фікстуру, через яку пагінатор пропускає
      // сам себе.
      //
      // Тут оголошений розмір такий, якого не перевищує жоден регіон, і
      // причина мусить назвати САМЕ ЙОГО — число мало пройти наскрізь.
      failIf(
        !refused(wholeSql, /more than 999/, 'export const REGION_PER_PAGE = 999;'),
        'the page size was read but never passed to the shape check',
      );

    } finally {
      // 🔴 У `finally`: на шляху з винятком попередня редакція
      // лишала каталог у $TMPDIR назавжди.
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  // 🔴 CAMP-293. ПОРІГ КВОРУМУ КОНТЕКСТУ, А НЕ ЛИШЕ НУЛЬ.
  //
  // Правило `withContext * 2 < live.length` існує, щоб фікстура без
  // обчисленого контексту не виглядала як менша вибірка (CAMP-199).
  // Але єдиний break обнуляв контекст УСІМ рядкам, тож поріг був
  // випробуваний лише на нулі — і рецензія заміряла, що `< 1` та
  // `=== 0` переживають усі тести. Тобто правило можна було тихо
  // послабити до «хоч один».
  //
  // Нижче поріг перевіряється з обох боків: рівно половина мусить
  // ПРОЙТИ, на одну менше — впасти.
  const quorumRows = (withCtx, total) =>
    Array.from({ length: total }, (_, i) => ({
      slug: `q-${String(i).padStart(2, '0')}`,
      country: 'SI',
      region: 'Bled',
      missing_since: null,
      amenities: '{"toilets": "unknown"}',
      context: i < withCtx ? '{"at":{"lat":1,"lon":1}}' : '{}',
    }));
  const quorumFired = (withCtx, total) =>
    shapeProblems(quorumRows(withCtx, total), PER_PAGE).some((p) =>
      /carry a computed context/.test(p),
    );

  failIf(
    !quorumFired(4, 10),
    '4 of 10 with context did not trip the quorum rule',
  );
  failIf(
    quorumFired(5, 10),
    '5 of 10 with context tripped the quorum rule, but half is enough',
  );
  failIf(
    quorumFired(10, 10),
    'every row having context tripped the quorum rule',
  );

  // 🔴 CAMP-293, рецензія PR #193. РІВНІСТЬ НЕ ДОСЯГАЛАСЬ ЖОДНИМ
  // ВИПАДКОМ, ТОЖ `<` НЕ ВІДРІЗНЯВСЯ ВІД `<=`.
  //
  // Випадок `quorumFired(5, 10)` вище МІРЯЄ НЕ ТЕ, ЩО КАЖЕ: gone-блок
  // зʼїдає один рядок, тож живих там 9, а не 10 (заміряно:
  // `live.length=9, withContext*2=10`). Рівності немає в жодному з
  // трьох, і мутація `<` → `<=` переживала все.
  //
  // `(5, 11)` дає рівно десять живих і рівно пʼять із контекстом:
  // половина мусить ПРОЙТИ. `(4, 11)` — на одну менше — мусить впасти.
  failIf(
    quorumFired(5, 11),
    'exactly half the live rows carrying context tripped the quorum rule, but half is the floor, not a failure',
  );
  failIf(
    !quorumFired(4, 11),
    'one row below half did not trip the quorum rule',
  );

  // 🔴 CAMP-293. ЧОТИРИ КЛАУЗУЛИ `thinTarget`, КОЖНА ОКРЕМО.
  //
  // Рецензія заміряла, що фікстура `spot()` ніколи не кладе
  // `description`, `stars` чи зручність `yes/no` у рядок із порожнім
  // контекстом. Тому три мутації переживали всі тести:
  //
  //     видалити `!hasKnownAmenity(r)`      → вижила
  //     `!r.description && !r.stars` → true → вижила
  //     `hasKnownAmenity` → лише 'yes'      → вижила
  //
  // Тобто рядок із зручностями став би «тонким», і ніхто б не помітив.
  // Нижче кожна клаузула дискваліфікує кандидата САМА, без допомоги
  // інших: базовий випадок доводить, що кандидат узагалі підходить.
  const thinBase = (over = {}) => ({
    slug: 'aaa-candidate',
    country: 'SI',
    region: 'Bled',
    missing_since: null,
    amenities: '{"toilets": "unknown"}',
    context: '{}',
    ...over,
  });
  const thinGone = {
    slug: 'zzz-gone',
    country: 'SI',
    region: 'Bled',
    missing_since: null,
    amenities: '{"toilets": "unknown"}',
    context: '{}',
  };

  failIf(
    thinTarget([thinBase(), thinGone])?.slug !== 'aaa-candidate',
    'a row that satisfies every clause was not picked as thin',
  );

  for (const [label, over] of [
    ['a description', { description: 'the river runs past' }],
    ['stars', { stars: 3 }],
    ['an explicit "yes"', { amenities: '{"toilets": "yes"}' }],
    ['an explicit "no"', { amenities: '{"showers": "no"}' }],
    // 🔴 CAMP-293, рецензія PR #193. `hasKnownAmenity` бере `.some`, і
    // мутація на `.every` переживала все, бо жоден рядок самотесту не
    // мав відповіданої зручності ПОРУЧ із невідповіданою. SQL каже
    // `jsonb_path_exists '$.* ? (@ == "yes" || @ == "no")'` — це `some`.
    // Заміряно рецензією: на справжній фікстурі `.every` розходиться з
    // SQL на 34 рядках із 72.
    ['one answered amenity among unanswered', { amenities: '{"toilets": "unknown", "showers": "yes"}' }],
    ['computed context', { context: '{"at":{"lat":1,"lon":1}}' }],
  ]) {
    failIf(
      thinTarget([thinBase(over), thinGone])?.slug === 'aaa-candidate',
      `a row with ${label} was picked as thin`,
    );
  }

  // 🔴 CAMP-293, рецензія PR #193. ТРИ ДЗЕРКАЛА SQL БЕЗ ЖОДНОГО
  // ВИПАДКУ. Усі три мутації переживали весь прогін, і кожна тихо
  // розсинхронізувала б цей файл із `ci-seed.sql:146`.
  failIf(
    goneTarget([
      thinBase(),
      { ...thinGone, slug: 'zzz-answered', amenities: '{"toilets": "yes"}' },
    ])?.slug !== 'aaa-candidate',
    'a row with an explicit toilets answer was picked for the gone block — the DO block selects on unanswered',
  );
  failIf(
    goneTarget([
      { ...thinGone, slug: 'zzz-no-toilets-key', amenities: '{"showers": "no"}' },
    ])?.slug !== 'zzz-no-toilets-key',
    'a row whose amenities never mention toilets was not read as unanswered',
  );
  failIf(
    thinTarget([thinBase({ amenities: 'not json at all' }), thinGone])?.slug !==
      'aaa-candidate',
    'a row with unreadable amenities was not read as having none answered',
  );

  const breaks = [
    ['Slovenia gone', (r) => r.filter((x) => x.country !== 'SI'), /no SI campsites/],
    // 🔴 Croatia, which the earlier rehearsal never broke: setting the
    // country list to ['SI'] alone left all eight breaks green, so the
    // HR half was shipped unproven.
    ['Croatia gone', (r) => r.filter((x) => x.country !== 'HR'), /no HR campsites/],
    // 🔴 Present but DEAD is the same as absent, and only the live
    // filter can tell. Without it a fixture whose Slovenia is entirely
    // marked `missing_since` passes the country check while every
    // /camping/si/ page answers 410.
    [
      'Slovenia present but all marked gone',
      (r) => r.map((x) => (x.country === 'SI' ? { ...x, missing_since: '2026-01-01' } : x)),
      /no SI campsites/,
    ],
    // Same idea on the other field: a row with no region is not a page.
    [
      'Croatia present but region-less',
      (r) => r.map((x) => (x.country === 'HR' ? { ...x, region: null } : x)),
      /no HR campsites/,
    ],
    // 🔴 EXACTLY at the page size, which is the state the old `>= 24`
    // called healthy while hubs.spec.ts skipped itself over it.
    [
      'the biggest region holds exactly a page',
      (r) => r.filter((x) => x.slug !== `pag-${String(PER_PAGE).padStart(2, '0')}`),
      /more than 24/,
    ],
    ['no region of one', (r) => r.filter((x) => x.slug !== 'thin-at'), /exactly 1/],
    ['no explicit "no"', (r) => r.filter((x) => x.slug !== 'no-at'), /toilets="no"/],
    ['no explicit "yes"', (r) => r.filter((x) => x.slug !== 'yes-at'), /toilets="yes"/],
    // Every row already has computed context, so the DO block finds no
    // candidate. Nothing else moves: the countries, the big region and
    // both toilets answers are untouched.
    //
    // 🔴 TWO PROBLEMS HERE, AND THAT IS THE TRUTH, NOT A LEAKY
    // MUTATION. Every thin row is gone-eligible by construction — thin
    // requires no yes/no amenity, which forces `toilets = "unknown"`,
    // which is the gone block's own predicate. So a fixture with no
    // gone candidate cannot have a thin one either, and no edit to this
    // line can separate them. The rehearsal says so rather than
    // pretending one problem.
    [
      'nothing eligible for the gone block',
      (r) => r.map((x) => ({ ...x, context: '{"at":{}}' })),
      /marked 0/,
      2,
    ],
    // 🔴 And the other direction, which DOES isolate: leave the gone
    // candidate alone and fill only the thin row's context. The gone
    // block still has `zzz-doomed`, every country and amenity is
    // untouched, and the only thing missing is `sitemap.spec.ts`'s
    // subject — the exact state `ci-seed.sql` was in when the e2e job
    // reported "the rule has no subject".
    [
      'the gone row is the only empty context left',
      (r) => r.map((x) => (x.slug === 'aaa-thin' ? { ...x, context: '{"at":{}}' } : x)),
      /carries nothing but a name/,
    ],
    // 🔴 CAMP-199, and it isolates: the doomed row keeps its empty
    // context so the gone block still has its one candidate, while
    // everything else loses the surroundings. Only the context subject
    // may fire.
    [
      'the fixture lost its computed surroundings',
      (r) => r.map((x) => (x.slug === 'zzz-doomed' ? x : { ...x, context: '{}' })),
      /computed context/,
    ],
  ];

  for (const [name, breakIt, expected, alsoExpect = 1] of breaks) {
    const found = shapeProblems(breakIt(whole()), PER_PAGE);
    failIf(
      !found.some((p) => expected.test(p)),
      `"${name}" was not reported (got: ${found.join('; ') || 'nothing'})`,
    );
    // 🔴 One break, one problem. A break that knocks over three subjects
    // proves only that SOMETHING is checked.
    //
    // The count is a FOURTH element on the break, never a range and
    // never "at least": a case may say 2 only where the two subjects
    // cannot be separated by any edit, and it has to say which number
    // it means. Loosening this to `>= 1` would make every leak invisible
    // again, which is the whole reason the check is here.
    failIf(
      found.length !== alsoExpect,
      `"${name}" reported ${found.length} problems, not ${alsoExpect}: ${found.join('; ')}`,
    );
  }

  // The page size is READ, not retyped: a guard that carries its own
  // copy of 24 drifts away from the paginator in silence.
  failIf(
    regionPerPage('export const REGION_PER_PAGE = 31;') !== 31,
    'REGION_PER_PAGE was not read from source',
  );
  failIf(
    regionPerPage('const SOMETHING_ELSE = 24;') !== null,
    'a missing REGION_PER_PAGE did not read as missing',
  );
  // 🔴 CAMP-286, знайдено рецензією PR #188. ЦЕЙ ВИПАДОК ПРОХОДИВ ІЗ
  // НЕПРАВИЛЬНОЇ ПРИЧИНИ, і сам по собі нічого не доводив.
  //
  // `run()` віддає 1 із ПʼЯТИ місць: файл не читається, жодного рядка,
  // забагато нерозібраних, `perPage === null`, і вирок про форму.
  // Твердження нижче бачить лише число 1 — тож зникла б фікстура, і воно
  // так само «проходило» б, уже не випробувавши гілку, заради якої існує.
  //
  // Контроль ізолює гілку: ТОЙ САМИЙ файл із оголошеним розміром
  // сторінки мусить дати 0. Якщо фікстура зламана з будь-якої іншої
  // причини, падає контроль, а не мовчки «проходить» твердження.
  failIf(
    run(SEED, quiet, 'nothing here declares a page size') !== 1,
    'an unreadable page size was treated as "no pagination rule"',
  );
  failIf(
    run(SEED, quiet, `export const REGION_PER_PAGE = ${PER_PAGE};`) !== 0,
    'the control failed: the fixture is unusable for a reason other than the page size, so the case above proved nothing',
  );

  // A parser that has fallen behind the fixture must say so, not ✓ over
  // what it still manages to read.
  const twoBroken = 'INSERT INTO camping_spots (a, b) VALUES (1);\n'.repeat(2);
  const parsed = readSpots(twoBroken);
  failIf(
    parsed.skipped.length !== 2,
    `skipped ${parsed.skipped.length} rows, expected 2`,
  );

  // 🔴 A literal, never `cases.length` — deriving the expectation from the
  // thing it checks makes the comparison true by construction.
  const EXPECTED_CASES = 51;
  if (cases.length !== EXPECTED_CASES) {
    console.error(
      `✗ REHEARSAL FAILED: ${cases.length} cases ran, expected ${EXPECTED_CASES}`,
    );
    rc = 1;
  }

  // 🔴 The line names this file, so a CI step grepping for it cannot be
  // satisfied by somebody else's self-test.
  console.log(
    rc === 0
      ? `✓ check-fixture-shape self-test: ${cases.length} cases over the fixture's shape`
      : `✗ check-fixture-shape self-test: ${cases.length} cases, at least one failed`,
  );

  if (rc === 0) {
    console.log(
      // Counted, not retyped — the same rule as the page size below.
      // The old line said "eight" while the list held ten.
      `✓ rehearsal: a complete fixture passes; each of the ${breaks.length} subjects\n` +
        '  is reported BY ITSELF when it goes missing — including Croatia,\n' +
        '  which nothing broke before — a region holding exactly one page\n' +
        '  fails rather than passing, the row the loader marks gone is not\n' +
        '  counted as the region of one, and the page size is read from the\n' +
        '  paginator instead of retyped here.',
    );
  }
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (!invokedDirectly) {
  // imported for its functions
} else {
  // 🔴 CAMP-286. `includes('--self-test')` meant a typo — `--selftest` —
  // fell through to the real check over the committed fixture, which
  // passes. Green step, rehearsal never run. One positional argument is
  // allowed (the .sql file); an unknown flag is an error, not a shrug.
  const action = chooseAction(
    process.argv.slice(2),
    ['--self-test'],
    'check-fixture-shape.mjs',
    { positional: 1 },
  );
  if (action.has('--self-test')) process.exit(selfTest());
  // 🔴 The old form was `process.argv.find(a => a.endsWith('.sql'))`
  // with a fallback to the committed fixture. Hand it a path without a
  // `.sql` suffix and it checked the fixture instead and printed ✓ —
  // and `regenerate.sh` writes its candidate as
  // `.ci-seed.candidate.XXXXXX`, with no suffix, which is precisely the
  // one file anyone would want to hand it.
  //
  // So: any argument that is not a flag IS the file, suffix or no
  // suffix, and an unreadable one is an error rather than a fallback.
  // `chooseAction({ positional: 1 })` has already refused a second file.
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  process.exit(run(args[0] ?? SEED));
}
