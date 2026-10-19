#!/usr/bin/env node
// CAMP-353: у репозиторій не сміє потрапити рядок безпекового журналу
// зі справжньою адресою читача.
//
//   node scripts/ci/check-no-log-in-git.mjs
//   node scripts/ci/check-no-log-in-git.mjs --self-test
//
// 🔴 ЧОМУ НЕ ДОСИТЬ `.gitignore`. Він описує НАМІР, а не стан: файл,
// доданий через `git add -f`, доданий до правила, або покладений під
// іншим імʼям, лишається в індексі, і `.gitignore` про нього мовчить.
// У цьому ж репозиторії правило `node_modules/` уже не спіймало
// симлінка. Тому сторож дивиться в ІНДЕКС git, а не в текст правил.
//
// 🔴 ПЕРЕВІРЯЄТЬСЯ ВЛАСТИВІСТЬ, А НЕ ІМʼЯ. «Файл не зветься access.log»
// обходиться перейменуванням. Питання, на яке дефект не може відповісти
// «так»: чи є у файлі, що ВИГЛЯДАЄ як рядок журналу Caddy, адреса, яка
// належить комусь насправді.
//
// Дозволені — діапазони RFC 5737 (192.0.2/24, 198.51.100/24,
// 203.0.113/24), заведені саме для прикладів і не належні нікому, плюс
// приватні й службові. Усе інше в журнальному файлі — чиясь адреса.
//
// 🔴 ЧОГО ТУТ НЕМАЄ: адреси нашої ж машини в docs/. Вона там є (5
// комітів історії теж), це окрема картка CAMP-355, і робити цей сторож
// червоним через неї означало б вимкнути його до того, як він почне
// працювати.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';
// 🔴 КЛАСИФІКАТОР АДРЕС — ОДИН НА ДВОХ СТОРОЖІВ. Своя копія тут уже
// коштувала: у ній лежали адреса нашого сервера й адреса оператора,
// і знайшов їх не я, а сторож CAMP-355. Два списки одного правила
// розходяться мовчки.
import { isRealAddress, isRealV6, realAddressesIn } from '../lib/ip.mjs';

/** Імена, під якими копія журналу лягає на диск. */
export const MIRROR_NAME = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.log(\.gz)?$/;

/**
 * Чи це справді журнал Caddy.
 *
 * 🔴 РОЗБІР, А НЕ ЗБІГ ТЕКСТУ, І ПРИЧИНА — ПЕРШИЙ ЖЕ ПРОГІН. Перша
 * редакція шукала рядок `"msg": "handled request"` як текст — і
 * почервоніла на САМІЙ СОБІ: ця фраза є в її ж регулярці, а в її
 * самотесті лежать справжні адреси як приклади. Сторож, який ловить
 * власне джерело, доведеться або вимкнути, або внести у виняток, і
 * обидва шляхи ведуть до вимкненого сторожа.
 *
 * Розбір відповідає на питання, якого текстовий збіг не ставив: чи це
 * ДАНІ журналу, чи згадка про нього. Фікстура — один відформатований
 * обʼєкт; сама копія — JSON-рядки, тож пробуємо і цілий файл, і перший
 * рядок.
 */
export function isLogShaped(name, text) {
  if (MIRROR_NAME.test(name)) return true;
  const looks = (candidate) => {
    try {
      const o = JSON.parse(candidate);
      return Boolean(o) && typeof o === 'object' && o.msg === 'handled request';
    } catch {
      // не JSON — отже не дані журналу, а щонайбільше згадка про них
      return false;
    }
  };
  if (looks(text)) return true;
  // 🔴 НЕ ЛИШЕ ПЕРШИЙ РЯДОК. Перша редакція дивилась на нього одного —
  // і копія, що починається з порожнього рядка, з BOM або з уривка,
  // ставала «не журналом» і проходила мовчки. Беремо кілька перших
  // непорожніх: цього досить, щоб упізнати формат, і недосить, щоб
  // перетворити сторожа на читача всього дерева.
  let seen = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    if (looks(t)) return true;
    if (++seen >= 5) break;
  }
  return false;
}

/**
 * Вирок за підрахованим. Чиста функція — щоб «пару до вироку» можна
 * було відрепетирувати, а не лише прочитати.
 *
 * 🔴 МУТАЦІЯ `examined === 0` → `examined < 0` ПЕРЕЖИВАЛА ВСІ 12
 * ВИПАДКІВ, бо сама пара не мала тесту. Перевірка, яку ніщо не валить,
 * це галочка, зелена за побудовою.
 */
