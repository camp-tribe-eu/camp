#!/usr/bin/env node
// CAMP-73: the list of URLs that must now answer 410, frozen at build time.
//
// 🔴 Frozen, not queried. The middleware that serves the 410 runs on
// every request at the edge; calling our API from there would put the
// backend in the request path of the whole site, which is exactly what
// CAMP-31 and CAMP-39 went out of their way to avoid. The list changes
// once a week, with the import, and the site is rebuilt then anyway.
//
// ⚠️ Ceiling. This ends up bundled into the middleware, and edge
// runtimes cap that bundle (1 MB on Cloudflare Workers). A path is
// roughly 50 bytes, so tens of thousands fit — but if we ever get there,
// the list belongs in a KV store rather than in the bundle. The script
// refuses to write a file large enough to be a problem rather than
// letting a deploy fail for a reason nobody will connect to this.

import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { enforceEdgeBudget } from './edge-budget.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'src', 'generated');
const MAX_BYTES = 256 * 1024;

/**
 * Чи можна записувати цей список — і що сказати про нього в лог.
 *
 * 🔴 CAMP-301. СТОРОЖ ВИЩЕ ЛОВИТЬ ЛИШЕ `!res.ok`, а порожній масив зі
 * статусом 200 проходив і записувався. Сьогодні це правильно: у базі
 * 5 945 зниклих рядків, найдавнішому 18 днів із 28, жоден ще не дозрів.
 * Приблизно 22.10.2026 перший дозріє — і з того дня рівно та сама тиша
 * означатиме, що впав імпорт, зламався запит або хтось зсунув інтервал.
 * Без жодного симптому, поки не прийде звіт про обхід.
 *
 * 🔴 Сторож НЕ «список не порожній», бо сьогодні він порожній законно.
 * Порожнеча приймається, тільки якщо названа причина її підтверджує:
 * жоден рядок іще не старший за інтервал.
 *
 * 🔴 І причина рахується ІНШИМ запитом (`GONE_PENDING_SQL` — просто до
 * таблиці, без LATERAL і без віднімань), а не тим самим під іншою
 * назвою. Інакше два числа збігалися б завжди й не могли б розійтись:
 * доказ підтверджував би сам себе.
 *
 * Інтервал приїжджає з API. Своєї копії числа цей файл не має й не
 * сміє мати — дві копії погоджуються рівно доти, доки хтось не змінить
 * одну.
 */
export function verdict({ paths, pending }) {
  const { intervalDays, mature, pending: waiting, oldestDays } = pending;
  const line =
    `gone list: ${paths.length} path(s) 410; ` +
    `${waiting} waiting, oldest ${oldestDays ?? '—'} of ${intervalDays} days; ` +
    `${mature} matured`;

  // Список — підмножина дозрілих: він бере ті самі рядки й ще віднімає.
  // Довший за `mature` він бути не може, і якщо став — два запити
  // розійшлись, і це треба побачити зараз, а не через місяці.
  if (paths.length > mature) {
    return {
      ok: false,
      line,
      reason:
        `список 410 довший за кількість дозрілих рядків: ${paths.length} > ${mature}. ` +
        'Список це підмножина дозрілих, тож ці два числа розійшлись — ' +
        'або інтервал у GONE_LIST_SQL уже не той, що в GONE_PENDING_SQL.',
    };
  }

  if (paths.length === 0 && mature > 0) {
    return {
      ok: false,
      line,
      reason:
        `список 410 порожній, хоча ${mature} рядків уже дозріли ` +
        `(старші за ${intervalDays} днів). Записати порожній файл означає ` +
        'повернути кожній зниклій адресі 404 замість 410 — регресія, якої ' +
        'ніхто не помітить до звіту про обхід. Причини: впав імпорт, ' +
        'зламався запит, або хтось зсунув інтервал.',
    };
  }

  return { ok: true, line };
}

const apiGet = async (route) => {
  const res = await fetch(`${API}${route}`).catch((e) => {
    throw new Error(`Could not reach the API at ${API}: ${e.message}`);
  });
  if (!res.ok) {
    // 🔴 Fails the build. Writing an empty list here would silently turn
    // every gone campsite back into a 404 — a regression with no symptom
    // anyone would notice until a crawl report months later.
    throw new Error(`GET ${API}${route} returned ${res.status}`);
  }
  return res.json();
};

