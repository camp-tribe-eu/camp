#!/usr/bin/env node
// Жодна команда в репозиторії не вчить класти секрет в аргументи `sudo`.
//
//   node scripts/ci/check-no-secret-in-argv.mjs
//   node scripts/ci/check-no-secret-in-argv.mjs --self-test
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ ІСНУЄ. 02.11.2026 імпорт вебкамер запустили руками
// так: `sudo -u camptribe env DATABASE_URL=… WINDY_WEBCAMS_API_KEY=… node …`.
// `sudo` пише ПОВНИЙ командний рядок у журнал — і в `journald`, і в
// `/var/log/auth.log`. Заміряно на проді 13.11.2026: 15 записів із
// паролем бази за 12.10–03.11, ключ Windy цілим (32 знаки з 32) і
// токен збірки. Пароль бази довелось ротувати; журнал вибірково не
// чиститься.
//
// 🔴 ЩО САМЕ ЗАБОРОНЕНО. Присвоєння `ІМʼЯ=значення` змінній, схожій на
// секрет, у тому самому логічному рядку, що й `sudo` або `systemd-run`:
//
//   sudo -u camptribe env DATABASE_URL=… node …      ← argv sudo, у журналі
//   sudo DATABASE_URL=… node …                       ← те саме
//   systemd-run --setenv=WINDY_WEBCAMS_API_KEY=… …   ← argv, і в описі юніта
//
// Правильна форма одна, і вона вже є в кожному юніті:
//
//   sudo systemd-run --collect --wait --pipe -p User=camptribe \
//     -p EnvironmentFile=/srv/camptribe/current/apps/api/.env <команда>
//
// 🔴 ЧОГО ЦЕЙ СТОРОЖ НЕ БАЧИТЬ, і це названо, а не замовчано:
//   • команду, яку людина чи агент набрали на машині, не взявши її з
//     репозиторію, — саме так і сталось 02.11. Сторож прибирає лише
//     ЗРАЗОК, із якого таку команду списують;
//   • секрет в argv без `sudo` (`psql "$DATABASE_URL"`): його видно в
//     `ps`, але в журнал він не лягає. Це пункт 12 `docs/self-check.md`.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'scripts/ci/check-no-secret-in-argv.mjs';

