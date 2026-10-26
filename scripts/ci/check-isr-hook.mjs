#!/usr/bin/env node
// Гачок, який відповідає 200 і нічого не скидає, — це мовчазний провал.
//
// 🔴 ЧОМУ ЦЕЙ СТОРОЖ, І ЧОМУ НЕ «ЧИ Є ЕНДПОЙНТ». CAMP-363 називає
// найгірший спосіб помилитись: власник зберіг — сайт не оновився — і
// ніхто про це не сказав. Перевірка «обробник відповідає» цього не
// бачить. Заміряно 26.10.2026, і дефект був саме такий: обробник лежав
// за адресою /api/revalidate, увесь префікс /api Caddy віддає в Nest,
// тож гачок ішов у чужий застосунок, діставав 404 і не скидав нічого.
// Жодна помилка при цьому не виникала ніде.
//
// Тому сторож питає ДВІ різні речі:
//
//   1. Проба справжньою ПУБЛІЧНОЮ адресою — тією самою, якою ходить
//      Directus, через Caddy і через передзапускові ворота. Це ловить
//      неправильний маршрут, чужий порт, зниклий секрет і зміну воріт.
//      Локальний виклик повз Caddy не впіймав би нічого з цього.
//
//   2. Звірка хешів: що Next віддає з кешу проти того, що зараз у
//      джерелі. Це ловить випадок «200 віддано, а кеш не скинувся».
//
// 🔴 МЕЖА ДРУГОЇ ПЕРЕВІРКИ, І ЗАМОВЧУВАТИ ЇЇ НЕ МОЖНА. Коли в CMS нічого
// не змінювалось, хеші збігаються і при справному, і при зламаному
// скиданні. Тобто п.2 доводить справність лише тоді, коли є що
// оновлювати. Повний доказ дає ручний замір із картки: змінити рядок у
// CMS і назвати секунди. Сторож прикриває проміжок між такими замірами,
// а не заміняє їх.
//
// 🔴 ЧОМУ РОЗБІЖНІСТЬ ХЕШІВ БЕЗПЕЧНА З БОКУ ПОМИЛКИ. Канонічний вигляд
// («JSON.stringify` переліку пунктів шапки») написаний двічі: тут і в
// `app/internal/content-stamp/route.ts`. Якби копії розійшлись, хеші
// НЕ СХОДИЛИСЬ БИ НІКОЛИ, і сторож світив би червоним постійно — тобто
// розходження видно відразу, а не тоді, коли воно знадобиться.

const SELF_TEST = process.argv.includes('--self-test');

/** Чисте ядро: приймає замір, віддає перелік скарг. Самотест міряє його. */
export function audit(probe) {
  const problems = [];

  // 🔴 ВІДСУТНІЙ ЗАМІР — ЦЕ ПРОВАЛ, А НЕ «ПРИПУСТИМО, ЩО ДОБРЕ».
  // Порожній перелік проб означає, що збір зламався, і мовчазне «жодної
  // скарги» тут було б рівно тим дефектом, проти якого стоїть сторож.
  if (!Array.isArray(probe?.tags) || probe.tags.length === 0) {
    problems.push('проб не зроблено жодної — збір заміру зламався');
    return problems;
  }

  // 🔴 ВІДМОВА ВОРІТ І ВІДМОВА ГАЧКА — ЦЕ РІЗНІ ДІАГНОЗИ.
  //
  // Поки сайт закритий передзапусковим паролем, Caddy відповідає 401 ДО
  // того, як запит побачить Next. Назвати це «невірний секрет» означало б
  // відправити власника лагодити не те. Відрізняємо за тілом: наш обробник
  // завжди віддає JSON із полем `error` або `revalidated`; ворота — ні.
  if (probe.gateBlind) {
    problems.push(
      'ворота відмовили, а пароля воріт (CAMPTRIBE_GATE_BASIC_AUTH) немає — ' +
        'публічний шлях перевірити НЕМОЖЛИВО. Це не «все добре», це ' +
        'відсутність перевірки, тож провал.',
    );
    return problems;
  }

  for (const t of probe.tags) {
    if (t.status === 200) continue;
    if (t.gateRefused) {
      problems.push(
        `ворота Caddy не пустили пробу ?tag=${t.name} (${t.status}) — ` +
          'лагодити треба пароль воріт, а не гачок',
      );
      continue;
    }
    problems.push(
      `гачок ?tag=${t.name} відповів ${t.status} замість 200` +
        (t.note ? ` (${t.note})` : ''),
    );
  }

  if (typeof probe.liveCount !== 'number') {
    problems.push('джерело не відповіло — звірити кеш нема з чим');
    return problems;
  }
  if (probe.liveCount === 0) {
    // Не провал гачка: зламане саме джерело. Називаємо окремо, щоб не
    // відправити людину лагодити не те.
    problems.push('джерело віддало 0 пунктів меню — це дефект джерела, не гачка');
    return problems;
  }

  if (typeof probe.servedHash !== 'string' || probe.servedHash === '') {
    problems.push('мітка стану не віддала хеш — /internal/content-stamp недосяжна');
    return problems;
  }

  if (probe.servedHash !== probe.liveHash) {
    problems.push(
      'скидання мітки не спрацювало: після виклику гачка Next досі віддає ' +
        `інший вміст, ніж джерело (кеш ${probe.servedHash.slice(0, 12)}…, ` +
        `джерело ${String(probe.liveHash).slice(0, 12)}…)`,
    );
  }

  return problems;
}

