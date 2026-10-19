#!/usr/bin/env node
// CAMP-355: жодної публічної адреси у відстежуваних файлах, крім
// названих у `public-addresses.json` із причиною.
//
//   node scripts/ci/check-public-addresses.mjs
//   node scripts/ci/check-public-addresses.mjs --self-test
//
// 🔴 ЧОМУ ЗАКРИТИЙ ПЕРЕЛІК, А НЕ ЗАБОРОНА ОДНОГО РЯДКА. Сторож, який
// шукає адресу нашої машини, мусив би цю адресу МІСТИТИ — тобто сам
// став би місцем, де вона записана, і прибирання втратило б сенс.
//
// Тому питання поставлене навпаки, і на нього дефект не може відповісти
// «так»: чи кожна публічна адреса в репозиторії названа з причиною?
// Адреси нашої машини в переліку немає й не буде, тож її повернення —
// це «не названа адреса», і сторож червоніє, жодного разу її не знаючи.
//
// 🔴 ПЕРЕЛІК ЗАКРИТИЙ З ОБОХ БОКІВ. Запис, якого в дереві вже немає,
// теж провал: інакше таблиця за півроку стає переліком побажань, і
// «все названо» перестає щось означати.
//
// Заміряно 19.10.2026: у дереві було 9 збігів, з них 2 — адреси нашої
// інфраструктури (сервер і спільний релей пошти Hetzner), 2 — зовсім не
// адреси (номер розділу RFC і префікс ідентифікатора CAP), решта —
// чужі діапазони в діагностиці й фікстурах.
//
// 🔴 МЕЖА, ЯКУ ТРЕБА ЗНАТИ. Сторож читає адресу в її ЗВИЧАЙНІЙ формі.
// Вісімкову, шістнадцяткову й цілочисельну (`0237.0105.0051.0060`,
// `0xA.0x45.0x29.0x30`, `2672540976`) він не впізнає, хоч `curl` і
// `ping` їх приймають. Це свідома межа: сторож ставлять проти
// НЕДОГЛЯДУ, а не проти того, хто навмисно ховає адресу — такий має
// простіший шлях, ніж вісімкові октети. Межа тримається карткою
// CAMP-356, щоб не лишитись самою лише згадкою тут.

import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { chooseAction } from '../lib/entrypoint.mjs';
import { isRealAddress, realAddressesIn } from '../lib/ip.mjs';

/**
 * 🔴 ВИНЯТКІВ НЕМАЄ, І ЦЕ ВИПРАВЛЕННЯ РЕЦЕНЗІЇ, А НЕ ПУРИЗМ.
 *
 * Перша редакція виводила з-під правила три файли «про адреси»:
 * `ip.mjs`, цей файл і перелік. Рецензія 19.10.2026 показала, у що це
 * обходиться: у ТОМУ Ж коміті, чия назва хвалиться, що сторож спіймав
 * адресу нашої машини в сусідньому файлі, я вписав префікс нашої
 * мережі у фікстуру `ip.mjs` — і сторож мовчав, бо того файла не читає.
 *
 * Виняток «цей файл про адреси» не відрізняється від «цей файл мій».
 * Тепер читається ВСЕ, а фікстури сторожів названі в переліку
 * поіменно — як і будь-яка інша адреса в дереві.
 */
/** Двійкове за розширенням — читати як текст немає сенсу. */
const BINARY = /\.(png|jpe?g|webp|avif|gif|ico|pdf|zip|gz|br|woff2?|ttf|otf|mp4|webm|pbf|mbtiles)$/i;

/**
 * Звірити знайдене з переліком.
 *
 * Повертає `unaccounted` (є в дереві, немає в переліку) і `phantom`
 * (є в переліку, немає в дереві) — і те й те провал.
 */
export function reconcile(found, accounted) {
  const key = (x) => `${x.file}\u0000${x.address}`;
  const haveFound = new Set(found.map(key));
  const haveListed = new Set(accounted.map(key));
  return {
    unaccounted: found.filter((f) => !haveListed.has(key(f))),
    phantom: accounted.filter((a) => !haveFound.has(key(a))),
  };
}

