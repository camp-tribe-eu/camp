#!/usr/bin/env node
// CAMP-361: Directus живе ПОРУЧ із нами, а не всередині нас.
//
//   node scripts/ci/check-cms-hardening.mjs
//   node scripts/ci/check-cms-hardening.mjs --self-test
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ ІСНУЄ. 24.09.2026 Directus прибрали з репозиторію
// (CAMP-106), бо він тримав 49 із 77 попереджень безпеки і єдине
// критичне. 20.10.2026 його повернули — бо без адмінки проєктом не
// може керувати ніхто, крім розробника.
//
// Обидва рішення правильні, і разом вони тримаються на ОДНІЙ умові:
// дерево залежностей CMS не змішується з нашим. Заміряно 20.10.2026:
//
//     наше (apps/api + apps/web)   1208 пакетів, 27 попереджень, 0 critical
//     apps/cms окремо              1200 пакетів, 35 попереджень, 1 critical
//
// Варто комусь дописати `apps/cms` назад у `workspaces` — і числа
// зіллються в одне, 62 попередження з критичним усередині, а відповідь
// на питання «скільки вразливостей у застосунку» знову стане неправдою.
// Ця помилка робиться одним словом і не падає ніде.
//
// 🔴 ДРУГА УМОВА: АКТИВАЦІЇ. Ключ Open Innovation Grant має пʼять
// активацій, прив'язаних до БАЗИ + PUBLIC_URL, і знищений без
// деактивації інстанс тримає слот назавжди. Прогін CI, який підніме
// Directus із чистою базою, палить активацію щоразу. Тому крок, що
// запускає Directus у workflow, — провал, а не зручність.
//
// 🔴 ТРЕТЯ: РОЗШИРЕННЯ. Критичне `tar` сидить усередині `@directus/api`
// і не прибирається (npm пропонує «виправлення» відкотом на 10.9.3).
// Єдине, що справді розпаковує чужі архіви, — установка розширень.
// Змінної, яка вимикає маркетплейс цілком, у Directus немає
// (docs/configuration/extensions, перевірено 20.10.2026), тож
// `MARKETPLACE_TRUST` і `EXTENSIONS_LIMIT` мусять стояти ЯВНО, а не
// покладатись на замовчування, яке вендор може змінити мовчки.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

/**
 * 🔴 Що з цього значення вийде У ВЕНДОРА, а не що каже назва змінної.
 *
 * `@directus/api/dist/services/extensions.js`:
 *
 *     const limit = env["EXTENSIONS_LIMIT"] ? Number(env["EXTENSIONS_LIMIT"]) : null;
 *     if (limit !== null) { … throw LimitExceededError … }
 *
 * Отже перевірка виконується лише коли значення ПРАВДИВЕ. `@directus/env`
 * не має `EXTENSIONS_LIMIT` у своїй мапі типів, тож «0» вгадується як
 * JSON і стає ЧИСЛОМ 0 — хибним. `EXTENSIONS_LIMIT=0` означає «ліміту
 * немає», а не «нуль розширень».
 *
 * Я вивів семантику з назви змінної й помилився; знайшла рецензія.
 * Заміряно 20.10.2026 окремим процесом на кожне значення:
 *
 *     «0»        → number 0  → limit=null → ДОЗВОЛЕНО
 *     «-1»       → number -1 → limit=-1   → заблоковано
 *     «string:0» → string 0  → limit=0    → заблоковано
 *
 * 🔴 МЕЖА — НУЛЬ, А НЕ ОДИНИЦЯ. Вендор пише
 * `extensions.length + (version.bundled.length ?? 1) >= limit`, і для
 * НЕбандлового розширення `bundled` це порожній масив, тобто довжина 0,
 * а `?? 1` на нуль не спрацьовує (нуль не nullish). При нулі
 * встановлених виходить `0 + 0 >= limit` — хибне для limit=1. Заміряно:
 *
 *     limit=0 → ЗАБЛОКОВАНО завжди
 *     limit=1 → 🔴 ДОЗВОЛЕНО, якщо розширення не бандл
 *
 * Першу редакцію цього сторожа я написав із межею ≤ 1, тобто сам вклав
 * у нього дірку, яку він мав ловити. Знайшла рецензія.
 *
 * 🔴 Префікс `string:` тут ОБОВʼЯЗКОВИЙ і не є охайністю: без нього
 * значення стає числом 0, тобто хибним, і шлюз мовчки відчиняється.
 * Наступний читач спокусився б «прибрати зайве» — цей сторож не дасть.
 */
