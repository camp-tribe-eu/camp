#!/usr/bin/env node
// CAMP-394: забрати фід DATAtourisme із вебсервісу — без людини з мишкою.
//
// Запуск:
//   DATATOURISME_FEED_URL=… node scripts/datatourisme/fetch-feed.mjs <вихід.zip>
//   node scripts/datatourisme/fetch-feed.mjs --self-test
//
// 🔴 ОДИН СЕКРЕТ, А НЕ ДВА ШМАТКИ. Адреса вебсервісу має вигляд
// `…/webservice/<ідентифікатор-фіду>/<app_key>`, і обидві половини разом
// дають доступ. Тримаємо їх ОДНИМ значенням у `apps/api/.env`, бо
// розділені вони спокушають надрукувати «лише ідентифікатор, він же не
// секрет» — а він секрет рівно настільки ж.
//
// 🔴 І НІКОЛИ НЕ АРГУМЕНТОМ КОМАНДИ. 26.10.2026 я злив ключ саме так:
// поклав у `-H` і надрукував, «який спосіб пробую». Аргументи видно і в
// `ps`, і в історії оболонки, і у виводі. Звідси — тільки оточення.
import { createWriteStream, createReadStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

/** gzip і ZIP — за першими байтами, бо заголовок сервера бреше. */
export const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
export const ZIP_MAGIC = Buffer.from([0x50, 0x4b]);

/**
 * Що це за файл — за його ПЕРШИМИ БАЙТАМИ, а не за `content-type`.
 *
 * 🔴 Заміряно 26.10.2026 на справжньому вебсервісі: він віддає
 * `content-type: application/zip;charset=UTF-8`, а тіло починається на
 * `1f 8b`, тобто це ZIP, ЗАГОРНУТИЙ У GZIP. Та сама пастка описана в
 * `apps/api/src/datatourisme/feed-archive.ts` — і там вона коштувала
 * дня. Заголовку не вірити.
 */
export function magicOf(head) {
  const b = Buffer.from(head);
  if (b.subarray(0, 2).equals(GZIP_MAGIC)) return 'gzip';
  if (b.subarray(0, 2).equals(ZIP_MAGIC)) return 'zip';
  return 'невідоме';
}

/**
 * Чи варто взагалі писати це на диск.
 *
 * 🔴 ВІДМОВА НА HTML — НЕ ПРИДИРКА. Протермінований ключ дає не 401, а
 * сторінку входу з кодом 200. Без цієї перевірки ми записали б її під
 * іменем архіву, і наступний крок конвеєра сказав би «архів пошкоджено»
 * — за два кроки від справжньої причини.
 */
export function verdict({ status, magic, bytes }) {
  if (status !== 200) return `сервер відповів ${status}`;
  if (magic === 'невідоме')
    return 'тіло не є ні ZIP, ні gzip — найпевніше сторінка входу замість архіву (ключ протермінований?)';
  if (bytes < 1024 * 1024)
    return `архів лише ${bytes} Б — фід такого розміру не буває, це не він`;
  return null;
}

async function firstBytes(path, n = 4) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    await fh.read(buf, 0, n, 0);
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * Завантажити фід у `target`.
 *
 * 🔴 ЧЕРЕЗ `.part` І `rename`, А НЕ ПРЯМО В ЦІЛЬ. CAMP-398: обрив
 * посеред тіла затирає попередній цілий архів до нуля, бо
 * `createWriteStream(target)` зрізає файл ще до першого байта. `rename`
 * у межах файлової системи атомарний: на диску або старий цілий, або
 * новий цілий, третього немає.
 */
export async function fetchFeed(url, target, fetchImpl = fetch) {
  const raw = `${target}.part`;
  const res = await fetchImpl(url);
  if (res.status !== 200) {
    throw new Error(verdict({ status: res.status, magic: 'невідоме', bytes: 0 }));
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(raw));

  // 🔴 ПОРІГ РОЗМІРУ — НА ГОТОВОМУ АРХІВІ, А НЕ НА ЗАВАНТАЖЕНОМУ. Першу
  // редакцію я перевіряв на стиснутому файлі, і власний тест шляху це
  // спіймав: 2 МБ набивки стискаються до 2 КБ, тобто правильний архів
  // відхилявся як «замалий». На справжньому фіді (99 МБ стиснутих проти
  // 810 МБ розгорнутих) помилка не спливла б — а отже жила б.
  const magic = magicOf(await firstBytes(raw));
  const bad = verdict({ status: 200, magic, bytes: Infinity });
  if (bad) {
    await rm(raw, { force: true });
    throw new Error(bad);
  }

  if (magic === 'gzip') {
    // 🔴 Розгортаємо ТУТ, бо `feed-archive.ts` читати gzip відмовляється
    // навмисно (`assertNotGzipped`). Лишити як є означало б покласти на
    // диск файл, який наш власний імпортер не візьме.
    const unzipped = `${target}.unz`;
    await pipeline(createReadStream(raw), createGunzip(), createWriteStream(unzipped));
    await rm(raw, { force: true });
    const m2 = magicOf(await firstBytes(unzipped));
    if (m2 !== 'zip') {
      await rm(unzipped, { force: true });
      throw new Error(`після розгортання gzip це не ZIP, а ${m2}`);
    }
    await rename(unzipped, target);
  } else {
    await rename(raw, target);
  }
  // Поріг — тут, коли на диску вже справжній архів.
  const final = (await stat(target)).size;
  const tooSmall = verdict({ status: 200, magic: 'zip', bytes: final });
  if (tooSmall) throw new Error(tooSmall);
  return final;
}

function selfTest() {
  // 🔴 РАХУНОК У СПІЛЬНОМУ ОБʼЄКТІ, А НЕ В ЛОКАЛЬНИХ ЧИСЛАХ. Перша
  // редакція повертала `{pass, fail}` — копії чисел, — тож падіння в
  // тестах шляху не змінювало ні підсумку, ні коду виходу. Самотест,
  // який не вміє почервоніти, — це той самий мовчазний провал, проти
  // якого він і написаний.
  const t = { pass: 0, fail: 0 };
  const ok = (name, cond) =>
    cond ? (t.pass += 1) : ((t.fail += 1), console.error(`  ✗ ${name}`));
  t.ok = ok;

  ok('магія gzip', magicOf(Buffer.from([0x1f, 0x8b, 0, 0])) === 'gzip');
  ok('магія zip', magicOf(Buffer.from([0x50, 0x4b, 3, 4])) === 'zip');
  ok('магія html — невідоме', magicOf(Buffer.from('<!DO')) === 'невідоме');

  ok('200 + zip + великий — приймаємо',
    verdict({ status: 200, magic: 'zip', bytes: 900e6 }) === null);
  ok('🔴 200 + HTML — відмова про ключ',
    (verdict({ status: 200, magic: 'невідоме', bytes: 5000 }) ?? '').includes('сторінка входу'));
  ok('🔴 200 + крихітний архів — відмова',
    (verdict({ status: 200, magic: 'zip', bytes: 100 }) ?? '').includes('не буває'));
  ok('не-200 — відмова з кодом',
    (verdict({ status: 403, magic: 'zip', bytes: 900e6 }) ?? '').includes('403'));

  return t;
}

// 🔴 ЧИСТІ ФУНКЦІЇ — ЩЕ НЕ ШЛЯХ. Усе вище перевіряє рішення, а не
// завантаження. Саме така прогалина 26.10.2026 пропустила мертвий
// сповіщувач: самотест зелений, а надіслати він не міг. Тому нижче —
// справжній `fetchFeed` із підробленим `fetch` і справжнім диском.
async function ioTest(t) {
  const { ok } = t;
  const { mkdtemp, writeFile, readFile, stat: st } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { gzipSync } = await import('node:zlib');
  const dir = await mkdtemp(join(tmpdir(), 'feedtest-'));
  const target = join(dir, 'feed.zip');

  // Найменший правдоподібний «архів»: сигнатура ZIP плюс набивка, щоб
  // пройти поріг розміру.
  const zip = Buffer.concat([ZIP_MAGIC, Buffer.alloc(2 * 1024 * 1024, 0x41)]);
  const body = (buf) => ({
    status: 200,
    body: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(buf));
        c.close();
      },
    }),
  });

  const n1 = await fetchFeed('x', target, async () => body(zip));
  ok('шлях: звичайний ZIP лягає на диск', n1 === zip.length);
  ok('шлях: .part не лишається', !(await st(`${target}.part`).catch(() => null)));

  const n2 = await fetchFeed('x', target, async () => body(gzipSync(zip)));
  ok('🔴 шлях: gzip розгортається у ZIP', n2 === zip.length);
  ok('шлях: на диску саме ZIP',
    magicOf(await readFile(target).then((b) => b.subarray(0, 4))) === 'zip');
  ok('шлях: .unz не лишається', !(await st(`${target}.unz`).catch(() => null)));

  // 🔴 Протермінований ключ дає сторінку входу з кодом 200.
  const html = Buffer.from('<!DOCTYPE html><html>Sign in</html>');
  let said = '';
  await fetchFeed('x', target, async () => body(html)).catch((e) => (said = e.message));
  ok('🔴 шлях: HTML відхилено з натяком на ключ', said.includes('сторінка входу'));
  ok('🔴 шлях: попередній архів ЦІЛИЙ після відмови',
    (await st(target)).size === zip.length);
  // 🔴 Мутація «не прибирати .part» виживала, бо після УСПІХУ його й так
  // забирає `rename`. Значення має саме шлях ПОМИЛКИ: там `.part` лишився
  // б назавжди й накопичувався б із кожною невдалою спробою.
  ok('🔴 шлях: .part прибрано і після ВІДМОВИ',
    !(await st(`${target}.part`).catch(() => null)));

  await rm(dir, { recursive: true, force: true });
}

async function runSelfTest() {
  const t = selfTest();
  await ioTest(t);
  console.log(`fetch-feed self-test: ran ${t.pass + t.fail}, passed ${t.pass}, failed ${t.fail}`);
  process.exit(t.fail === 0 ? 0 : 1);
}

async function main(argv) {
  if (argv.includes('--self-test')) return runSelfTest();
  const target = argv.find((a) => !a.startsWith('--'));
  const url = process.env.DATATOURISME_FEED_URL;
  if (!url) {
    throw new Error(
      'DATATOURISME_FEED_URL не задано. Вона живе в apps/api/.env, який у git\n' +
        'не лежить. 🔴 Ніколи не передавай її аргументом — оболонка пам’ятає історію,\n' +
        'а `ps` показує аргументи всім на машині.',
    );
  }
  if (!target) throw new Error('usage: fetch-feed.mjs <вихід.zip>');
  const bytes = await fetchFeed(url, target);
  console.log(`фід на місці: ${target}, ${(bytes / 1e6).toFixed(1)} МБ`);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`✗ ${e.message}`);
  process.exit(1);
});