/** Адреси у файлах, як їх бачить сторож. `read` підміняють у тестах. */
/** Шлях до переліку — він єдиний читається не як звичайний файл. */
export const LIST = 'scripts/ci/public-addresses.json';

/**
 * Текст переліку без його ж ОГОЛОШЕНЬ.
 *
 * 🔴 ОГОЛОШЕННЯ — ЦЕ НЕ ВХОДЖЕННЯ, і без цієї різниці правило не має
 * нерухомої точки: кожна адреса потребувала б двох записів, другий — про
 * те, що вона згадана в самому переліку.
 *
 * Прибираємо ЛИШЕ значення полів `address`. Усе інше в файлі —
 * пояснення, шляхи, коментарі — читається як звичайний текст, тож
 * адреса, схована в полі `why`, буде спіймана.
 */
export function listBodyWithoutDeclarations(text) {
  let o;
  try {
    o = JSON.parse(text);
  } catch {
    return text;
  }
  let body = text;
  for (const a of o.accounted ?? []) {
    if (typeof a.address === 'string') body = body.split(`"${a.address}"`).join('""');
  }
  return body;
}

export function scan(files, read) {
  const out = [];
  for (const f of files) {
    if (BINARY.test(f)) continue;
    let text;
    try {
      text = read(f);
    } catch {
      continue;
    }
    if (f === LIST) text = listBodyWithoutDeclarations(text);
    for (const address of realAddressesIn(text)) out.push({ file: f, address });
  }
  return out;
}

/**
 * Вирок за звіреним. Чиста функція — бо `live()` не покрита жодним
 * випадком, і рецензія це довела: прибрати `|| phantom.length > 0`
 * можна було при 10/10 зелених, після чого застарілий запис ДРУКУВАВСЯ,
 * а код виходу лишався нулем. Свідок, якого лише друкують, не стереже.
 */
export function verdict({ found, unaccounted, phantom }) {
  if (found.length === 0) {
    return { rc: 1, why: 'у дереві не знайдено ЖОДНОЇ адреси — сканер нічого не прочитав' };
  }
  if (unaccounted.length > 0 || phantom.length > 0) {
    return { rc: 1, why: `${unaccounted.length} неназваних, ${phantom.length} застарілих записів` };
  }
  return { rc: 0, why: `${found.length} адрес у дереві, кожна названа з причиною` };
}

function live() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const found = scan(files, (f) => readFileSync(path.join(root, f), 'utf8'));
  const listed = JSON.parse(
    readFileSync(path.join(root, 'scripts/ci/public-addresses.json'), 'utf8'),
  ).accounted;
  const { unaccounted, phantom } = reconcile(found, listed);

  // 🔴 Пара до вироку: «нічого не знайдено» справджується й тоді, коли
  // сканер не відкрив жодного файла. Перелік не порожній за побудовою,
  // тож нуль збігів означає зламаний сканер, а не чисте дерево.
  for (const u of unaccounted) {
    console.error(`::error file=${u.file}::публічна адреса ${u.address} не названа в scripts/ci/public-addresses.json`);
  }
  for (const p of phantom) {
    console.error(`::error file=scripts/ci/public-addresses.json::${p.file} вже не містить ${p.address} — прибери запис`);
  }
  const v = verdict({ found, unaccounted, phantom });
  if (v.rc !== 0) {
    console.error(`::error::check-public-addresses: ${v.why}`);
    return v.rc;
  }
  console.log(`✓ check-public-addresses: ${v.why}`);
  return 0;
}

