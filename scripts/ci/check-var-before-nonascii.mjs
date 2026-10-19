#!/usr/bin/env node
// CAMP-349: `$var` упритул до не-ASCII символу — це інше імʼя змінної.
//
//   node scripts/ci/check-var-before-nonascii.mjs
//   node scripts/ci/check-var-before-nonascii.mjs --self-test
//
// 🔴 ЩО САМЕ ЛАМАЄТЬСЯ. Наші повідомлення написані українською, з
// лапками «…». У рядку
//
//     ok $? "🔴 «$broken» — відмова з назвою"
//
// після `$broken` стоїть `»` — два байти, 0xC2 0xBB. У деяких
// середовищах bash (локаль, версія, спосіб запуску) розбирає їх як
// ПРОДОВЖЕННЯ імені змінної: ім'я стає `broken»`, воно не задане, і під
// `set -u` скрипт падає з «unbound variable».
//
// 🔴 І ЦЕ НЕ ПРОСТО ПАДІННЯ, А ПАДІННЯ В НАЙГІРШОМУ МІСЦІ. Падає рядок,
// яким набір мав ПОЯСНИТИ, що сталось. У матриці мутацій крах
// самоперевірки виглядає точнісінько як спіймана мутація: код виходу
// ненульовий, червоних рядків немає. 19.10.2026 я двічі записав мутацію
// як «вбиту», тоді як набір просто не дожив до неї.
//
// 🔴 ТРИ РАЗИ ЗА ОДИН ДЕНЬ, У ТРЬОХ РІЗНИХ ФАЙЛАХ: firewall.selftest.sh,
// camptribe-firewall, env-value.selftest.sh. Правило, яке я тримав у
// голові, трималось рівно доти, доки я про нього памʼятав.
//
// 🔴 УМОВА НАЗВАНА ТОЧНО, бо рецензія НЕ відтворила падіння й була
// права вимагати цифри. Воно не від «деяких середовищ», а від одного:
//
//     printf 'set -u\nv=значення\necho "«$v»"\n' > /tmp/t.sh
//     LC_CTYPE=C.UTF-8 bash /tmp/t.sh
//     → /tmp/t.sh: line 3: v?: unbound variable
//
// Відтворено 19.10.2026 на bash 3.2.57 (macOS). `C.UTF-8` — локаль
// glibc; bash 3.2 її не знає, відкочується в однобайтовий режим і
// читає 0xC2 0xBB як літери імені. З `LC_ALL=C` і з рідною
// `uk_UA.UTF-8` той самий скрипт проходить.
//
// Чому це не екзотика: `LC_CTYPE=C.UTF-8` стоїть у середовищі, з якого
// я ганяю матриці мутацій, і `LANG=C.UTF-8` — типове для раннерів CI.
// На Linux bash 5 локаль дійсна й нічого не ламається; ламається рівно
// там, де я ці набори й прогоняю.
//
// Лікується одним символом: `${broken}`. Межі імені стають явними, і
// жодна локаль їх не рухає.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chooseAction } from '../lib/entrypoint.mjs';

// 🔴 СУЦІЛЬНИЙ КОМЕНТАР ПРОПУСКАЄМО, І ТІЛЬКИ ЙОГО. Цей файл документує
// пастку, показуючи ЗЛАМАНУ форму, і без цього підсвічував сам себе; те
// саме робить `deploy.selftest.sh:1157`, де трап описано ще раніше.
//
// Свідомо вужче за `code()` із check-pipe-to-grep-q.mjs: там потрібна
// лапко-свідома межа, бо там `#` у значенні міняє ВЕРДИКТ. Тут питання
// інше — «чи цей рядок узагалі виконується», — і на нього досить
// першого символу. Тягнути складніше правило заради схожості означало б
// повʼязати два сторожі, яким потрібні різні відповіді.
const isWholeLineComment = (l) => /^[ \t]*#/.test(l);

const WHO = 'check-var-before-nonascii';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * `$name`, одразу за яким іде байт поза ASCII.
 *
 * `${name}` не ловиться: там межа вже явна. `$1`, `$?`, `$@` теж ні —
 * у них імʼя не може продовжитись літерою.
 */
const BARE_VAR_BEFORE_NONASCII = /\$[A-Za-z_][A-Za-z_0-9]*(?=[^\u0000-\u007F])/;

/** Кожен проблемний рядок джерела, як {line, text}. */
export function offences(source) {
  return String(source)
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => !isWholeLineComment(text) && BARE_VAR_BEFORE_NONASCII.test(text))
    .map(({ line, text }) => ({ line, text: text.trim() }));
}

/** Файли, яких це стосується: усе, що виконує оболонка. */
export function shellFiles(list) {
  return list.filter((f) => f.endsWith('.sh') || f.startsWith('infra/bin/'));
}

const MIN_SHELL_FILES = 33;
export const readEnough = (n) => n >= MIN_SHELL_FILES;

