#!/usr/bin/env node
// Чи не вимкнув один сторож інших. `watchdog.yml` має два розклади, і
// кожна робота ВІДФІЛЬТРОВУЄ свій тік job-level `if:`.
//
//   node scripts/ci/check-watchdog-gates.mjs             # справжній файл
//   node scripts/ci/check-watchdog-gates.mjs --self-test # мутації на ньому ж
//
// 🔴 ЦІНА ПОМИЛКИ ТУТ — ТИША. Коли до щоденних сторожів (`quiet`,
// `stale-sources`, `dependabot-prs`) додали тригодинний `uptime`, кожній
// з трьох довелось дати `if: github.event.schedule != '23 */3 * * *'`.
// Помилка в тій умові не червонить нічого: робота зі `skipped` виглядає
// в Actions як зелена, і три сторожі тихо перестають бігати. Не гірше за
// відсутність сторожа — гірше, бо тепер усі думають, що він є.
//
// Тому перевіряємо НАСЛІДОК, а не текст умови: для кожного тіка
// (щоденний cron, тригодинний cron, ручний запуск) обчислюємо, які
// роботи побіжать, і порівнюємо з таблицею нижче. Cron, якого в таблиці
// немає, — теж помилка: новий розклад мусить сказати, кого він будить.
//
// Обчислювач `if:` навмисно куций (`==`, `!=`, `&&`, `||`, `!`, дужки,
// рядки, `github.event_name`, `github.event.schedule`). Усе інше він
// КИДАЄ, а не вгадує: функція чи контекст, яких він не знає, дали б
// мовчазне «true» чи «false» — і перевірка сказала б те, чого не бачить.

import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import { chooseAction } from '../lib/entrypoint.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '..', '..', '.github', 'workflows', 'watchdog.yml');

/** Хто мусить побігти на якому тіку. Це ДОГОВІР, а не вигадка обчислювача. */
export const EXPECTED = {
  schedule: {
    '0 8 * * *': ['quiet', 'stale-sources', 'dependabot-prs'],
    '23 */3 * * *': ['uptime'],
  },
  workflow_dispatch: ['quiet', 'stale-sources', 'dependabot-prs', 'uptime'],
};

function tokens(src) {
  const out = [];
  const re = /\s*(?:('(?:[^']|'')*')|(==|!=|&&|\|\||!|\(|\))|([A-Za-z_][\w.]*))/y;
  let at = 0;
  while (at < src.length) {
    re.lastIndex = at;
    const m = re.exec(src);
    if (!m) {
      if (src.slice(at).trim() === '') break;
      throw new Error(`не розумію \`if:\` на «${src.slice(at).trim()}» у «${src}»`);
    }
    at = re.lastIndex;
    if (m[1]) out.push({ t: 'str', v: m[1].slice(1, -1).replace(/''/g, "'") });
    else if (m[2]) out.push({ t: 'op', v: m[2] });
    else out.push({ t: 'id', v: m[3] });
  }
  return out;
}

/** Обчислити `if:` на тіку. `ctx` = { event_name, schedule }. */
export function evaluate(expr, ctx) {
  const src = String(expr).trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1');
  const ts = tokens(src);
  let i = 0;
  const peek = () => ts[i];
  const eat = (v) => (ts[i]?.t === 'op' && ts[i].v === v ? (i++, true) : false);
  const lookup = (name) => {
    if (name === 'github.event_name') return ctx.event_name ?? '';
    if (name === 'github.event.schedule') return ctx.schedule ?? '';
    throw new Error(`невідомий контекст «${name}» в \`if: ${src}\``);
  };
  const truthy = (v) => (typeof v === 'boolean' ? v : v !== '');
  function primary() {
    const t = ts[i++];
    if (!t) throw new Error(`обірваний \`if: ${src}\``);
    if (t.t === 'str') return t.v;
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      return lookup(t.v);
    }
    if (t.v === '(') {
      const v = or();
      if (!eat(')')) throw new Error(`немає « ) » в \`if: ${src}\``);
      return v;
    }
    throw new Error(`несподіваний «${t.v}» в \`if: ${src}\``);
  }
  function not() {
    return eat('!') ? !truthy(not()) : primary();
  }
  function eq() {
    let l = not();
    while (peek()?.t === 'op' && (peek().v === '==' || peek().v === '!=')) {
      const op = ts[i++].v;
      const r = not();
      // GitHub порівнює рядки без урахування регістру.
      const same = String(l).toLowerCase() === String(r).toLowerCase();
      l = op === '==' ? same : !same;
    }
    return l;
  }
  function and() {
    let l = eq();
    while (eat('&&')) {
      const r = eq();
      l = truthy(l) && truthy(r);
    }
    return l;
  }
  function or() {
    let l = and();
    while (eat('||')) {
      const r = and();
      l = truthy(l) || truthy(r);
    }
    return l;
  }
  const v = or();
  if (i !== ts.length) throw new Error(`зайве після виразу в \`if: ${src}\``);
  return truthy(v);
}