// ── самотест ───────────────────────────────────────────────────────────
if (SELF_TEST) {
  const ok = { name: 'navigation', status: 200 };
  const cases = [
    ['усе справне', { tags: [ok], servedHash: 'aa', liveHash: 'aa', liveCount: 6 }, 0],
    ['гачок 404 (той самий дефект, що знайдено 26.10)',
      { tags: [{ name: 'navigation', status: 404 }], servedHash: 'aa', liveHash: 'aa', liveCount: 6 }, 1],
    ['гачок 401 — чужий секрет',
      { tags: [{ name: 'navigation', status: 401 }], servedHash: 'aa', liveHash: 'aa', liveCount: 6 }, 1],
    ['гачок 503 — секрета немає на машині',
      { tags: [{ name: 'navigation', status: 503 }], servedHash: 'aa', liveHash: 'aa', liveCount: 6 }, 1],
    ['дві мітки, зламана одна',
      { tags: [ok, { name: 'pages', status: 400 }], servedHash: 'aa', liveHash: 'aa', liveCount: 6 }, 1],
    ['200 є, але кеш не скинувся — мовчазний провал',
      { tags: [ok], servedHash: 'aa', liveHash: 'bb', liveCount: 6 }, 1, 'скидання мітки не спрацювало'],
    // 🔴 Три випадки про ворота. Без них гілка, що відрізняє відмову
    // воріт від відмови гачка, не перевірялась нічим — а саме вона
    // вирішує, куди власник піде лагодити.
    ['ворота відмовили, пароля воріт немає — перевірити НЕМОЖЛИВО',
      { tags: [{ name: 'navigation', status: 401, gateRefused: true }], gateBlind: true,
        servedHash: 'aa', liveHash: 'aa', liveCount: 6 }, 1, 'НЕМОЖЛИВО'],
    ['ворота відмовили, але пароль заданий — скарга саме на ворота',
      { tags: [{ name: 'navigation', status: 401, gateRefused: true }],
        servedHash: 'aa', liveHash: 'aa', liveCount: 6 }, 1, 'ворота Caddy не пустили'],
    ['401 від САМОГО гачка (тіло наше) — це вже про секрет',
      { tags: [{ name: 'navigation', status: 401, gateRefused: false }],
        servedHash: 'aa', liveHash: 'aa', liveCount: 6 }, 1, 'гачок ?tag=navigation відповів 401'],
    ['проб не зроблено — збір зламався', { tags: [] }, 1],
    ['джерело мовчить', { tags: [ok], servedHash: 'aa' }, 1],
    ['джерело віддало порожнє меню', { tags: [ok], servedHash: 'aa', liveHash: 'bb', liveCount: 0 }, 1],
    ['мітка стану недосяжна', { tags: [ok], liveHash: 'bb', liveCount: 6 }, 1],
  ];
  // 🔴 ЗВІРЯЄМО ТЕКСТ СКАРГИ, А НЕ ЛИШЕ КІЛЬКІСТЬ.
  //
  // Перша редакція рахувала `problems.length`, і три випадки про ворота
  // були СЛІПІ: кількість лишалась 1, хоч яка саме скарга спрацювала.
  // Заміряно 26.10.2026 — обидві мутації (прибрати зупинку на `gateBlind`
  // і назвати відмову воріт відмовою гачка) пережили зелений прогін
  // 13/13. Рівно та пастка, яку рецензія #344 знайшла в сусідньому
  // сторожі; я вступив у неї наступною ж правкою.
  let pass = 0, fail = 0;
  for (const [name, probe, want, mustSay] of cases) {
    const got = audit(probe);
    const countOk = got.length === want;
    const textOk = !mustSay || got.some((p) => p.includes(mustSay));
    if (countOk && textOk) pass++;
    else {
      fail++;
      if (!countOk) console.error(`  ✗ ${name}: скарг ${got.length}, чекали ${want}`);
      else console.error(`  ✗ ${name}: жодна скарга не містить «${mustSay}» — було: ${got.join(' | ')}`);
    }
  }
  console.log(`check-isr-hook self-test: ran ${pass + fail}, passed ${pass}, failed ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

// ── живий замір ────────────────────────────────────────────────────────
const SITE = process.env.CAMPTRIBE_SITE ?? 'https://camptribe.eu';
const API = process.env.CAMPTRIBE_API ?? 'http://127.0.0.1:3001';
const SECRET = process.env.REVALIDATE_SECRET ?? '';
// Передзапускові ворота в Caddy стоять НАД усім сайтом, тож проба мусить
// нести і пароль воріт, і секрет гачка. Коли сайт відкриють, змінної не
// стане, а заголовок просто перестане бути потрібним.
// 🔴 НЕ `CAMPTRIBE_GATE`. Ця назва вже зайнята й означає ШЛЯХ до
// `gate.conf` (`infra/bin/camptribe-launch:44`, `infra/move-table.sh:231`,
// де з нею роблять `readlink -f` і `ln -sfn`). Однакове ім'я з двома
// несумісними типами в одному оточенні — міна, знайдена рецензією #344.
const GATE = process.env.CAMPTRIBE_GATE_BASIC_AUTH ?? '';

const headers = () => {
  const h = { 'x-revalidate-secret': SECRET };
  if (GATE) h.authorization = `Basic ${Buffer.from(GATE).toString('base64')}`;
  return h;
};

async function main() {
  if (SECRET === '') {
    console.error(
      '✗ REVALIDATE_SECRET не заданий сторожу. Це не «нічого перевіряти» — ' +
        'це неможливість перевірити, тож провал.',
    );
    process.exit(1);
  }

  const tags = [];
  for (const name of ['navigation', 'pages']) {
    try {
      const res = await fetch(`${SITE}/internal/revalidate?tag=${name}`, {
        method: 'POST',
        headers: headers(),
      });
      // Наше тіло — JSON із `error` або `revalidated`. Усе інше при
      // ненульовій відмові означає, що відповів не Next, а ворота перед ним.
      let ours = false;
      try {
        const b = await res.json();
        ours = b !== null && typeof b === 'object' && ('error' in b || 'revalidated' in b);
      } catch { ours = false; }
      tags.push({ status: res.status, name, gateRefused: res.status !== 200 && !ours });
    } catch (e) {
      tags.push({ status: 0, name, note: e.message });
    }
  }

  const probe = { tags, gateBlind: GATE === '' && tags.some((t) => t.gateRefused) };

  try {
    const res = await fetch(`${SITE}/internal/content-stamp`, { headers: headers() });
    if (res.ok) {
      const body = await res.json();
      probe.servedHash = body.navHash;
    }
  } catch { /* лишається undefined — ядро скаржиться саме на це */ }

  try {
    const res = await fetch(`${API}/navigation`);
    if (res.ok) {
      const body = await res.json();
      const items = body.header ?? [];
      const { createHash } = await import('node:crypto');
      probe.liveHash = createHash('sha256').update(JSON.stringify(items)).digest('hex');
      probe.liveCount = items.length;
    }
  } catch { /* лишається undefined */ }

  const problems = audit(probe);
  for (const p of problems) console.error(`✗ ${p}`);
  if (problems.length === 0) {
    console.log(
      `✓ гачок ISR живий: ${tags.map((t) => `${t.name}=${t.status}`).join(', ')}, ` +
        `кеш збігається з джерелом (${probe.liveCount} пунктів меню)`,
    );
  }
  process.exit(problems.length === 0 ? 0 : 1);
}

main();