export function verdict({ findings, examined }) {
  if (examined === 0) {
    return { rc: 1, why: 'жодного журнального файла не оглянуто — сканер нічого не прочитав' };
  }
  if (findings.length > 0) {
    return { rc: 1, why: `${findings.length} файл(ів) із журнальними даними в індексі git` };
  }
  return { rc: 0, why: `оглянуто ${examined} журнальний(их) файл(ів), справжніх адрес немає` };
}




/**
 * Текст файла, навіть якщо він стиснутий.
 *
 * 🔴 `backup-2026-10-19.gz` З ДВОМА СПРАВЖНІМИ АДРЕСАМИ ПРОХОДИВ
 * ЗЕЛЕНИМ. Імʼя не збігалося зі шаблоном копії, а вміст, прочитаний як
 * utf8, не розбирався ні в JSON, ні в що — тож файл просто не
 * вважався оглянутим. Мовчазний пропуск виглядає точно так само, як
 * чисто.
 *
 * Розпізнаємо за магічними байтами, а не за розширенням: перейменувати
 * файл простіше, ніж змінити його формат.
 */
export function textOf(raw) {
  let buf = raw;
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(buf);
    } catch {
      return '';
    }
  }
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

/**
 * Перевірити перелік файлів. `read` віддає вміст; у самотесті його
 * підміняють, щоб не залежати від дерева.
 */
export function inspect(files, read) {
  const findings = [];
  let examined = 0;
  for (const f of files) {
    const base = path.basename(f);
    let text;
    try {
      text = read(f);
    } catch {
      continue;
    }
    const shaped = isLogShaped(base, text);
    if (!shaped) continue;
    examined += 1;
    if (MIRROR_NAME.test(base)) {
      findings.push({ file: f, why: 'імʼя копії журналу в індексі git' });
      continue;
    }
    const real = realAddressesIn(text);
    if (real.length > 0) {
      findings.push({ file: f, why: `справжні адреси: ${real.slice(0, 3).join(', ')}` });
    }
  }
  return { findings, examined };
}

function tracked() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const list = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  return { root, list };
}

function live() {
  const { root, list } = tracked();
  // Читаємо БАЙТАМИ: стиснутий файл, прочитаний як utf8, перетворюється
  // на сміття й тихо випадає з огляду.
  const { findings, examined } = inspect(list, (f) =>
    textOf(readFileSync(path.join(root, f))),
  );
  // 🔴 ПАРА ДО ВИРОКУ. «Нічого не знайдено» справджується і тоді, коли
  // сканер не відкрив жодного файла — а виглядає це так само зелено.
  // У репозиторії лежить зразок рядка журналу (фікстура тесту), тож
  // нуль оглянутих означає, що зламався сторож, а не що стало чисто.
  for (const f of findings) {
    console.error(`::error file=${f.file}::${f.why}`);
  }
  const v = verdict({ findings, examined });
  if (v.rc !== 0) {
    console.error(`::error::check-no-log-in-git: ${v.why}`);
    return v.rc;
  }
  console.log(`✓ check-no-log-in-git: ${v.why}`);
  return 0;
}

