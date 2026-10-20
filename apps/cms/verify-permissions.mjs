// CAMP-89 verification: log in as a test editor and see what they can
// actually reach.
//
// The card is explicit that this must be checked "входом під ним, а не за
// налаштуваннями" - by signing in, not by reading the settings screen. A
// permissions matrix that looks right and behaves differently is the normal
// failure mode, so this asserts behaviour.
//
//   cd apps/cms && node verify-permissions.mjs
//
// Creates a throwaway user, tests, and deletes it again. Safe to re-run,
// and worth re-running on staging and production after every config change.

import 'dotenv/config';
import { randomUUID } from 'node:crypto';

const BASE = process.env.PUBLIC_URL ?? 'http://localhost:8055';
// example.com is reserved by RFC 2606 for exactly this, and unlike
// `.invalid` it passes Directus's email validator.
const TEST_EMAIL = `camp89-test-editor@example.com`;

let adminToken;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

async function adminCall(method, path, body) {
  const r = await call(method, path, { token: adminToken, body });
  if (r.status >= 400) {
    throw new Error(`${method} ${path} → ${r.status}: ${JSON.stringify(r.json?.errors?.[0]?.message ?? r.json)}`);
  }
  return r.json?.data;
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
}

async function main() {
  // --- admin session ------------------------------------------------------
  const login = await call('POST', '/auth/login', {
    body: { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD },
  });
  adminToken = login.json?.data?.access_token;
  if (!adminToken) throw new Error('admin login failed');

  const roles = await adminCall('GET', '/roles?filter[name][_eq]=Editor&limit=1');
  const editorRole = roles?.[0];
  if (!editorRole) throw new Error('Editor role not found — run configure.mjs first');

  // --- throwaway editor ---------------------------------------------------
  const password = randomUUID() + 'Aa1!';
  const existing = await adminCall(
    'GET',
    `/users?filter[email][_eq]=${encodeURIComponent(TEST_EMAIL)}&limit=1`,
  );
  if (existing?.[0]) await adminCall('DELETE', `/users/${existing[0].id}`);

  const testUser = await adminCall('POST', '/users', {
    email: TEST_EMAIL,
    password,
    role: editorRole.id,
    first_name: 'CAMP-89',
    last_name: 'Test Editor',
    status: 'active',
  });

  const editorLogin = await call('POST', '/auth/login', {
    body: { email: TEST_EMAIL, password },
  });
  const token = editorLogin.json?.data?.access_token;
  if (!token) throw new Error('test editor could not log in');

  console.log(`\nSigned in as ${TEST_EMAIL} (role: Editor)\n`);

  // --- what they must NOT reach ------------------------------------------
  console.log('Must be invisible:');
  // 🔴 ДВА ОСТАННІ — НЕЗАРЕЄСТРОВАНІ, І САМЕ ТОМУ ВОНИ ТУТ.
  //
  // Заміряно 20.10.2026 на локальній базі: з 41 не-directus таблиці 21
  // зареєстрована (має рядок у `directus_collections`), 20 — ні. Серед
  // тих 20 лежать `auth_tokens` і `sessions`, тобто найчутливіше, що
  // в нас є, — а перелік цього сторожа містив лише ЗАРЕЄСТРОВАНІ й
  // приховані таблиці. Тобто він доводив один шлях і мовчав про другий.
  //
  // Механізм, схоже, спільний: `directus_permissions` має 40 рядків на
  // 15 колекцій, і для жодної з перелічених тут немає ЖОДНОГО гранта,
  // а Directus відмовляє за замовчуванням. Але «схоже» це висновок із
  // будови, не прогін. Нехай тепер буде прогін.
  //
  // Якщо котрась із двох колись віддасть 200 — це не косметика й не
  // питання ліміту колекцій: це відкриті токени сесій.
  // 🔴 `osm_camping_staging` ЗВІДСИ ПРИБРАНО, І ЦЕ НЕ ПОСЛАБЛЕННЯ.
  //
  // Рецензія PR #296 довела, що та перевірка була ПОРОЖНЬОЮ: цієї
  // таблиці немає в базі (її створює конвеєр OSM, а не міграції), а
  // Directus на відсутню колекцію відповідає тим самим 403 із текстом
  // «…or it does not exist». Тобто вона зеленіла і з грантом, і без
  // нього, і взагалі без таблиці — а `configure.mjs` посилався на неї
  // як на доказ, що зняття реєстрації не відкриває доступу.
  //
  // Доказ тепер несуть `trip_stops`, `auth_tokens` і `sessions`: вони
  // ІСНУЮТЬ у базі й НЕ зареєстровані. Рецензія перевірила їх мутацією
  // — видала Editor-політиці `read` на всі три, і всі три віддали 200,
  // вивід став `❌ 9/12`. Отже перевірка справді червоніє.
  for (const collection of [
    'users',
    'trips',
    'trip_stops',
    'auth_tokens',
    'sessions',
  ]) {
    const r = await call('GET', `/items/${collection}?limit=1`, { token });
    check(
      `cannot read ${collection}`,
      r.status === 403,
      r.status === 403 ? 'forbidden' : `got ${r.status}`,
    );
  }

  // --- read-only ----------------------------------------------------------
  console.log('\nRead-only (produced by the pipeline):');
  const spotsRead = await call('GET', '/items/camping_spots?limit=1', { token });
  check('can read camping_spots', spotsRead.status === 200, `status ${spotsRead.status}`);

  const spotsWrite = await call('POST', '/items/camping_spots', {
    token,
    body: { name: 'should not be creatable' },
  });
  check(
    'cannot create camping_spots',
    spotsWrite.status === 403,
    spotsWrite.status === 403 ? 'forbidden' : `got ${spotsWrite.status}`,
  );

  // --- what they must be able to do --------------------------------------
  console.log('\nEditorial work must succeed:');
  const slug = `camp89-verify-${Date.now()}`;
  // 🔴 `provenance` ОБОВʼЯЗКОВЕ, і без нього це 400, а не 403.
  //
  // Заміряно 20.10.2026 на живому Directus: ця перевірка падала з
  // `status 400`, і виглядало це як проблема дозволів. Насправді
  // міграція `1790313600000-GuideProvenance` зробила колонку NOT NULL
  // без значення за замовчуванням — свідомо, бо «гайд без походження це
  // гайд, який нам не можна публікувати» (ст. 50 AI Act).
  //
  // Тобто сторож був зламаний відтоді й доти, бо його НІХТО НЕ
  // ЗАПУСКАВ: у `.github/workflows/` він не згадується жодного разу,
  // лише в README. Перевірка, яку треба згадати запустити, — це не
  // перевірка. Винесено в CAMP-362 окремим пунктом.
  const created = await call('POST', '/items/guides', {
    token,
    body: {
      slug,
      category: 'verification',
      status: 'draft',
      // 🔴 І ЦЬОГО ТЕЖ МАЛО. Поверх NOT NULL стоїть CHECK
      // `CHK_guides_provenance_is_accountable`: при `human` обовʼязковий
      // `author_name`, інакше — `generator`. Тобто схема не дає створити
      // гайд, за який ніхто не відповідає.
      //
      // Беремо НЕлюдську гілку, бо це правда: рядок створює скрипт.
      // Вдавати `human` з вигаданим автором означало б обійти саме те
      // обмеження, яке ми тут і перевіряємо.
      provenance: 'ai-generated',
      generator: 'verify-permissions.mjs',
    },
  });
  check('can create a guide', created.status === 200, `status ${created.status}`);

  const guideId = created.json?.data?.id;
  if (guideId) {
    const updated = await call('PATCH', `/items/guides/${guideId}`, {
      token,
      body: { category: 'verification-updated' },
    });
    check('can update a guide', updated.status === 200, `status ${updated.status}`);

    // Deleting is not granted: editors archive, they do not erase.
    const deleted = await call('DELETE', `/items/guides/${guideId}`, { token });
    check(
      'cannot delete a guide',
      deleted.status === 403,
      deleted.status === 403 ? 'forbidden' : `got ${deleted.status}`,
    );
    await adminCall('DELETE', `/items/guides/${guideId}`);
  }

  // --- moderation belongs to the other role ------------------------------
  console.log('\nModeration is a different role:');
  const modRead = await call('GET', '/items/photo_submissions?limit=1', { token });
  check(
    'editor cannot read photo_submissions',
    modRead.status === 403,
    modRead.status === 403 ? 'forbidden' : `got ${modRead.status}`,
  );

  // --- cleanup ------------------------------------------------------------
  await adminCall('DELETE', `/users/${testUser.id}`);

  const failed = results.filter((r) => !r.passed);
  console.log(
    `\n${failed.length === 0 ? '✅' : '❌'} ${results.length - failed.length}/${results.length} checks passed\n`,
  );
  // 🔴 Назвати, чого тут НЕМАЄ. Цей скрипт входить лише під Editor, і
  // «N/N passed» без цього рядка читається як «ролі перевірено», хоча
  // Moderator не торкнувся жоден чек. Свідок, який мовчить про межі
  // свого погляду, створює хибне відчуття покриття — CAMP-362 додає
  // решту ролей, а до того цей рядок тримає читача в правді.
  console.log(
    '   ⚠️  Covered: Editor only. Moderator is NOT verified here — CAMP-362.\n',
  );
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exitCode = 1;
});