/** Імена, значення яких — секрет. Слова з правила проєкту про секрети. */
const SECRET_NAME = /^(?:DATABASE_URL|PGPASSWORD|[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|LICENSE|BASIC_AUTH)[A-Z0-9_]*)$/;
const ASSIGNMENT = /(?:^|[\s'"`=(])([A-Z][A-Z0-9_]*)=(?!=)/g;
const LAUNCHER = /(?:^|[\s`'"(|;&])(sudo|systemd-run)(?=[\s`'"]|$)/;

export const sha = (line) => createHash('sha256').update(line.trim()).digest('hex').slice(0, 12);

/**
 * Рядки, які ОПИСУЮТЬ дефект, а не вчать його: коментарі про те, чому
 * deploy так більше не робить.
 *
 * 🔴 ЯКІР — ЗМІСТ РЯДКА, НЕ ЙОГО НОМЕР. Виняток за номером пережив би
 * правку, після якої на тому місці стоїть уже справжня команда. Відбиток
 * рядка вмирає разом із рядком, а виняток, якому більше нема чого
 * покривати, — це падіння, а не тиша (див. `staleAllows`).
 */
export const ALLOWED = Object.freeze([
  { file: 'infra/bin/camptribe-deploy', sha: '1b73ad034f7d', why: 'коментар про дефект 15.10.2026, який deploy прибрав' },
  { file: 'infra/deploy.selftest.sh', sha: '7519ef543def', why: 'коментар самоперевірки про той самий дефект' },
]);

/** Склеює рядки, що закінчуються на `\`, зберігаючи номер першого. */
export function logicalLines(text) {
  const out = [];
  let buf = null;
  text.split('\n').forEach((raw, i) => {
    const cont = /\\\s*$/.test(raw);
    const piece = cont ? raw.replace(/\\\s*$/, ' ') : raw;
    if (buf) buf.text += piece.trimStart();
    else buf = { line: i + 1, text: piece };
    if (!cont) {
      out.push(buf);
      buf = null;
    }
  });
  if (buf) out.push(buf);
  return out;
}

/** Імена секретних змінних, присвоєних у рядку ПІСЛЯ sudo / systemd-run. */
export function secretsInArgv(line) {
  const m = LAUNCHER.exec(line);
  if (!m) return [];
  const tail = line.slice(m.index + m[0].length);
  const names = [];
  for (const a of tail.matchAll(ASSIGNMENT)) {
    if (SECRET_NAME.test(a[1])) names.push(a[1]);
  }
  return [...new Set(names)];
}

export function scan(files, allowed = ALLOWED) {
  const findings = [];
  const used = new Set();
  for (const { file, text } of files) {
    if (file === SELF) continue;
    for (const { line, text: l } of logicalLines(text)) {
      const names = secretsInArgv(l);
      if (names.length === 0) continue;
      const key = `${file}#${sha(l)}`;
      if (allowed.some((a) => `${a.file}#${a.sha}` === key)) {
        used.add(key);
        continue;
      }
      findings.push({ file, line, names, sha: sha(l) });
    }
  }
  const staleAllows = allowed.filter((a) => !used.has(`${a.file}#${a.sha}`));
  return { findings, staleAllows };
}

function trackedFiles() {
  const names = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0').filter(Boolean);
  const out = [];
  for (const file of names) {
    if (/(^|\/)package-lock\.json$|\.(png|jpe?g|webp|avif|gif|ico|woff2?|pdf|zip|gz|pbf|dump)$/i.test(file)) continue;
    let text;
    try { text = readFileSync(path.join(ROOT, file), 'utf8'); } catch { continue; }
    if (text.includes('\u0000')) continue;
    out.push({ file, text });
  }
  return out;
}

function selfTest() {
  const cases = [];
  const t = (name, got, want) => cases.push([name, got, want]);
  const names = (l) => secretsInArgv(l);

  t('🔴 саме та команда, що витекла 02.11',
    names('sudo -u camptribe env DATABASE_URL=postgres://u:p@db.invalid/db WINDY_WEBCAMS_API_KEY=abc node dist/x.js'),
    ['DATABASE_URL', 'WINDY_WEBCAMS_API_KEY']);
  t('🔴 без env, одразу після sudo', names('sudo DATABASE_URL=… node x'), ['DATABASE_URL']);
  t('🔴 заповнювач «…» теж зразок, з якого списують', names('`sudo -u … env API_BUILD_TOKEN=… npm run build`'), ['API_BUILD_TOKEN']);
  t('🔴 systemd-run --setenv', names('systemd-run --setenv=SMTP_PASSWORD=x node y'), ['SMTP_PASSWORD']);
  t('🔴 systemd-run -p Environment=', names('sudo systemd-run -p Environment=REVALIDATE_SECRET=x node y'), ['REVALIDATE_SECRET']);
  t('🔴 значення зі змінної оболонки — в argv воно вже розкрите', names('sudo -u camptribe env DATABASE_URL="$DATABASE_URL" node y'), ['DATABASE_URL']);
  t('правильна форма: EnvironmentFile',
    names('sudo systemd-run --collect -p User=camptribe -p EnvironmentFile=/srv/camptribe/current/apps/api/.env node dist/x.js'), []);
  t('присвоєння БЕЗ sudo — не argv sudo, у журнал не лягає', names('DATABASE_URL=postgres://localhost/x npm test'), []);
  t('присвоєння ПЕРЕД sudo не рахується', names('DATABASE_URL=x; sudo systemctl restart camptribe-api'), []);
  t('несекретна змінна після sudo', names('sudo -u camptribe env NODE_ENV=production PORT=3000 node x'), []);
  t('порівняння == не присвоєння', names('sudo test "$TOKEN"=="x"'), []);
  t('слово pseudo — не sudo', names('pseudo DATABASE_URL=x'), []);

  t('🔴 перенос рядка через \\ не ховає секрет',
    scan([{ file: 'a.md', text: 'sudo -u camptribe env \\\n  DATABASE_URL=… \\\n  node x\n' }], []).findings
      .map((f) => [f.line, f.names]), [[1, ['DATABASE_URL']]]);
  const bad = 'sudo -u camptribe env DATABASE_URL=… node x';
  t('виняток за відбитком покриває саме цей рядок',
    scan([{ file: 'a.sh', text: `# ${bad}\n` }], [{ file: 'a.sh', sha: sha(`# ${bad}`) }]).findings.length, 0);
  t('🔴 той самий відбиток в ІНШОМУ файлі не діє',
    scan([{ file: 'b.sh', text: `# ${bad}\n` }], [{ file: 'a.sh', sha: sha(`# ${bad}`) }]).findings.length, 1);
  t('🔴 рядок змінили — виняток його більше не покриває',
    scan([{ file: 'a.sh', text: `# ${bad} --apply\n` }], [{ file: 'a.sh', sha: sha(`# ${bad}`) }]).findings.length, 1);
  t('🔴 виняток, якому нема чого покривати, — названий, а не тихий',
    scan([{ file: 'a.sh', text: 'echo ok\n' }], [{ file: 'a.sh', sha: 'deadbeef0000' }]).staleAllows.length, 1);
  t('власний файл сторожа не сканується (у ньому зразки)',
    scan([{ file: SELF, text: `${bad}\n` }], []).findings.length, 0);

  let pass = 0;
  let fail = 0;
  for (const [name, got, want] of cases) {
    if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ✓ ${name}`); } else {
      fail++;
      console.error(`  ✗ ${name}: ${JSON.stringify(got)}, мало бути ${JSON.stringify(want)}`);
    }
  }
  console.log(`check-no-secret-in-argv self-test: ran ${pass + fail}, passed ${pass}, failed ${fail}`);
  return fail === 0 ? 0 : 1;
}

function main(argv) {
  const known = new Set(['--self-test']);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length) {
    console.error(`невідомий прапорець: ${unknown.join(' ')} — відмовляю, а не сканую мовчки`);
    return 2;
  }
  if (argv.includes('--self-test')) return selfTest();

  const files = trackedFiles();
  if (files.length < 100) {
    console.error(`прочитано лише ${files.length} файлів — це не репозиторій, а збій переліку`);
    return 2;
  }
  const { findings, staleAllows } = scan(files);
  for (const f of findings) {
    console.error(`✗ ${f.file}:${f.line} — ${f.names.join(', ')} в аргументах sudo/systemd-run (відбиток ${f.sha})`);
  }
  for (const a of staleAllows) {
    console.error(`✗ виняток ${a.file}#${a.sha} нічого не покриває — рядок змінився або зник; прибери виняток`);
  }
  if (findings.length || staleAllows.length) {
    console.error(
      '\nСекрет в argv `sudo` лягає в journald і auth.log цілим. Передавай файлом:\n' +
        '  sudo systemd-run --collect --wait --pipe -p User=camptribe \\\n' +
        '    -p EnvironmentFile=/srv/camptribe/current/apps/api/.env <команда>',
    );
    return 1;
  }
  console.log(`✓ check-no-secret-in-argv: ${files.length} файлів, винятків ${ALLOWED.length}, знахідок 0`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