function selfTest() {
  const cases = [];
  const is = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    cases.push(ok);
    if (!ok) console.error(`✗ ${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
  };

  const A = { file: 'a.md', address: '8.8.8.8' };
  const B = { file: 'b.md', address: '1.1.1.1' };

  is('усе названо — скарг немає', reconcile([A], [A]), { unaccounted: [], phantom: [] });
  is('адреса без запису', reconcile([A, B], [A]).unaccounted.map((x) => x.address), ['1.1.1.1']);
  is('запис без адреси', reconcile([A], [A, B]).phantom.map((x) => x.address), ['1.1.1.1']);
  is('той самий файл, інша адреса — це інший запис',
    reconcile([A, { file: 'a.md', address: '1.1.1.1' }], [A]).unaccounted.length, 1);

  const read = (f) => ({
    'x.md': 'сервер 8.8.8.8 і ще раз 8.8.8.8, а також 10.0.0.1',
    'scripts/lib/ip.mjs': 'приклад 8.8.8.8',
    'scripts/ci/public-addresses.json': '{"address":"8.8.8.8"}',
    'img.png': 'байти 8.8.8.8',
  })[f] ?? '';
  is('приватні не рахуються, повтори не дублюються',
    scan(['x.md'], read), [{ file: 'x.md', address: '8.8.8.8' }]);
  is('нечитаний файл не валить прогін', scan(['boom'], () => { throw new Error('x'); }), []);
  is('класифікатор той самий, що в іншого сторожа',
    [isRealAddress('8.8.8.8'), isRealAddress('10.0.0.1')], [true, false]);

  // 🔴 Оголошення не є входженням — але все інше в переліку є.
  {
    const list = JSON.stringify({ accounted: [{ file: 'a', address: '8.8.8.8', why: 'бо так' }] });
    is('оголошена адреса не рахується входженням',
      realAddressesIn(listBodyWithoutDeclarations(list)), []);
    const sneaky = JSON.stringify({
      accounted: [{ file: 'a', address: '8.8.8.8', why: 'поруч із 1.1.1.1' }],
    });
    is('адреса, схована в поясненні, рахується',
      realAddressesIn(listBodyWithoutDeclarations(sneaky)), ['1.1.1.1']);
    is('зламаний JSON читається як звичайний текст',
      realAddressesIn(listBodyWithoutDeclarations('{зламано 8.8.4.4')), ['8.8.4.4']);
  }

  // 🔴 ВИРОК МАЄ ВЛАСНІ ВИПАДКИ. `live()` не покрита нічим, і рецензія
  // показала мутацію: прибрати `|| phantom.length > 0` — усе зелене,
  // застарілий запис друкується, код виходу нуль.
  const V = (u, p, f = [{}]) => verdict({ found: f, unaccounted: u, phantom: p }).rc;
  is('усе названо — успіх', V([], []), 0);
  is('неназвана адреса — провал', V([{}], []), 1);
  is('застарілий запис — теж провал', V([], [{}]), 1);
  is('нуль знайдених — провал, а не тиша', V([], [], []), 1);

  // 🔴 `BINARY` НЕ СМІЄ КОВТАТИ ТЕКСТ. Рецензія дописала `|ya?ml` до
  // переліку розширень — самотест і живий прогін лишились зеленими, а
  // адреса, покладена в `.github/workflows/ci.yml`, стала невидимою.
  // Жоден запис переліку не прив'язаний до `.yml` чи `.env*`, тож
  // «фантомного» якоря, який це помітив би, там немає за побудовою.
  is('текстові розширення скануються',
    ['a.yml', 'b.yaml', 'c.env', '.env.example', 'd.md', 'e.ts', 'f.json', 'g.sh', 'h']
      .filter((f) => BINARY.test(f)), []);
  is('двійкові таки відкидаються',
    ['x.png', 'x.woff2', 'x.pbf', 'x.gz'].every((f) => BINARY.test(f)), true);

  const EXPECTED_CASES = 16;
  let rc = 0;
  if (cases.some((c) => !c)) rc = 1;
  if (cases.length !== EXPECTED_CASES) {
    console.error(`✗ виконано ${cases.length} випадків, очікувалось ${EXPECTED_CASES}`);
    rc = 1;
  }
  if (rc === 0) console.log(`✓ check-public-addresses self-test: ${cases.length} випадків`);
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
  const action = chooseAction(process.argv.slice(2), ['--self-test'], 'check-public-addresses.mjs');
  if (action.has('--self-test')) process.exit(selfTest());
  process.exit(live());
}
