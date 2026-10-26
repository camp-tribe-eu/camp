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

  for (const t of probe.tags) {
    if (t.status !== 200) {
      problems.push(
        `гачок ?tag=${t.name} відповів ${t.status} замість 200` +
          (t.note ? ` (${t.note})` : ''),
      );
    }
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
      { tags: [ok], servedHash: 'aa', liveHash: 'bb', liveCount: 6 }, 1],
    ['проб не зроблено — збір зламався', { tags: [] }, 1],
    ['джерело мовчить', { tags: [ok], servedHash: 'aa' }, 1],
    ['джерело віддало порожнє меню', { tags: [ok], servedHash: 'aa', liveHash: 'bb', liveCount: 0 }, 1],
    ['мітка стану недосяжна', { tags: [ok], liveHash: 'bb', liveCount: 6 }, 1],
  ];
  let pass = 0, fail = 0;
  for (const [name, probe, want] of cases) {
    const got = audit(probe).length;
    if (got === want) pass++;
    else { fail++; console.error(`  ✗ ${name}: скарг ${got}, чекали ${want}`); }
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
      tags.push({ status: res.status, name });
    } catch (e) {
      tags.push({ status: 0, name, note: e.message });
    }
  }

  const probe = { tags };

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