const sameSet = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');

/**
 * Що не так: на кожному тіку — які роботи побіжать проти договору.
 * Порожній масив = усе гаразд.
 */
export function problems(text, expected = EXPECTED) {
  const wf = loadYaml(text);
  const jobs = wf?.jobs ?? {};
  const names = Object.keys(jobs);
  const out = [];
  const runs = (ctx) =>
    names.filter((n) => {
      const cond = jobs[n].if;
      return cond === undefined ? true : evaluate(cond, ctx);
    });

  // `on` у YAML 1.1 буває ключем `true`; js-yaml 4+ читає рядком.
  const on = wf.on ?? wf[true] ?? {};
  const crons = (on.schedule ?? []).map((s) => s.cron);

  for (const cron of crons) {
    if (!(cron in expected.schedule)) {
      out.push(`cron «${cron}» немає в договорі: скажіть, які роботи він будить`);
    }
  }
  for (const [cron, want] of Object.entries(expected.schedule)) {
    if (!crons.includes(cron)) {
      out.push(`cron «${cron}» зник із файлу, а роботи ${want.join(', ')} на нього чекають`);
      continue;
    }
    const got = runs({ event_name: 'schedule', schedule: cron });
    if (!sameSet(got, want)) {
      out.push(`тік «${cron}»: побігли б [${got.join(', ')}], мусять [${want.join(', ')}]`);
    }
  }
  const dispatch = runs({ event_name: 'workflow_dispatch', schedule: '' });
  if (!sameSet(dispatch, expected.workflow_dispatch)) {
    out.push(`ручний запуск: побігли б [${dispatch.join(', ')}], мусять [${expected.workflow_dispatch.join(', ')}]`);
  }
  // Договір не може називати роботу, якої нема: тоді порівняння вище
  // було б із привидом.
  for (const n of new Set([...Object.values(expected.schedule).flat(), ...expected.workflow_dispatch])) {
    if (!names.includes(n)) out.push(`договір називає роботу «${n}», якої нема у файлі`);
  }
  return out;
}

function run() {
  const text = readFileSync(FILE, 'utf8');
  const bad = problems(text);
  const wf = loadYaml(text);
  if (bad.length) {
    for (const b of bad) console.error(`✗ ${b}`);
    return 1;
  }
  for (const [cron, want] of Object.entries(EXPECTED.schedule)) {
    console.log(`✓ «${cron}» будить рівно: ${want.join(', ')}`);
  }
  console.log(`✓ ручний запуск будить усі ${Object.keys(wf.jobs).length} роботи`);
  return 0;
}