/**
 * 🔴 Параметри існують заради репетиції, і це єдина причина.
 *
 * Без них перевіреним був лише `verdict`, а картка просить інше: щоб
 * підміна відповіді на `[]` за наявності дозрілого рядка ВАЛИЛА ЗБІРКУ.
 * Між вироком і збіркою стоїть цей код, і мутація «порахувати вирок і
 * піти далі» виживала б: жоден випадок сюди не доходив.
 */
export async function main({ get = apiGet, outDir = out } = {}) {
  const gone = await get('/spots/gone');
  const pending = await get('/spots/gone/pending');
  const paths = gone.map((g) => g.path);

  const say = verdict({ paths, pending });
  if (!say.ok) {
    throw new Error(`${say.line}\n\n  🔴 ${say.reason}`);
  }

  const body = JSON.stringify(paths, null, 2) + '\n';

  // 🔴 Two files, one fetch, so they cannot disagree.
  //
  // The /gone page first got its own copy by calling the API itself, and
  // Next served that call from its fetch cache — the middleware answered
  // 410 for a campsite the page could not name, because the two had asked
  // the same question at different times. The page now reads what this
  // script wrote, in the same run that produced the middleware's list.

  enforceEdgeBudget('gone list', body, MAX_BYTES);

  mkdirSync(outDir, { recursive: true });
  // Only the paths for the middleware: it is bundled for the edge and has
  // no use for names or distances.
  writeFileSync(path.join(outDir, 'gone-paths.json'), body);
  writeFileSync(path.join(outDir, 'gone.json'), JSON.stringify(gone, null, 2) + '\n');
  console.log(say.line);
}

function pureCases() {
  let rc = 0;
  const cases = [];
  const check = (cond, m) => {
    cases.push(m);
    if (!cond) {
      console.error(`✗ REHEARSAL FAILED: ${m}`);
      rc = 1;
    }
  };
  const at = (mature, waiting, oldestDays, intervalDays = 28) => ({
    intervalDays,
    mature,
    pending: waiting,
    oldestDays,
  });

  // Сьогоднішній стан на проді: порожньо, бо ще рано.
  check(
    verdict({ paths: [], pending: at(0, 5945, 18) }).ok === true,
    'порожній список при жодному дозрілому — це законно, а не збій',
  );
  // Те саме порожньо, але причина його вже не пояснює.
  const broken = verdict({ paths: [], pending: at(1, 5944, 28) });
  check(
    broken.ok === false,
    '🔴 порожній список, коли рядок УЖЕ дозрів — це збій',
  );
  check(
    broken.reason?.includes('1') && broken.reason?.includes('28'),
    'причина називає і скільки дозріло, і сам інтервал',
  );
  check(
    verdict({ paths: ['/a', '/b'], pending: at(5, 100, 40) }).ok === true,
    'непорожній список у межах дозрілих — норма',
  );
  // 🔴 Окремий випадок, бо він ловить інше: не тишу, а розходження
  // двох запитів. Без нього умову `paths.length > mature` можна було б
  // прибрати, і зсунутий інтервал у одному з них лишився б непоміченим.
  const wider = verdict({ paths: ['/a', '/b', '/c'], pending: at(2, 10, 40) });
  check(
    wider.ok === false,
    '🔴 список ДОВШИЙ за кількість дозрілих — два запити розійшлись',
  );
  check(
    wider.reason?.includes('3 > 2'),
    'причина називає обидва числа, а не лише констатує розходження',
  );
  // 🔴 Інтервал мусить ПРИЇХАТИ, а не лежати тут. Якби в цьому файлі
  // стояла власна копія 28, цей випадок її б і показав.
  const other = verdict({ paths: [], pending: at(3, 0, 20, 14) });
  check(
    other.reason?.includes('14') && !other.reason?.includes('28'),
    '🔴 інтервал береться з відповіді API, а не з копії в цьому файлі',
  );
  // Рядок у лог мусить називати ОБИДВА числа — зараз він казав лише
  // `gone list: 0 path(s)`, і це однаково виглядало для «ще рано» і
  // для «все зламалось».
  const line = verdict({ paths: [], pending: at(0, 5945, 18) }).line;
  check(line.includes('0 path(s)'), 'рядок каже, скільки адрес у списку');
  check(line.includes('5945 waiting'), 'рядок каже, скільки рядків чекають');
  check(line.includes('oldest 18 of 28 days'), 'рядок каже вік найдавнішого і інтервал');
  check(line.includes('0 matured'), 'рядок каже, скільки вже дозріли');
  // 🔴 І сам РЯДОК мусить нести інтервал із відповіді, а не свою копію.
  // Без цього випадку `of ${intervalDays} days` можна було переписати на
  // `of 28 days` і нічого не почервоніло б: усі інші випадки саме 28 і
  // використовують. Матриця показала цю мутацію вижилою.
  check(
    verdict({ paths: [], pending: at(0, 5, 2, 14) }).line.includes('of 14 days'),
    '🔴 рядок несе інтервал із відповіді API, а не зашиту копію',
  );
  // Порожня база: нема нічого зниклого взагалі.
  check(
    verdict({ paths: [], pending: at(0, 0, null) }).ok === true &&
      verdict({ paths: [], pending: at(0, 0, null) }).line.includes('oldest — of'),
    'порожня база не падає й не друкує null',
  );

  return { rc, cases };
}