function selfTest() {
  const cases = [];
  const is = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    cases.push(ok);
    if (!ok) console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  };

  is('діапазони для документації не є чиїмись', [
    isRealAddress('192.0.2.1'), isRealAddress('198.51.100.23'), isRealAddress('203.0.113.10'),
  ], [false, false, false]);
  is('приватні й службові не є чиїмись', [
    isRealAddress('10.0.0.1'), isRealAddress('127.0.0.1'), isRealAddress('192.168.1.1'),
    isRealAddress('172.20.0.5'), isRealAddress('169.254.1.1'), isRealAddress('224.0.0.1'),
  ], [false, false, false, false, false, false]);
  // 🔴 ТУТ СТОЯЛИ АДРЕСА НАШОГО СЕРВЕРА Й АДРЕСА ОПЕРАТОРА, і сторож
  // CAMP-355 знайшов їх за кілька годин після злиття цього файла.
  // Фікстурі потрібні адреси, які класифікатор визнає чужими, — але
  // «чужа» не означає «наша». Приклади тепер сторонні й загальновідомі,
  // а перевірка від цього не змінилась ні на крок.
  is('публічні — чиїсь', [
    isRealAddress('8.8.4.4'), isRealAddress('1.1.1.1'), isRealAddress('8.8.8.8'),
    isRealAddress('172.32.0.1'),
  ], [true, true, true, true]);
  is('сміття не є адресою', [isRealAddress('999.1.1.1'), isRealAddress('1.2.3')], [false, false]);

  const line = (ip) => `{"level":"info","msg":"handled request","request":{"client_ip":"${ip}"}}`;
  is('знеособлений зразок проходить',
    inspect(['f.json'], () => line('198.51.100.23')), { findings: [], examined: 1 });
  is('справжня адреса в журнальному файлі — провал',
    inspect(['f.json'], () => line('8.8.4.4')).findings.map((x) => x.file), ['f.json']);
  is('файл не журнальної форми не чіпаємо',
    inspect(['readme.md'], () => 'сервер 8.8.4.4 у тексті'), { findings: [], examined: 0 });
  is('копію журналу ловимо за імʼям, хай там що всередині',
    inspect(['x/2026-10-19-2b0853ac.log'], () => 'порожньо').findings.length, 1);
  is('і стиснуту теж',
    inspect(['x/2026-10-19-2b0853ac.log.gz'], () => '').findings.length, 1);
  is('нечитаний файл не вважається оглянутим',
    inspect(['bin'], () => { throw new Error('binary'); }), { findings: [], examined: 0 });
  // 🔴 Саме цей випадок валив сторожа об нього самого: файл, що ЗГАДУЄ
  // журнал, — не журнал. Інакше кожен, хто напише про цю перевірку,
  // зробить її червоною.
  is('згадка про журнал — не журнал',
    inspect(['guard.mjs'], () =>
      'const RE = /"msg": "handled request"/; // приклад: 8.8.4.4'),
    { findings: [], examined: 0 });
  is('копія у вигляді JSON-рядків ловиться за першим рядком',
    inspect(['dump.txt'], () => `${line('8.8.4.4')}\n${line('8.8.8.8')}\n`).findings.length, 1);

  // ── Те, що рецензія 19.10.2026 назвала непокритим ──

  // 🔴 IPv6 не перевірявся взагалі. Адреса читача за Cloudflare саме
  // така, якщо він у мережі IPv6.
  is('IPv6 для документації не чийсь',
    ['2001:db8::1', '2001:DB8:85a3::8a2e:370:7334'].map(isRealV6), [false, false]);
  is('локальні й link-local не чиїсь',
    ['::1', '::', 'fd00::1', 'fc00::abcd', 'fe80::1%en0'].map(isRealV6), [false, false, false, false, false]);
  is('справжня IPv6 — чиясь',
    isRealV6('2001:4860:4860::8888'), true);
  is('час і ключі не є адресами', ['12:34', 'a:b'].map(isRealV6), [false, false]);
  is('IPv6 у журнальному файлі — провал',
    inspect(['v6.json'], () =>
      '{"msg":"handled request","request":{"client_ip":"2001:4860:4860::8888"}}')
      .findings.length, 1);

  // 🔴 `out.add(m[0])` → `m[1]` давало перший октет замість адреси.
  is('повертається адреса цілком, а не її шматок',
    realAddressesIn('межа 203.0.113.9 і 8.8.4.4 поруч'), ['8.8.4.4']);

  // 🔴 Розширення діапазону документації (`192.0.2/24` → `192.0/16`)
  // тихо дозволяло б цілу мережу.
  is('сусід діапазону документації — чужа адреса',
    [isRealAddress('192.0.2.3'), isRealAddress('192.0.3.3'), isRealAddress('192.1.2.3')],
    [false, true, true]);

  // 🔴 Пара до вироку тепер має власний тест.
  is('нуль оглянутих — це провал, а не тиша',
    verdict({ findings: [], examined: 0 }).rc, 1);
  is('знахідки — провал', verdict({ findings: [{}], examined: 3 }).rc, 1);
  is('оглянуто й чисто — успіх', verdict({ findings: [], examined: 3 }).rc, 0);

  // 🔴 Стиснута копія під чужим імʼям проходила зеленою.
  {
    const line = '{"msg":"handled request","request":{"client_ip":"8.8.8.8"}}';
    const gz = gzipSync(Buffer.from(line, 'utf8'));
    is('стиснуте розпаковується', textOf(gz).includes('handled request'), true);
    is('стиснута копія під чужим імʼям — провал',
      inspect(['backup-2026-10-19.gz'], () => textOf(gz)).findings.length, 1);
    is('не-gzip лишається собою', textOf(Buffer.from('звичайний текст')), 'звичайний текст');
    is('BOM знімається', textOf(Buffer.from('\uFEFF{"a":1}', 'utf8')), '{"a":1}');
  }

  // 🔴 Перший рядок міг бути не цілим записом.
  is('порожній перший рядок не ховає журнал',
    inspect(['x.log.txt'], () => `\n\n${line('8.8.8.8')}\n`).findings.length, 1);
  is('уривок попереду не ховає журнал',
    inspect(['y.txt'], () => `…обрив\n${line('8.8.8.8')}\n`).findings.length, 1);

  const EXPECTED_CASES = 28;
  let rc = 0;
  if (cases.some((c) => !c)) rc = 1;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-no-log-in-git self-test: ${cases.length} випадків`);
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
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-no-log-in-git.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  process.exit(live());
}