export function effectiveLimit(rawValue) {
  // 🔴 Спершу лапки, бо їх знімає dotenv ДО того, як значення побачить
  // @directus/env. Без цього `EXTENSIONS_LIMIT="0"` читалось би як
  // рядок «0» (правдивий, limit=0, безпечний), тоді як насправді воно
  // стає числом 0 — хибним, тобто шлюзом навстіж.
  const unquoted = rawValue.replace(/^(["'])([\s\S]*)\1$/, '$2');

  // Префікс типу. `string:` дає ПРАВДИВИЙ рядок і тому єдиний безпечний;
  // `number:`, `json:`, `boolean:` повертають нас до хибного нуля.
  const typed = unquoted.match(/^([a-z]+):([\s\S]*)$/);
  let guessed;
  if (typed && typed[1] === 'string') {
    guessed = typed[2];
  } else if (typed) {
    // Інший префікс — лишаємо як є; нижче воно дасть NaN і буде
    // відхилене, що й правильно: такі записи шлюз не закривають.
    guessed = unquoted;
  } else {
    guessed = unquoted;
    try {
      guessed = JSON.parse(unquoted);
    } catch {
      /* лишається рядком — так само, як у @directus/env */
    }
  }

  if (!guessed) return null;
  const n = Number(guessed);
  // 🔴 NaN не є лімітом. Вендор порівняв би `0 + 0 >= NaN`, що хибне,
  // тобто розширення пройшло б. Перша редакція віддавала NaN, і він
  // мовчки проходив обидві перевірки: `NaN !== null` істинне, `NaN > 0`
  // хибне. Зелено над відчиненим шлюзом.
  return Number.isNaN(n) ? null : n;
}

/**
 * Форми, що СПРАВДІ піднімають Directus. Згадка слова — не запуск:
 * назва кроку, коментар і рядок у `echo` нічого не виконують.
 */
export const RUNS_DIRECTUS = new RegExp(
  [
    String.raw`\bnpx\s+directus\b`,
    String.raw`\bdirectus\s+(?:start|bootstrap|init|database|schema|users)\b`,
    String.raw`\b(?:dev|bootstrap):cms\b`,
    // --prefix apps/cms, --prefix=apps/cms, --prefix "apps/cms"
    String.raw`--prefix[=\s]+["']?apps/cms`,
    // cd apps/cms && npm start
    String.raw`cd\s+["']?apps/cms`,
    // 🔴 Ідіоматична форма GitHub Actions: крок `run: npm start` із
    // `working-directory: apps/cms`. Жодного слова «directus» у кроці
    // немає, і перша редакція її не бачила.
    String.raw`working-directory:\s*["']?\.?/?apps/cms`,
    // образ у контейнері теж піднімає Directus
    String.raw`\bdirectus/directus\b`,
  ].join('|'),
);

/** Корінь репозиторію відносно цього файла. */
const ROOT = new URL('../..', import.meta.url).pathname;

/**
 * Чистий вирок: самі лише дані, жодного читання диска.
 *
 * 🔴 Параметри названі тим, ЩО вони означають, а не звідки взяті —
 * інакше self-test перевіряв би шляхи, а не правило.
 */
export function verdict({ workspaces, rootLockPaths, cmsEnvExample, workflowsRunningDirectus }) {
  const problems = [];

  // 1. CMS поза workspace — інакше його борг стає нашим.
  if (workspaces.some((w) => w === 'apps/*' || w.includes('cms'))) {
    problems.push(
      `workspaces містить ${JSON.stringify(workspaces)} — apps/cms знову потрапляє ` +
        'у наше дерево; 35 попереджень CMS з критичним усередині зіллються з нашими 27',
    );
  }

  // 2. Кореневий lock не знає про Directus. Це наслідок пункту 1,
  //    але перевіряється окремо: workspaces можна лишити правильним і
  //    все одно притягнути directus прямою залежністю.
  const leaked = rootLockPaths.filter((p) => /(^|\/)(directus|@directus\/|isolated-vm)/.test(p));
  if (leaked.length > 0) {
    problems.push(
      `кореневий package-lock містить ${leaked.length} запис(ів) Directus: ` +
        `${leaked.slice(0, 3).join(', ')}`,
    );
  }

  // 3. Розширення: обидві змінні стоять явно, і ліміт СПРАВДІ блокує.
  if (!/^MARKETPLACE_TRUST=/m.test(cmsEnvExample)) {
    problems.push('apps/cms/.env.example не оголошує MARKETPLACE_TRUST явно');
  }
  const raw = cmsEnvExample.match(/^EXTENSIONS_LIMIT=(.*)$/m);
  if (!raw) {
    problems.push('apps/cms/.env.example не оголошує EXTENSIONS_LIMIT');
  } else {
    const limit = effectiveLimit(raw[1].trim());
    if (limit === null) {
      problems.push(
        `EXTENSIONS_LIMIT=${raw[1].trim()} вимикає перевірку ЦІЛКОМ ` +
          '(@directus/api/dist/services/extensions.js: `env[...] ? Number(...) : null`) — ' +
          'потрібне значення, яке дає ненульовий limit, напр. string:0',
      );
    } else if (limit > 0) {
      problems.push(
        `EXTENSIONS_LIMIT дає limit=${limit} — перше розширення пройде: ` +
          'вендор рахує `встановлено + у наборі >= limit`, а небандлове ' +
          'розширення додає НУЛЬ, тож блокує лише limit ≤ 0',
      );
    }
  }

  // 4. Жоден workflow не ЗАПУСКАЄ Directus: це горить активаціями.
  //
  // 🔴 Питання саме про запуск, а не про згадку. Перша редакція шукала
  // слово «directus» у файлі — і першим, кого вона зупинила, був крок
  // ЦЬОГО Ж сторожа, бо в його назві є це слово. Сторож на текст мусить
  // читати код, а не прозу поруч.
  if (workflowsRunningDirectus.length > 0) {
    problems.push(
      `${workflowsRunningDirectus.length} workflow ЗАПУСКАЄ Directus ` +
        `(${workflowsRunningDirectus.join(', ')}) — прогін із чистою базою палить ` +
        'одну з пʼяти активацій НАЗАВЖДИ',
    );
  }

  return problems;
}

function live() {
  const pkg = JSON.parse(readFileSync(`${ROOT}package.json`, 'utf8'));
  const lock = JSON.parse(readFileSync(`${ROOT}package-lock.json`, 'utf8'));
  // 🔴 `run:` живе не лише у workflows. У цьому репо складені дії лежать
  // в `.github/actions/*/action.yml` і мають власні кроки `run:` — сторож,
  // що читає лише одну теку, має сліпу зону рівно там, де її найважче
  // помітити. Знайшла рецензія.
  const dirs = [`${ROOT}.github/workflows`];
  const actionsRoot = `${ROOT}.github/actions`;
  if (existsSync(actionsRoot)) {
    for (const d of readdirSync(actionsRoot)) dirs.push(`${actionsRoot}/${d}`);
  }
  const workflows = dirs.flatMap((d) =>
    (existsSync(d) ? readdirSync(d) : [])
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => ({ label: `${d.replace(ROOT, '')}/${f}`, path: `${d}/${f}` })),
  );

  const problems = verdict({
    workspaces: pkg.workspaces ?? [],
    rootLockPaths: Object.keys(lock.packages ?? {}),
    cmsEnvExample: readFileSync(`${ROOT}apps/cms/.env.example`, 'utf8'),
    workflowsRunningDirectus: workflows
      .filter((f) => RUNS_DIRECTUS.test(readFileSync(f.path, 'utf8')))
      .map((f) => f.label),
  });

  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    return 1;
  }
  console.log(
    `✓ CMS ізольована: workspaces ${JSON.stringify(pkg.workspaces)}, ` +
      `кореневий lock без Directus, розширення заборонені, ` +
      `${workflows.length} файлів із кроками run: і жоден не піднімає CMS`,
  );
  return 0;
}

function selfTest() {
  const cases = [];
  const is = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    cases.push(ok);
    console[ok ? 'log' : 'error'](
      `${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    отримано: ${JSON.stringify(got)}`}`,
    );
  };

  const GOOD = {
    workspaces: ['apps/api', 'apps/web'],
    rootLockPaths: ['', 'node_modules/react', 'node_modules/pg'],
    cmsEnvExample: 'MARKETPLACE_TRUST=sandbox\nEXTENSIONS_LIMIT=string:0\n',
    workflowsRunningDirectus: [],
  };

  is('здорова конфігурація не дає скарг', verdict(GOOD), []);

  // 🔴 Кожен наступний випадок міняє РІВНО ОДНЕ поле. Мутація, що
  // ламає два, не каже, який із двох сторожів спрацював.
  is(
    'apps/* повертає cms у наше дерево',
    verdict({ ...GOOD, workspaces: ['apps/*'] }).length,
    1,
  );
  is(
    'явна згадка cms у workspaces теж провал',
    verdict({ ...GOOD, workspaces: ['apps/api', 'apps/cms'] }).length,
    1,
  );
  is(
    'directus у кореневому lock',
    verdict({ ...GOOD, rootLockPaths: [...GOOD.rootLockPaths, 'node_modules/directus'] }).length,
    1,
  );
  is(
    '@directus/api у кореневому lock',
    verdict({ ...GOOD, rootLockPaths: ['node_modules/@directus/api'] }).length,
    1,
  );
  is(
    'isolated-vm у кореневому lock',
    verdict({ ...GOOD, rootLockPaths: ['node_modules/isolated-vm'] }).length,
    1,
  );
  // 🔴 Назва, що лише МІСТИТЬ «directus», не є нашим пакетом: сторож
  // не має червоніти на чужий `directus-extension-sdk-mirror` у чиємусь
  // дереві. Межу задає початок сегмента шляху.
  is(
    'пакет зі словом directus усередині назви не рахується',
    verdict({ ...GOOD, rootLockPaths: ['node_modules/not-directus-at-all'] }),
    [],
  );
  is(
    'MARKETPLACE_TRUST відсутній',
    verdict({ ...GOOD, cmsEnvExample: 'EXTENSIONS_LIMIT=string:0\n' }).length,
    1,
  );
  is(
    'EXTENSIONS_LIMIT відсутній',
    verdict({ ...GOOD, cmsEnvExample: 'MARKETPLACE_TRUST=sandbox\n' }).length,
    1,
  );
  // 🔴 Найтихіша з усіх помилок, і я її зробив: значення, яке ВИГЛЯДАЄ
  // як заборона, а вимикає перевірку цілком.
  is(
    'EXTENSIONS_LIMIT=0 — пастка: виглядає як нуль, означає «без ліміту»',
    verdict({ ...GOOD, cmsEnvExample: 'MARKETPLACE_TRUST=sandbox\nEXTENSIONS_LIMIT=0\n' }).length,
    1,
  );
  is(
    'EXTENSIONS_LIMIT=5 пропустить перше розширення',
    verdict({ ...GOOD, cmsEnvExample: 'MARKETPLACE_TRUST=sandbox\nEXTENSIONS_LIMIT=5\n' }).length,
    1,
  );
  is(
    'порожнє значення теж вимикає перевірку',
    verdict({ ...GOOD, cmsEnvExample: 'MARKETPLACE_TRUST=sandbox\nEXTENSIONS_LIMIT=\n' }).length,
    1,
  );
  is('effectiveLimit: «0» вимикає перевірку', effectiveLimit('0'), null);
  is('effectiveLimit: «string:0» дає 0', effectiveLimit('string:0'), 0);
  is('effectiveLimit: «-1» дає -1', effectiveLimit('-1'), -1);
  is('effectiveLimit: порожнє вимикає перевірку', effectiveLimit(''), null);
  // 🔴 Випадки, які я пропускав і які знайшла рецензія.
  is('🔴 string:1 ПРОПУСКАЄ перше розширення — межа нуль, не одиниця',
    verdict({ ...GOOD, cmsEnvExample: 'MARKETPLACE_TRUST=sandbox\nEXTENSIONS_LIMIT=string:1\n' }).length, 1);
  is('лапки знімає dotenv, тож "0" це той самий хибний нуль',
    verdict({ ...GOOD, cmsEnvExample: 'MARKETPLACE_TRUST=sandbox\nEXTENSIONS_LIMIT="0"\n' }).length, 1);
  is("і одинарні теж",
    verdict({ ...GOOD, cmsEnvExample: "MARKETPLACE_TRUST=sandbox\nEXTENSIONS_LIMIT='0'\n" }).length, 1);
  is('effectiveLimit: number:0 не закриває шлюз', effectiveLimit('number:0'), null);
  is('effectiveLimit: json:0 теж', effectiveLimit('json:0'), null);
  is('effectiveLimit: STRING:0 — великі літери не є префіксом', effectiveLimit('STRING:0'), null);
  is('effectiveLimit: «1,2» не є числом', effectiveLimit('1,2'), null);
  is('effectiveLimit: «string:-1» лишається робочим', effectiveLimit('string:-1'), -1);
  // 🔴 ОКРЕМЕ ТВЕРДЖЕННЯ ПРО NaN, бо порівняння вище його не бачить:
  // `is()` звіряє через JSON.stringify, а `JSON.stringify(NaN)` дає
  // рядок «null». Тобто NaN і null у ньому нерозрізненні, і мутація
  // «віддавати NaN замість null» проходила всі випадки зеленою.
  // Знайдено мутацією, не оком.
  for (const bad of ['number:0', 'json:0', 'STRING:0', '1,2', 'хтозна']) {
    is(
      `effectiveLimit('${bad}') не NaN — інакше вендор пропустить`,
      Number.isNaN(effectiveLimit(bad)),
      false,
    );
  }
  is(
    'workflow запускає Directus',
    verdict({ ...GOOD, workflowsRunningDirectus: ['ci.yml'] }).length,
    1,
  );
  // 🔴 Обидва боки правила, бо саме тут я вже помилився.
  is(
    'назва кроку зі словом directus НЕ є запуском',
    RUNS_DIRECTUS.test('      - name: Directus stays out of our dependency tree\n'),
    false,
  );
  is(
    'коментар про directus НЕ є запуском',
    RUNS_DIRECTUS.test('      # 🔴 CAMP-361. Directus повернувся, але поруч\n'),
    false,
  );
  is(
    'а `npx directus start` — таки запуск',
    RUNS_DIRECTUS.test('        run: npx directus start\n'),
    true,
  );
  is(
    'і `npm run dev:cms` теж',
    RUNS_DIRECTUS.test('        run: npm run dev:cms\n'),
    true,
  );
  // Форми, які перша редакція пропускала — усі знайшла рецензія.
  is('--prefix=apps/cms', RUNS_DIRECTUS.test('run: npm --prefix=apps/cms run start'), true);
  is('--prefix "apps/cms"', RUNS_DIRECTUS.test('run: npm --prefix "apps/cms" start'), true);
  is('cd apps/cms && npm start', RUNS_DIRECTUS.test('run: cd apps/cms && npm start'), true);
  is('образ directus/directus', RUNS_DIRECTUS.test('image: directus/directus:12.5.0'), true);
  is('working-directory: apps/cms', RUNS_DIRECTUS.test('    working-directory: apps/cms'), true);
  is('working-directory: ./apps/cms', RUNS_DIRECTUS.test('    working-directory: ./apps/cms'), true);
  is('а working-directory: apps/web — ні', RUNS_DIRECTUS.test('    working-directory: apps/web'), false);
  // Усі правила незалежні: зламавши все, маємо пʼять скарг, а не одну.
  // Саме пʼять, а не чотири: порожній env ламає ДВА правила —
  // MARKETPLACE_TRUST і EXTENSIONS_LIMIT. Назва, що каже «чотири», була
  // б числом із голови, а не з коду.
  is(
    'чотири зламані входи дають пʼять скарг — вони не маскують одна одну',
    verdict({
      workspaces: ['apps/*'],
      rootLockPaths: ['node_modules/directus'],
      cmsEnvExample: '',
      workflowsRunningDirectus: ['ci.yml'],
    }).length,
    5,
  );

  const EXPECTED_CASES = 42;
  let rc = 0;
  if (cases.some((c) => !c)) rc = 1;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-cms-hardening self-test: ${cases.length} випадків`);
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

if (invokedDirectly) {
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-cms-hardening.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  process.exit(live());
}
