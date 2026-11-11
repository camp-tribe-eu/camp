#!/usr/bin/env node
// CAMP-463: на публічних сторінках немає нашої кухні, переговорної
// позиції й машинного формату.
//
//   node scripts/ci/check-no-internal-disclosure.mjs               # по зібраних сторінках
//   node scripts/ci/check-no-internal-disclosure.mjs --base URL    # по живому сайту
//   … --base URL --path /a --path /b                               # свій перелік замість представницького
//   node scripts/ci/check-no-internal-disclosure.mjs --self-test   # без збірки й без мережі
//
// 🔴 ЩО ЦЕ ЗА ЗАПОБІЖНИК. Власник: «Проєкт має бути написаний людиною для
// людей». Три класи того, чого читач не мусить бачити:
//
//   A. Переговорна позиція й плани — «routing engine, which is not
//      running», «Camper rental commission is how this site is meant to
//      pay for itself», «partners we have not integrated yet».
//   B. Машинний формат, показаний людині — `2026-11-03T00:00:00.000Z`,
//      `motorhome=designated`, `Mo 15:30-19:45; Tu-Sa 08:30-13:00`,
//      `region-facts@2`, обірваний роздільник `fleet: 3 ·`.
//   C. Довгі сирі URL джерел там, де читачеві потрібна назва.
//
// Поруч стоїть `check-no-internal-kitchen.mjs` (перший захід CAMP-463).
// Той ловить сполуки про СТАН НАШИХ СПРАВ; цей — клас ширший: ще й
// формат. Вони не замінюють один одного.
//
// 🔴 ПЕРЕЛІК ЗАБОРОНЕНОГО ЖИВЕ В ОДНОМУ МІСЦІ — `disclosure-rules.mjs`
// поруч, з коментарем «чому заборонено» біля кожного рядка. Окремий файл,
// бо той самий читач видимого тексту питає юніт-тест про щойно
// відрендерений компонент (див. шапку того файла); цей скрипт лише ходить
// по сторінках і рахує.
//
// 🔴 МІРЯЄ ВИВІД, А НЕ КОД. Греп по `src/` червоніє на коментарях, що
// пояснюють, чому фразу прибрано, і сліпий до тексту, який приїздить із
// бази й CMS. Тут читається те, що віддано читачеві: зібрана сторінка
// (`apps/web/.next/server/app/**/*.html`) або відповідь живого сайту.
// Читається ВИДИМИЙ ТЕКСТ: `datetime="2026-11-03T00:00:00.000Z"` в
// атрибуті `<time>` — законне місце для машинної дати, і сторож його не
// бачить; ті самі символи в тілі абзацу — бачить.
//
// 🔴 ЗНАМЕННИК ДРУКУЄТЬСЯ ЗАВЖДИ — і коли чисто, і коли ні, і коли
// сторінок нуль: «нічого не знайдено» над нулем сторінок не варте нічого.
//   • знайдено збіг            → вихід 1
//   • нуль сторінок / жодна не відкрилась / частину не вдалося
//     прочитати                → вихід 2 (це не «чисто», це «не знаю»)
//   • усе прочитано, збігів нуль → вихід 0
//
// 🔴 ФОРМАТ, А НЕ КОНКРЕТНЕ ЗНАЧЕННЯ. Шаблон на ISO-дату — це
// `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}`, а не «2026-11-03»: той позеленів би
// завтра, коли дата зміниться. Шаблон на апостроф ловить ОБИДВІ форми,
// `'` і `’`: сторінка друкує `&rsquo;`, а вишукувати `'` — це шукати
// там, де фрази нема.
//
// 🔴 ЖИВИЙ САЙТ ЗАКРИТО ПАРОЛЕМ; ПАРОЛЯ В КОДІ НЕМАЄ. Логін і пароль
// беруться зі змінних середовища CAMP_SITE_USER і CAMP_SITE_PASSWORD.
// Репозиторій публічний, і ключі вже одного разу текли.

import { readFileSync, realpathSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chooseAction, flagValue, flagValues } from '../lib/entrypoint.mjs';
import {
  FORBIDDEN,
  LEGITIMATE,
  REPRESENTATIVE,
  scanPage,
  visibleText,
} from './disclosure-rules.mjs';

const BUILD = 'apps/web/.next/server/app';

// ── джерела сторінок ──────────────────────────────────────────────────

async function* builtPages() {
  for await (const file of glob(`${BUILD}/**/*.html`)) {
    let route = '/' + path.relative(BUILD, file).replace(/\.html$/, '').replace(/\/?index$/, '');
    if (route === '/') route = '/';
    yield { route, read: async () => readFileSync(file, 'utf8') };
  }
}