/**
 * Те саме, але через `main()` — тобто через ту саму послідовність
 * викликів, якою йде справжня збірка.
 */
async function selfTestBuild(check) {
  const rows = [{ path: '/fr/paca/le-camping' }];
  const run = async (gone, pending) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gen-gone-rehearsal-'));
    const get = async (route) => (route.endsWith('/pending') ? pending : gone);
    let blew = false;
    try {
      await main({ get, outDir: dir });
    } catch {
      blew = true;
    }
    const written = readdirSync(dir).sort();
    rmSync(dir, { recursive: true, force: true });
    return { blew, written };
  };

  // Сьогоднішній прод: порожньо, бо ще рано.
  const early = await run([], { intervalDays: 28, mature: 0, pending: 5945, oldestDays: 18 });
  check(early.blew === false, 'порожній список без дозрілих рядків збірку НЕ валить');
  check(
    early.written.join(',') === 'gone-paths.json,gone.json',
    'і обидва файли записані — список порожній, але він є',
  );

  // Після 22.10: те саме порожньо, але причина його вже не пояснює.
  const late = await run([], { intervalDays: 28, mature: 1, pending: 5944, oldestDays: 28 });
  check(late.blew === true, '🔴 порожній список при дозрілому рядку ВАЛИТЬ збірку');
  check(
    late.written.length === 0,
    '🔴 і НЕ записує файлу — інакше кожна зникла адреса тихо вертається в 404',
  );

  // Звичайний робочий день.
  const ok = await run(rows, { intervalDays: 28, mature: 7, pending: 20, oldestDays: 40 });
  check(ok.blew === false, 'непорожній список у межах дозрілих пишеться');
  check(
    ok.written.join(',') === 'gone-paths.json,gone.json',
    'і теж обома файлами, щоб середина не могла розійтись',
  );
}

async function selfTest() {
  const { rc: pureRc, cases } = pureCases();
  let rc = pureRc;
  const check = (cond, m) => {
    cases.push(m);
    if (!cond) {
      console.error(`✗ REHEARSAL FAILED: ${m}`);
      rc = 1;
    }
  };
  await selfTestBuild(check);

  // 🔴 CAMP-286: лічені, бо випадок, який перестав виконуватись, друкує
  // рівно те саме, що й той, який пройшов — нічого.
  const EXPECTED_CASES = 19;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ ${cases.length} cases ran, expected ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) {
    console.log(`✓ gen-gone self-test: ${cases.length} cases over the verdict`);
  }
  return rc;
}

// 🔴 Робота за точкою входу, а не на імпорті: цей файл тягне мережу, і
// до CAMP-301 він робив це просто тому, що його прочитали.
// `import.meta.url` стоїть у самому порівнянні, бо
// check-script-entrypoints впізнає сторожа, ЧИТАЮЧИ його.
const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) {
    process.exit(await selfTest());
  }
  await main();
}