function main() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const all = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  const files = shellFiles(all);
  if (!readEnough(files.length)) {
    console.log(`::error::${WHO}: прочитано ${files.length} shell-файлів, чекали щонайменше ${MIN_SHELL_FILES}. Правило не біжить по дереву.`);
    process.exit(1);
  }
  const bad = [];
  for (const f of files) {
    for (const o of offences(readFileSync(path.join(root, f), 'utf8'))) bad.push({ file: f, ...o });
  }
  if (bad.length > 0) {
    for (const b of bad) console.log(`::error file=${b.file},line=${b.line}::\`$\`-змінна впритул до не-ASCII: ${b.text}`);
    console.log(
      `\n::error::${WHO}: ${bad.length} рядок(ів), де \`$var\` стоїть упритул до не-ASCII символу. ` +
        'Bash може прочитати ці байти як продовження імені, і під `set -u` скрипт падає тим самим ' +
        'рядком, яким мав пояснити помилку. Пиши `${var}` (CAMP-349).',
    );
    process.exit(1);
  }
  console.log(`✓ ${WHO}: ${files.length} shell-файлів, жодного \`$var\` упритул до не-ASCII`);
}

const CASES = [
  ['🔴 той самий рядок, що падав: «$broken»', () =>
    offences('ok $? "🔴 «$broken» — відмова"').length === 1],
  ['…і його виправлена форма чиста', () =>
    offences('ok $? "🔴 «${broken}» — відмова"').length === 0],
  ['🔴 тире, не лише лапка', () => offences('echo "$v—далі"').length === 1],
  ['…а з пробілом перед тире — чисто', () => offences('echo "$v — далі"').length === 0],
  ['🔴 суцільний коментар — це документація, не код', () =>
    offences('# так виглядає зламане: "«$to»"').length === 0],
  ['🔴 …і коментар З ВІДСТУПОМ теж, бо в цих скриптах вони майже всі такі', () =>
    offences('    # так виглядає зламане: "«$to»"').length === 0],
  ['…а код із хвостовим коментарем читається', () =>
    offences('echo "$v»"  # чому').length === 1],
  ['🔴 кирилиця одразу за змінною', () => offences('echo "$nамір"').length === 1],
  ['🔴 емодзі теж не ASCII', () => offences('echo "$x🔴"').length === 1],
  ['пробіл між ними — чисто', () => offences('echo "$v »"').length === 0],
  ['ASCII-символ за змінною — чисто', () => offences('echo "$v, далі"').length === 0],
  ['кінець рядка — чисто', () => offences('echo "$v"').length === 0],
  ['🔴 не-ASCII ПЕРЕД змінною нічого не ламає', () => offences('echo "« $v"').length === 0],
  ['$1 не може продовжитись літерою', () => offences('echo "$1»"').length === 0],
  ['$? теж', () => offences('echo "$?»"').length === 0],
  ['${} з не-ASCII одразу за ним — чисто', () => offences('echo "${v}»"').length === 0],
  ['🔴 кілька на рядок — один звіт, бо лагодити треба рядок', () =>
    offences('echo "$a» і $b»"').length === 1],
  ['два рядки — два звіти', () => offences('echo "$a»"\necho "$b»"').length === 2],
  ['номер рядка справжній', () => offences('a\nb\necho "$v»"')[0].line === 3],
  ['🔴 інвентар: лише те, що виконує оболонка', () =>
    shellFiles(['a.sh', 'infra/bin/x', 'b.mjs', 'c.yml']).join(',') === 'a.sh,infra/bin/x'],
  ['🔴 …і саме `infra/bin/`, а не весь `infra/`: там лежать .md і .yml', () =>
    shellFiles(['infra/README.md', 'infra/systemd/x.service', 'infra/bin/y']).join(',') === 'infra/bin/y'],
  ['🔴 підлога пінить значення, а не існування', () =>
    readEnough(33) === true && readEnough(32) === false],
];

const EXPECTED_CASES = 22;

function selfTest() {
  let failed = 0, ran = 0;
  for (const [what, run] of CASES) {
    let ok;
    try { ok = run() === true; } catch (e) { ok = false; console.log(`    кинуло: ${e.message}`); }
    ran++; if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what}`);
  }
  if (ran !== EXPECTED_CASES) { failed++; console.log(`✗ виконано ${ran}, очікувалось ${EXPECTED_CASES}`); }
  console.log(failed ? `\n::error::${WHO} self-test failed on ${failed} case(s)`
                     : `\n✓ ${WHO} self-test: ${ran} cases, \`$var\` before non-ASCII refused`);
  process.exit(failed ? 1 : 0);
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
})();

if (invokedDirectly) {
  chooseAction(process.argv.slice(2), ['--self-test'], `${WHO}.mjs`);
  if (process.argv.includes('--self-test')) selfTest();
  else main();
}