async function* livePages(base, user, password, routes = REPRESENTATIVE) {
  const auth = user && password ? `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}` : null;
  for (const route of routes) {
    yield {
      route,
      read: async () => {
        const res = await fetch(new URL(route, base), {
          headers: auth ? { authorization: auth } : {},
          redirect: 'follow',
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
    };
  }
}

async function run(source, label) {
  let checked = 0;
  let unreadable = 0;
  const unreadableList = [];
  const findings = [];
  for await (const page of source) {
    let html;
    try {
      html = await page.read();
    } catch (e) {
      // 🔴 ОДНА НЕДОСТУПНА СТОРІНКА КОШТУЄ ОДНОГО ЗАПИСУ, не прогону, — але
      // й не мовчки: вона рахується окремо, і прогін із такою не «чистий».
      unreadable++;
      unreadableList.push(`${page.route} (${e.message})`);
      continue;
    }
    checked++;
    findings.push(...scanPage(page.route, html));
  }

  const denominator = `сторінок перевірено: ${checked}, шаблонів: ${FORBIDDEN.length}` +
    (unreadable ? `, не вдалося прочитати: ${unreadable}` : '') + ` (${label})`;
  console.log(denominator);

  if (checked === 0) {
    console.error(
      `✗ нуль перевірених сторінок (${label}). «Нічого не знайдено» над нулем сторінок не доводить нічого. ` +
        (label.startsWith('збірка') ? 'Спершу `npm run build`.' : 'Перевірте адресу й CAMP_SITE_USER/CAMP_SITE_PASSWORD.'),
    );
    for (const u of unreadableList.slice(0, 10)) console.error(`    ${u}`);
    return 2;
  }
  if (findings.length === 0 && unreadable > 0) {
    console.error(`✗ чисто лише на тому, що вдалося прочитати; не прочитано ${unreadable}:`);
    for (const u of unreadableList.slice(0, 20)) console.error(`    ${u}`);
    return 2;
  }
  if (findings.length === 0) {
    console.log(`✓ внутрішньої кухні, машинного формату й сирих URL у видимому тексті немає`);
    return 0;
  }
  const byRule = new Map();
  for (const f of findings) byRule.set(f.id, (byRule.get(f.id) ?? 0) + 1);
  for (const f of findings.slice(0, 40)) {
    console.error(
      `✗ ${f.route} [${f.id}] «${f.phrase.replace(/\n/g, '⏎')}»${f.count > 1 ? ` ×${f.count}` : ''} — ${f.why}\n    …${f.context}…`,
    );
  }
  if (findings.length > 40) console.error(`  …і ще ${findings.length - 40}`);
  console.error(
    `\n✗ ${findings.length} збіг(ів) на ${checked} сторінках; за правилами: ` +
      [...byRule].map(([k, n]) => `${k}=${n}`).join(', '),
  );
  return 1;
}

// ── самотест ──────────────────────────────────────────────────────────

// правило × 1 (приклад) + законне × 1 + 16 іменованих перевірок нижче.
const EXPECTED_CASES = FORBIDDEN.length + LEGITIMATE.length + 16;

function selfTest() {
  let bad = 0;
  let cases = 0;
  const check = (name, ok, detail = '') => {
    cases++;
    if (!ok) {
      console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
      bad++;
    }
  };
  const page = (inner, head = '') =>
    `<html><head>${head}</head><body><main>${inner}</main></body></html>`;

  // 1. КОЖНЕ правило кусається на власному прикладі — на видимому тексті.
  for (const rule of FORBIDDEN) {
    const route = '/x';
    const got = scanPage(route, page(`<p>${rule.example.replace(/\n/g, '</p><p>')}</p>`)).filter((f) => f.id === rule.id);
    check(`правило ${rule.id} ловить власний приклад`, got.length === 1, `збігів: ${got.length}`);
    // Причина — не окремий випадок у лічильнику: це властивість правила.
    if (rule.why.length < 40) {
      console.error(`  ✗ правило ${rule.id} без причини`);
      bad++;
    }
  }

  // 2. Законне не червоніє.
  for (const ok of LEGITIMATE) {
    const got = scanPage('/x', page(`<p>${ok}</p>`));
    check(`законне речення проходить: ${ok.slice(0, 40)}…`, got.length === 0, got.map((g) => g.id).join(','));
  }

  // 3. ФОРМАТ, а не значення: інша дата, той самий формат — червоніє.
  check(
    'ISO-дата ловиться за форматом, а не за значенням',
    scanPage('/x', page('<p>read 2031-02-17T08:15:00.000Z</p>')).length === 1 &&
      scanPage('/x', page('<p>read 1999-12-31T23:59:59Z</p>')).length === 1,
  );
  // 4. Обидва апострофи.
  check(
    'апостроф ASCII ловиться',
    scanPage('/x', page("<p>depots: 1 (company's own figure)</p>")).length >= 1,
  );
  check(
    'апостроф типографський ловиться',
    scanPage('/x', page('<p>depots: 1 (company’s own figure)</p>')).length >= 1,
  );
  check(
    'апостроф у вигляді сутності &rsquo; ловиться (так його друкує React)',
    scanPage('/x', page('<p>fleet: 3 (company&rsquo;s own figure)</p>')).length >= 1,
  );
  check(
    'апостроф у вигляді &#x27; ловиться',
    scanPage('/x', page('<p>fleet: 3 (company&#x27;s own figure)</p>')).length >= 1,
  );
  // 5. Атрибут — не видимий текст.
  check(
    'ISO-дата в атрибуті datetime не червоніє, а в тілі абзацу — так',
    scanPage('/x', page('<p>read <time dateTime="2026-11-03T00:00:00.000Z">3 November 2026</time></p>')).length === 0 &&
      scanPage('/x', page('<p>read <time dateTime="2026-11-03T00:00:00.000Z">2026-11-03T00:00:00.000Z</time></p>')).length === 1,
  );
  // 5b. Атрибути будь-якого тега — не видимий текст: ні блочного, ні
  // рядкового. Сире посилання на запис джерела (C) живе в `href`, і саме
  // там воно законне.
  check(
    'атрибути блочного тега не читаються',
    scanPage('/x', page('<div title="routing engine 2026-11-03T00:00:00.000Z" data-t="Mo 15:30-19:45">text</div>')).length === 0,
  );
  check(
    'href із сирим URL джерела не червоніє, а той самий URL текстом — так',
    scanPage('/x', page('<p><a href="https://data.datatourisme.fr/23/e437c815-500c-375e-9720-84692c3a214a">record at the source</a></p>')).length === 0 &&
      scanPage('/x', page('<p><a href="/x">https://data.datatourisme.fr/23/e437c815-500c-375e-9720-84692c3a214a</a></p>')).length >= 1,
  );

  // 6. Скрипт і JSON-LD не читаються.
  check(
    'фраза в <script> (JSON-LD) не червоніє',
    scanPage('/x', page('<p>ok</p><script type="application/ld+json">{"text":"routing engine, region-facts@2"}</script>')).length === 0,
  );
  // 7. Спойлер «as recorded» — єдине місце для сирих годин.
  check(
    'сирі години під спойлером as-recorded проходять',
    scanPage('/x', page('<details data-hours="as-recorded"><summary>Opening hours as recorded</summary><span>Mo 15:30-19:45; Tu-Sa 08:30-13:00</span></details>')).length === 0,
  );
  check(
    '…а ті самі години в тілі — червоніють',
    scanPage('/x', page('<span>Mo 15:30-19:45; Tu-Sa 08:30-13:00</span>')).length === 1,
  );
  // 8. Тег на правовій сторінці законний, на звичайній — ні.
  check(
    'тег OSM на /legal/ проходить, поза ним — ні',
    scanPage('/legal/database', page('<p>tag motorhome=yes</p>')).length === 0 &&
      scanPage('/camping/x', page('<p>tag motorhome=yes</p>')).length === 1,
  );
  // 9. maxPerPage: один раз можна, двічі — ні.
  const once = '<aside>Assembled from our database</aside><ul><li>A</li></ul>';
  const twice = once + '<ul><li>Assembled from our database</li></ul>';
  check(
    '«Assembled from our database» — один раз на сторінку законно, двічі ні',
    scanPage('/x', page(once)).length === 0 && scanPage('/x', page(twice)).length === 1,
  );
  // 10. Розрив блоку: роздільник в кінці абзацу — це обірваний роздільник,
  // а в середині рядка — ні.
  check(
    'роздільник між значеннями проходить, у кінці блоку — червоніє',
    scanPage('/x', page('<p>1 depot · fleet of 3</p>')).length === 0 &&
      scanPage('/x', page('<p>depots: 1 · fleet: 3 · </p><p>next</p>')).length >= 1,
  );
  // 11. Знаменник і нуль сторінок — це поведінка run(), не scanPage();
  // її доводить зовнішній прогін (див. опис PR), а тут — що порожній
  // перелік не вважається чистим.
  check('перелік правил не порожній', FORBIDDEN.length >= 15, String(FORBIDDEN.length));
  check('кожне правило має унікальний id', new Set(FORBIDDEN.map((r) => r.id)).size === FORBIDDEN.length);

  if (cases !== EXPECTED_CASES) {
    console.error(`  ✗ випадків ${cases}, очікувалось ${EXPECTED_CASES}`);
    bad++;
  }
  console.log(
    bad === 0
      ? `✓ check-no-internal-disclosure self-test: ${cases} cases over ${FORBIDDEN.length} rules`
      : `✗ ${bad} check(s) failed`,
  );
  return bad > 0 ? 1 : 0;
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
  const argv = process.argv.slice(2);
  const action = chooseAction(argv, ['--self-test', '--base', '--path'], 'check-no-internal-disclosure.mjs', {
    takesValue: ['--base', '--path'],
  });
  if (action.has('--self-test')) {
    process.exit(selfTest());
  }
  const base = flagValue(argv, '--base');
  if (base) {
    const only = flagValues(argv, '--path');
    const code = await run(
      livePages(base, process.env.CAMP_SITE_USER, process.env.CAMP_SITE_PASSWORD, only.length ? only : REPRESENTATIVE),
      `живий сайт ${new URL(base).origin}`,
    );
    process.exit(code);
  }
  process.exit(await run(builtPages(), `збірка ${BUILD}`));
}