function selfTest() {
  const real = readFileSync(FILE, 'utf8');
  const cases = [];
  let rc = 0;
  const is = (name, got, want) => {
    cases.push(name);
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
      rc = 1;
    }
  };
  // Мутація мусить справді змінити файл, інакше «червоніє» нічого.
  const mutate = (name, from, to, all = false) => {
    const n = real.split(from).length - 1;
    is(`${name}: мутація застосувалась`, n > 0, true);
    const text = all ? real.split(from).join(to) : real.replace(from, to);
    return problems(text);
  };
  const GATE = "if: github.event.schedule != '23 */3 * * *'";

  is('справжній файл: без зауважень', problems(real), []);

  // Обчислювач окремо: те, на чому тримається все решта.
  const D = { event_name: 'schedule', schedule: '0 8 * * *' };
  const H = { event_name: 'schedule', schedule: '23 */3 * * *' };
  const M = { event_name: 'workflow_dispatch', schedule: '' };
  is('`!=` на щоденному — true', evaluate("github.event.schedule != '23 */3 * * *'", D), true);
  is('`!=` на тригодинному — false', evaluate("github.event.schedule != '23 */3 * * *'", H), false);
  is('`!=` на ручному (порожній schedule) — true', evaluate("github.event.schedule != '23 */3 * * *'", M), true);
  is('uptime-умова на щоденному — false',
    evaluate("github.event_name == 'workflow_dispatch' || github.event.schedule == '23 */3 * * *'", D), false);
  is('uptime-умова на тригодинному — true',
    evaluate("github.event_name == 'workflow_dispatch' || github.event.schedule == '23 */3 * * *'", H), true);
  is('uptime-умова на ручному — true',
    evaluate("github.event_name == 'workflow_dispatch' || github.event.schedule == '23 */3 * * *'", M), true);
  is('`${{ }}` обгортка знімається', evaluate("${{ github.event_name == 'schedule' }}", D), true);
  let threw = false;
  try { evaluate('contains(github.ref, "x")', D); } catch { threw = true; }
  is('невідома функція — виняток, а не мовчазне true', threw, true);
  threw = false;
  try { evaluate('github.actor == 1', D); } catch { threw = true; }
  is('невідомий контекст — виняток', threw, true);

  // Мутації самих сторожів: кожна мусить червонити.
  const alwaysFalse = mutate('умова завжди хибна на quiet', GATE, 'if: false');
  is('завжди хибна умова (усі три сторожі) — червоніє', alwaysFalse.length > 0, true);
  is('…і називає щоденний тік', alwaysFalse.some((p) => p.includes('«0 8 * * *»')), true);
  const oneFalse = mutate('умова завжди хибна лише на першому', GATE, 'if: false');
  is('хибна на одному з трьох — теж червоніє', oneFalse.some((p) => p.includes('quiet') || p.includes('stale') || p.includes('dependabot')), true);
  const flipped = mutate('`!=` перевернуто на `==`', GATE, "if: github.event.schedule == '23 */3 * * *'", true);
  is('перевернута умова — червоніє', flipped.length > 0, true);
  const typo = mutate('умова з іншим рядком cron', GATE, "if: github.event.schedule != '23 */2 * * *'", true);
  is('умова з розбіжним рядком cron (бігали б на кожен тік) — червоніє', typo.length > 0, true);
  const noGate = mutate('шлюз знято з усіх трьох', `    ${GATE}\n`, '', true);
  is('без шлюзу три сторожі біжать і на тригодинному — червоніє', noGate.some((p) => p.includes('«23 */3 * * *»')), true);
  const uptimeOff = mutate('uptime ніколи не біжить',
    "if: github.event_name == 'workflow_dispatch' || github.event.schedule == '23 */3 * * *'", 'if: false');
  is('uptime завжди хибний — червоніє', uptimeOff.length > 0, true);
  const cronGone = mutate('тригодинний cron зник', "    - cron: '23 */3 * * *'\n", '');
  is('cron видалено, а роботи чекають — червоніє', cronGone.some((p) => p.includes('зник')), true);
  const newCron = mutate('новий cron без договору', "    - cron: '0 8 * * *'\n", "    - cron: '0 8 * * *'\n    - cron: '5 5 * * 1'\n");
  is('новий cron, якого нема в договорі — червоніє', newCron.some((p) => p.includes('немає в договорі')), true);

  const EXPECTED_CASES = 27;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-watchdog-gates self-test: ${cases.length} випадків`);
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
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-watchdog-gates.mjs');
  process.exit(action.has('--self-test') ? selfTest() : run());
}
