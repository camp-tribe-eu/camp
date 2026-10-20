// CAMP-89: Directus roles, policies and collection visibility as code.
//
// Why a script and not clicking in the UI: staging and production must end
// up with the same permissions as local, and "someone configured it once"
// is not a thing you can review, diff or repeat. Run it as many times as
// you like - it is idempotent.
//
//   cd apps/cms && node configure.mjs
//
// Schema (tables, columns, constraints) is NOT touched here. That belongs
// to the TypeORM migrations in apps/api, which stay the single source of
// truth for DDL - see CAMP-89 and the Directus licence note in CAMP-62.

import 'dotenv/config';

const BASE = process.env.PUBLIC_URL ?? 'http://localhost:8055';

/**
 * Tables Directus auto-detects but nobody should edit through it.
 *
 * 🔴 `users` is the important one: it holds password hashes for site
 * visitors. Directus exposing it by default is exactly the kind of thing
 * that is nobody's fault until it is everybody's problem.
 */
const HIDDEN = {
  users: 'Site visitors — password hashes. Managed by the API, never here.',
  trips: 'Private user data. Managed by the API.',
};

/**
 * 🔴 ТАБЛИЦІ, ЯКІ МИ НАВМИСНО НЕ РЕЄСТРУЄМО ВЗАГАЛІ.
 *
 * Заміряно 20.10.2026 на живому Directus: приховування таблиці її
 * РЕЄСТРУЄ, тобто кожен рядок у `HIDDEN` коштує місця в ліміті. Із
 * вісьмома колекціями моделі контенту (CAMP-362) вийшло 28 при стелі
 * Core 25 — перебір на три.
 *
 * Ці три не дають нічого, що варте місця: редактор їх не бачить ні так,
 * ні так, а адмін і без реєстрації знайде їх у Data Model.
 *
 * 🔴 І ДОСТУП ВІД РЕЄСТРАЦІЇ НЕ ЗАЛЕЖИТЬ. Заміряно там само:
 * `directus_permissions` має 40 рядків на 15 колекцій, і для жодної з
 * цих таблиць немає ЖОДНОГО гранта — Directus відмовляє за
 * замовчуванням. Саме тому `osm_camping_staging` і віддавав 403, а не
 * через прапорець `hidden`. `verify-permissions.mjs` тепер перевіряє це
 * прогоном, разом із `auth_tokens` і `sessions`, які незареєстровані від
 * початку.
 *
 * 🔴 НА ВЖЕ НАЛАШТОВАНОМУ ІНСТАНСІ цього замало: там вони лишаються
 * зареєстрованими, бо скрипт просто їх не чіпає. Зняти реєстрацію можна
 * ЛИШЕ видаленням рядка в `directus_collections` напряму:
 *
 *   DELETE FROM directus_collections
 *    WHERE collection IN ('migrations','osm_camping_staging','trip_stops');
 *
 * Вендорським `DELETE /collections/:key` — НІ: він дропає таблицю разом
 * із даними. Див. попередження в кроці 1.
 */
const NOT_REGISTERED = {
  trip_stops: 'Private user data, and `trips` beside it is already hidden.',
  migrations: 'TypeORM bookkeeping. Nobody edits it, nobody reads it here.',
  osm_camping_staging: 'Raw OSM staging, rebuilt weekly by the pipeline.',
  spatial_ref_sys: 'PostGIS internals — Directus does not even detect it.',
};

/** Editorial collections, with the icon and note an editor actually sees. */
const CONTENT = {
  guides: { icon: 'article', note: 'Guides and articles (CAMP-84).' },
  guide_translations: { icon: 'translate', note: 'One row per language.' },
  legal_pages: { icon: 'gavel', note: 'Privacy, terms, disclaimer, affiliate, attribution.' },
  legal_page_translations: { icon: 'translate', note: 'Plain-language summary is required (GDPR art. 12).' },
  camper_types: { icon: 'rv_hookup', note: 'Static camper categories. No prices — we have none.' },
  camper_type_translations: { icon: 'translate', note: 'One row per language.' },
  rental_cities: { icon: 'location_city', note: 'Publishes only past the threshold: 2 routes + 10 campsites + 1 local specific.' },
  rental_city_translations: { icon: 'translate', note: 'Local tips are the third leg of the publication threshold.' },
  featured_blocks: { icon: 'push_pin', note: 'Editorial picks for the home page.' },
  languages: { icon: 'language', note: 'A row here is not a launched locale.' },

  // ── CAMP-362: сторінки зі СЕКЦІЙ ─────────────────────────────────
  //
  // 🔴 Вісім колекцій, і це найбільший приріст за раз. Чому не менше:
  // кожна таблиця перекладів МУСИТЬ бути зареєстрована окремо, бо
  // інтерфейс Translations у Directus будується на звʼязку з
  // колекцією, а не з таблицею. Поля такого обмеження не мають — саме
  // тому типи секцій живуть полем `type` в ОДНІЙ `page_sections`, а не
  // дванадцятьма колекціями, як радить туторіал вендора.
  pages: { icon: 'web', note: 'Сторінки й дописи. Тип розрізняє їх, верстка та сама.' },
  page_translations: { icon: 'translate', note: 'Заголовок і опис — по рядку на мову.' },
  page_sections: {
    icon: 'view_agenda',
    note: 'Універсальні секції. Нового типу НЕ треба міграції — лише значення в `type`.',
  },
  page_section_translations: {
    icon: 'translate',
    note: 'Увесь текст секції, разом із повторюваними блоками в `items`.',
  },
  navigation: { icon: 'menu', note: 'Меню: шапка, підвал, мобільне. Пункт не може бути власним батьком.' },
  navigation_translations: { icon: 'translate', note: 'Підпис пункту — по рядку на мову.' },
  site_settings: {
    icon: 'settings',
    // 🔴 РІВНО ОДИН РЯДОК, і це тримає база: `UNIQUE(singleton)` плюс
    // `CHECK(singleton)`. `singleton: true` тут лише щоб адмінка
    // показувала форму, а не список із одного елемента — обмеження
    // живе в схемі, не в цьому прапорці.
    singleton: true,
    note: 'Пошта, соцмережі, підпис у підвалі. Рядок рівно один — так тримає база.',
  },
  site_settings_translations: {
    icon: 'translate',
    note: 'Слоган і примітка в підвалі — по рядку на мову.',
  },
};

/** Read-only for editors: produced by the pipeline, not by hand. */
const READ_ONLY = {
  camping_spots: { icon: 'camping', note: 'From OpenStreetMap, rebuilt weekly. Edit at the source, not here.' },
  routes: { icon: 'route', note: 'Curated routes.' },
  route_points: { icon: 'pin_drop', note: 'Stops along a route.' },
};

const MODERATION = {
  photo_submissions: { icon: 'photo_camera', note: 'Shoot date is mandatory and public. Rejections need a reason.' },
  reviews: { icon: 'reviews', note: 'Rejections need a reason the author can act on.' },
};

let token;

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = json?.errors?.[0]?.message ?? text;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return json?.data;
}

async function login() {
  const res = await fetch(BASE + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  const json = await res.json();
  if (!json.data?.access_token) {
    throw new Error('Admin login failed — check ADMIN_EMAIL / ADMIN_PASSWORD in apps/cms/.env');
  }
  token = json.data.access_token;
}

/**
 * 🔴 СПЕРШУ ПЕРЕКОНАТИСЬ, ЩО ЗА ІМЕНЕМ СТОЇТЬ ТАБЛИЦЯ.
 *
 * Заміряно 20.10.2026. Попередня редакція покладалась на 404 — і
 * коментар казав «таблиці ще немає, це не помилка, пропускаємо». Вендор
 * так не поводиться: `PATCH /collections/<ім'я>` для НЕІСНУЮЧОЇ таблиці
 * 404 не віддає, а створює колекцію-порожнявку (meta без schema).
 *
 * Як це виявилось: на свіжій базі в списку зареєстрованих опинився
 * `osm_camping_staging`, хоча таблиці там немає — її створює конвеєр
 * OSM, а не міграції. Тобто скрипт сам її й вигадав.
 *
 * 🔴 Ціна не в ліміті — там я помилявся, і рецензія PR #296 це
 * заміряла: вендор порожнявок не рахує (`isFolder = schema === null`).
 * Ціна в іншому: в адмінці зʼявляється ім'я без таблиці, за яким нічого
 * немає, а наш власний лічильник через нього розходився з вендорським.
 *
 * Тому: читаємо колекцію ДО запису й пропускаємо, коли `schema` порожня.
 */
async function setCollectionMeta(name, meta) {
  let existing;
  try {
    existing = await api('GET', `/collections/${name}`);
  } catch (err) {
    if (String(err).includes('404')) {
      console.log(`   ⏭  ${name} — no such table, skipped`);
      return false;
    }
    throw err;
  }

  // 🔴 `schema: null` означає «Directus знає ім'я, але таблиці за ним
  // немає». Реєструвати таке — означає створити порожнявку, яка коштує
  // місця в ліміті й не дає нічого.
  if (!existing?.schema) {
    console.log(`   ⏭  ${name} — meta without a table, skipped`);
    return false;
  }

  await api('PATCH', `/collections/${name}`, { meta });
  return true;
}

/** Finds an existing row by a field, so re-runs update instead of duplicating. */
async function findOne(collection, field, value) {
  const rows = await api(
    'GET',
    `/${collection}?filter[${field}][_eq]=${encodeURIComponent(value)}&limit=1`,
  );
  return rows?.[0] ?? null;
}

async function upsertPolicy(name, description) {
  const existing = await findOne('policies', 'name', name);
  if (existing) return existing.id;
  const created = await api('POST', '/policies', {
    name,
    description,
    icon: 'badge',
    app_access: true,
    admin_access: false,
    enforce_tfa: false,
  });
  return created.id;
}

async function upsertRole(name, description) {
  const existing = await findOne('roles', 'name', name);
  if (existing) return existing.id;
  const created = await api('POST', '/roles', { name, description, icon: 'group' });
  return created.id;
}

async function linkPolicy(roleId, policyId) {
  const rows = await api(
    'GET',
    `/access?filter[role][_eq]=${roleId}&filter[policy][_eq]=${policyId}&limit=1`,
  );
  if (rows?.length) return;
  await api('POST', '/access', { role: roleId, policy: policyId });
}

/**
 * Replaces this policy's permissions wholesale.
 *
 * Wholesale on purpose: adding without removing is how a policy silently
 * accumulates access nobody meant to grant.
 */
async function setPermissions(policyId, grants) {
  const existing = await api('GET', `/permissions?filter[policy][_eq]=${policyId}&limit=-1`);
  for (const p of existing ?? []) {
    await api('DELETE', `/permissions/${p.id}`);
  }
  const refused = [];
  for (const g of grants) {
    const body = {
      policy: policyId,
      collection: g.collection,
      action: g.action,
      fields: g.fields ?? ['*'],
      permissions: g.permissions ?? {},
      validation: g.validation ?? {},
    };
    try {
      await api('POST', '/permissions', body);
    } catch (err) {
      // 🔴 Narrowing a permission to named fields is a licensed feature.
      // On the free Core tier the server answers
      //   "custom_permission_rules_enabled is a restricted resource".
      //
      // 🔴 THIS USED TO WIDEN THE GRANT TO `fields: ['*']` AND COUNT IT.
      // Review (CAMP-361) named the consequence: a Moderator meant to edit
      // `status` and `rejection_reason` would get every field of `reviews`
      // and `photo_submissions` instead — including whatever a later
      // migration adds. The comment said "locally that is acceptable", and
      // the README says we run locally WITHOUT a key, so the widened state
      // was the normal one, not the exception.
      //
      // A fallback must fail toward the state somebody NOTICES. A missing
      // permission is loud: the moderator opens the screen and cannot
      // save. A widened one is silent and stays silent until it is abused.
      // So: create nothing, count it, and make the run fail.
      const restricted =
        String(err).includes('custom_permission_rules_enabled') ||
        String(err).includes('restricted resource');
      if (!restricted || !g.fields) throw err;
      refused.push(`${g.collection}.${g.action} (${g.fields.join(', ')})`);
    }
  }
  return refused;
}

/**
 * 🔴 УМОВНІ ПОЛЯ — ТЕ, ЗАРАДИ ЧОГО ОДНА КОЛЕКЦІЯ ЗАМІСТЬ ДВАНАДЦЯТИ.
 *
 * Пункт 3 «Способу перевірки» CAMP-362: обрав `type=faq` — поля hero
 * сховані. Без цього «універсальні секції» означали б форму, де
 * редактор бачить усі поля всіх типів одразу й сам здогадується, які
 * з них стосуються обраного. Тобто ми заощадили б колекції ціною того,
 * що адмінка стала б гіршою за патерн вендора — а сенс був зворотний.
 *
 * Формат умови в Directus: масив `{ rule, hidden }`, де `rule` це
 * звичайний фільтр по полях ТОГО Ж рядка.
 *
 * 🔴 Ховаємо, а не робимо обовʼязковими: приховане поле зберігає
 * значення, якщо воно там уже є. Редактор, що помилився типом і
 * повернув його назад, нічого не втрачає.
 */
const SECTION_FIELD_CONDITIONS = {
  image_url: {
    hiddenFor: ['faq', 'cards'],
    note: 'Картинка — у hero та медіа-секціях; у FAQ і картках її немає.',
  },
  cta_href: {
    hiddenFor: ['faq'],
    note: 'Кнопка з посиланням; у FAQ її немає.',
  },
};

/**
 * 🔴 УМОВ НА `page_section_translations` НЕМАЄ, І ЦЕ НЕ НЕДОРОБКА.
 *
 * Перша редакція ставила ті самі умови ще й на переклади — і вони не
 * могли спрацювати НІКОЛИ. Правило написане двадцятьма рядками вище:
 * `rule` це фільтр по полях ТОГО Ж рядка. А в рядку перекладу колонки
 * `type` немає зовсім — `1792200000000-ContentModel.ts` дає йому
 * id, section_id, language_code, heading, subheading, body, image_alt,
 * cta_label, items. Тип живе в БАТЬКІВСЬКОМУ рядку.
 *
 * Заміряно вендорським валідатором, яким адмінка й вирішує, ховати
 * поле (`@directus/utils`, `validatePayload(parseFilter(rule), values,
 * { requireAll: true }).length === 0`):
 *   page_sections, type=faq          → hidden = true
 *   переклад без колонки `type`      → hidden = false
 * `requireAll` робить кожен ключ обовʼязковим, тож відсутнє поле це не
 * «умова не підійшла», а «умова не виконалась» — завжди.
 *
 * Тобто форма перекладу показувала б `items` і `cta_label` при будь-якому
 * типі, а скрипт друкував би, що сховав їх. Друкований рядок — підпис,
 * а не перевірка.
 *
 * Наслідок для картки сказано вголос, а не замовчано: пункт 3 «Способу
 * перевірки» виконується для полів СЕКЦІЇ (`image_url`, `cta_href`) і
 * НЕ виконується для полів перекладу. Щоб виконувався, тип мусив би
 * лежати в рядку перекладу — це зміна моделі даних, не цього скрипта.
 */

/** Пропущене на кроці 3 — щоб прогін почервонів, але після кроку 4. */
const conditionsSkipped = [];

/**
 * Поля колекції, які справді мають колонку в базі.
 *
 * 🔴 ЧОМУ ЧИТАЄМО ПЕРЕД ЗАПИСОМ, А НЕ ЛОВИМО 404.
 *
 * `PATCH /fields/<колекція>/<поле>` для неіснуючої КОЛОНКИ не віддає
 * 404 — він віддає 200 і заводить рядок у `directus_fields`. Тобто
 * гілка «no such field, skipped» була мертвим кодом, а в адмінці
 * зʼявилось би поле, якому нема куди писати. Це той самий вендорський
 * почерк, що й у `PATCH /collections/<name>`, який замість 404 створює
 * meta-only «папку», — і `setCollectionMeta` нижче вже читає перед
 * записом саме тому.
 *
 * 🔴 А неіснуюча КОЛЕКЦІЯ дає 403, а не 404 (`collection-exists`
 * піднімає ForbiddenError). Тобто перевірка `includes('404')` не
 * спіймала б і її: виняток летів би далі й валив `main()` ДО кроку 4,
 * лишаючи політики й ролі неоновленими. Саме так поводився б інстанс,
 * що відстав на одну міграцію.
 */
async function realFields(collection) {
  try {
    const list = await api('GET', `/fields/${collection}`);
    return new Set((list ?? []).filter((f) => f.schema).map((f) => f.field));
  } catch (err) {
    conditionsSkipped.push(`${collection} (${String(err).slice(0, 80)})`);
    console.error(`   🔴 ${collection}: колекції немає — умови пропущено`);
    return null;
  }
}

/** Записує умову на поле, яке ТОЧНО існує (перелік дає `realFields`). */
async function setFieldConditions(collection, fields, field, hiddenFor, note) {
  if (!fields.has(field)) {
    conditionsSkipped.push(`${collection}.${field}`);
    console.error(`   🔴 ${collection}.${field}: такої колонки немає`);
    return false;
  }
  const conditions = [
    {
      name: `Сховати для: ${hiddenFor.join(', ')}`,
      rule: { type: { _in: hiddenFor } },
      hidden: true,
    },
  ];
  await api('PATCH', `/fields/${collection}/${field}`, {
    meta: { conditions, note },
  });
  return true;
}


const READ_WRITE = ['read', 'create', 'update'];

async function main() {
  await login();
  console.log('✅ admin login\n');

  // 🔴 ТУТ ХОЧЕТЬСЯ ДОПИСАТИ «А ЗАЙВІ РЕЄСТРАЦІЇ ВИДАЛИТИ». НЕ ДОПИСУЙ.
  //
  // Я збирався це зробити 20.10.2026, рахуючи бюджет колекцій (ліміт
  // Core — 25, заміряно 21 зареєстровану; шість нових колекцій моделі
  // контенту дають 27). Три службові таблиці виглядали як очевидні
  // кандидати на звільнення місця: `migrations`, `osm_camping_staging`,
  // `spatial_ref_sys`.
  //
  // Код вендора каже інше — `@directus/api`, `services/collections.js`,
  // `deleteOne()`, і це його власний коментар:
  //
  //     Delete a single collection This will delete the table and all
  //     records within.
  //
  //     if (collectionToBeDeleted.schema)
  //       await trx.schema.dropTable(collectionKey);
  //
  // Тобто `DELETE /collections/:key` ДРОПАЄ ТАБЛИЦЮ. Прапорця «зняти
  // лише реєстрацію» немає. Цей скрипт ідемпотентний і в заголовку
  // запрошує запускати його скільки завгодно разів — отже такий крок
  // зніс би журнал міграцій TypeORM, проміжну таблицю імпорту OSM і
  // нутрощі PostGIS на ПЕРШОМУ ж прогоні, мовчки й успішно.
  //
  // Реєстрацію можна зняти лише видаленням рядка в
  // `directus_collections` напряму, і це окреме рішення: ми лізли б у
  // чужий стан. Доступ від реєстрації не залежить — його тримають явні
  // гранти (`directus_permissions`: 40 рядків на 15 колекцій, і для
  // жодної службової таблиці немає жодного).
  console.log('1. Hiding collections nobody should edit here');
  for (const [name, note] of Object.entries(HIDDEN)) {
    const ok = await setCollectionMeta(name, { hidden: true, note });
    if (ok) console.log(`   🔒 ${name}`);
  }

  console.log('\n2. Labelling the collections editors do use');
  for (const [group, label] of [
    [CONTENT, 'content'],
    [READ_ONLY, 'read-only'],
    [MODERATION, 'moderation'],
  ]) {
    for (const [name, meta] of Object.entries(group)) {
      const ok = await setCollectionMeta(name, { hidden: false, ...meta });
      if (ok) console.log(`   ${label.padEnd(10)} ${name}`);
    }
  }

  console.log('\n3. Conditional fields — one collection, many section types');
  const sectionFields = await realFields('page_sections');
  let applied = 0;
  if (sectionFields) {
    for (const [field, { hiddenFor, note }] of Object.entries(
      SECTION_FIELD_CONDITIONS,
    )) {
      const ok = await setFieldConditions(
        'page_sections',
        sectionFields,
        field,
        hiddenFor,
        note,
      );
      if (ok) {
        applied += 1;
        console.log(
          `   page_sections.${field} hidden for: ${hiddenFor.join(', ')}`,
        );
      }
    }
  }

  // 🔴 ПРИБИРАЄМО УМОВИ, ЯКІ РАНІШЕ ПОСТАВИВ ЦЕЙ-ТАКИ СКРИПТ.
  //
  // Прибрати запис у коді — це половина виправлення: на інстансах, де
  // скрипт уже відпрацював, мертві умови ЛИШАЮТЬСЯ. Заміряно 20.10.2026
  // на живому Directus — обидві на місці:
  //   page_section_translations.items     → rule {"type":{"_in":["hero"]}}
  //   page_section_translations.cta_label → rule {"type":{"_in":["faq"]}}
  //
  // Вони нешкідливі рівно тому, що не спрацьовують ніколи (колонки
  // `type` у перекладі немає). Але людина, яка відкриє налаштування
  // поля, побачить умову й вирішить, що та працює — тобто стан інстанса
  // суперечив би і коду, і картці. Конфігурація, яку запускають
  // повторно, мусить приводити інстанс до наміру, а не лише перестати
  // псувати його далі.
  const translationFields = await realFields('page_section_translations');
  if (translationFields) {
    for (const field of ['items', 'cta_label']) {
      if (!translationFields.has(field)) continue;
      await api('PATCH', `/fields/page_section_translations/${field}`, {
        meta: { conditions: null },
      });
      console.log(`   page_section_translations.${field} — мертву умову знято`);
    }
  }

  // 🔴 ЛІЧИМО ЗРОБЛЕНЕ І ЗВІРЯЄМО З НАМІРОМ, А НЕ ДРУКУЄМО ПІДСУМОК.
  //
  // Рядок «hidden for: faq» друкувався б і тоді, коли `PATCH` завів
  // поле-привид замість налаштувати наявне. Друкований підсумок — це
  // підпис, а не перевірка; перевірка це ЛІЧИЛЬНИК, звірений із
  // константою, з якої й будувався перелік.
  const wanted = Object.keys(SECTION_FIELD_CONDITIONS).length;
  if (sectionFields && applied !== wanted) {
    conditionsSkipped.push(`виставлено ${applied} умов із ${wanted}`);
  }

  console.log('\n4. Policies and roles');

  // --- Editor -------------------------------------------------------------
  const editorPolicy = await upsertPolicy(
    'Editor',
    'Writes guides, legal pages, camper types and city pages. Reads campsites and routes. Cannot see users, trips or the OSM staging table.',
  );
  const editorGrants = [
    ...Object.keys(CONTENT).flatMap((c) =>
      READ_WRITE.map((action) => ({ collection: c, action })),
    ),
    ...Object.keys(READ_ONLY).map((c) => ({ collection: c, action: 'read' })),
  ];
  const editorRefused = await setPermissions(editorPolicy, editorGrants);
  const editorRole = await upsertRole('Editor', 'Editorial content');
  await linkPolicy(editorRole, editorPolicy);
  console.log(`   Editor    ${editorGrants.length} grants`);

  // --- Moderator ----------------------------------------------------------
  // Deliberately cannot delete: a rejected photo keeps its reason and its
  // audit trail. Deleting the row would erase why it was rejected, and the
  // submitter is shown that reason (CAMP-86).
  const modPolicy = await upsertPolicy(
    'Moderator',
    'Approves or rejects photos and reviews. Read-only everywhere else. Cannot delete — a rejection has to keep its reason.',
  );
  const modGrants = [
    ...Object.keys(MODERATION).flatMap((c) => [
      { collection: c, action: 'read' },
      {
        collection: c,
        action: 'update',
        fields: ['status', 'rejection_reason', 'reviewed_at', 'reviewed_by_directus_id'],
      },
    ]),
    ...Object.keys(READ_ONLY).map((c) => ({ collection: c, action: 'read' })),
  ];
  const modRefused = await setPermissions(modPolicy, modGrants);
  const modRole = await upsertRole('Moderator', 'Photo and review moderation');
  await linkPolicy(modRole, modPolicy);
  console.log(`   Moderator ${modGrants.length} grants`);

  const refused = [...editorRefused, ...modRefused];
  if (refused.length > 0) {
    console.error(
      `\n   🔴 ${refused.length} field-level grant(s) NOT created:\n` +
      refused.map((r) => `        ${r}\n`).join('') +
      `\n      Narrowing a permission to named fields needs the licence key,\n` +
      `      and this run has none (free Core tier). The previous version of\n` +
      `      this script widened them to the whole collection instead — which\n` +
      `      gave a moderator every field, quietly. We now refuse instead.\n` +
      `\n      Fix it one of two ways, not by ignoring this:\n` +
      `        • set LICENSE_KEY (the grant is approved — CAMP-62), or\n` +
      `        • decide those roles do not exist on this environment.`,
    );
    process.exitCode = 1;
  }

  const all = await api('GET', '/collections');
  const ours = all.filter((c) => !c.collection.startsWith('directus_'));

  // 🔴 `!c.meta?.hidden` ІСТИННЕ ДЛЯ НЕЗАРЕЄСТРОВАНОЇ ТАБЛИЦІ, бо
  // `undefined?.hidden` це `undefined`. Попередня редакція через це
  // рахувала незареєстровані як «видимі» й друкувала 39 там, де
  // насправді 23 — рівно той клас помилки, який коментар нижче
  // оголошував виправленим. Знайшла рецензія PR #296.
  //
  // «Видима» має сенс лише для зареєстрованої: незареєстрована не
  // видима й не прихована, її в адмінці просто немає.
  const visible = ours.filter((c) => c.meta && !c.meta.hidden).length;

  // 🔴 ЗАРЕЄСТРОВАНІ — ЦЕ НЕ ТАБЛИЦІ. Попередня редакція друкувала
  // «N visible collections of M tables», де M це всі не-directus
  // таблиці. Ліміт ліцензії рахує інше: лише ті, що МАЮТЬ рядок у
  // `directus_collections`, тобто `meta !== null`. Заміряно 20.10.2026
  // на локальній базі: 41 таблиця, з них зареєстровано 21.
  //
  // Різниця не академічна: за старим числом ми б думали, що впираємось
  // у ліміт удвічі раніше, ніж насправді, — і навпаки, після переїзду
  // таблиць у базу без реєстрації не помітили б запасу.
  // 🔴 РАХУЄМО ТЕ САМЕ, ЩО Й ВЕНДОР, А НЕ СХОЖЕ.
  //
  // Ліміт перевіряє `getActiveCollections` у
  // `@directus/api/.../license/entitlements/lib/collections.js`, і він
  // відкидає «папки»: `isFolder = collection.schema === null`. Тобто
  // колекція-порожнявка (meta є, таблиці немає) місця в ліміті НЕ
  // займає.
  //
  // Попередня редакція рахувала за самим лише `c.meta` і завищувала.
  // Рецензія PR #296 заміряла на одному інстансі в один момент: мій
  // лічильник казав 28 і «перебір на 3», вендорський — 27. При одній
  // порожнявці на стелі скрипт падав би на стані, який ліцензія
  // дозволяє, і число «на скільки перебір» в інструкції оператору було
  // б неправильним.
  //
  // Мій же коментар вище стверджував протилежне — що порожнявка
  // з'їдає місце «точно так само». Це було неправдою, і сторож її
  // успадкував.
  const registered = ours
    .filter((c) => c.meta && c.schema)
    .map((c) => c.collection);

  // Порожнявки все одно варто назвати: вони нічого не коштують, але
  // означають, що хтось зареєстрував ім'я без таблиці.
  const folders = ours.filter((c) => c.meta && !c.schema).map((c) => c.collection);
  if (folders.length > 0) {
    console.warn(
      `   ⚠️  ${folders.length} registered name(s) without a table ` +
      `(not counted against the licence): ${folders.join(', ')}`,
    );
  }

  // 🔴 ЦЕ ВИМІР, А НЕ ПІДПИС. Попередня редакція друкувала
  // `Object.keys(NOT_REGISTERED).length` — тобто скільки імен я ВПИСАВ,
  // а не скільки їх справді поза реєстром. На оновленні вже
  // налаштованого інстансу вона буквально казала «4 deliberately
  // unregistered» і за два рядки перелічувала три з них серед
  // зареєстрованих. Знайшла рецензія PR #296; у мене про цей клас є
  // власний запис, і я все одно його повторив.
  const stillRegistered = Object.keys(NOT_REGISTERED).filter((n) =>
    registered.includes(n),
  );

  console.log(
    `\n✅ done — ${visible} visible, ${registered.length} registered, ` +
    `${ours.length} tables, ` +
    `${Object.keys(NOT_REGISTERED).length - stillRegistered.length} ` +
    `of ${Object.keys(NOT_REGISTERED).length} deliberately unregistered\n`,
  );

  if (stillRegistered.length > 0) {
    console.warn(
      `   ⚠️  ${stillRegistered.length} meant to be unregistered but still ` +
      `are: ${stillRegistered.join(', ')}\n` +
      `      This script cannot unregister them — the vendor's DELETE\n` +
      `      drops the table. Remove the row directly:\n` +
      `        DELETE FROM directus_collections WHERE collection IN (...);`,
    );
  }

  // 🔴 СТЕЛЯ ПЕРЕВІРЯЄТЬСЯ ЛИШЕ ТОДІ, КОЛИ ВОНА ДІЄ.
  //
  // MSCL Core дає 25 колекцій. Схвалений Open Innovation Grant її
  // знімає — отже падати при 27 на ліцензованому інстансі означало б
  // червоніти на правильному стані.
  //
  // Але й мовчати не можна: §2.2 і §5.3 угоди кажуть, що ключ помирає
  // разом із нею, і на реакцію є 10 днів. День, коли ключ відпаде, не
  // має бути днем, коли ми вперше дізнаємось, що половина адмінки
  // перетворилась на Inactive.
  //
  // Тому: без ліцензії й понад стелю — ПАДАЄМО з переліком імен; із
  // ліцензією й понад стелю — попереджаємо і називаємо, на скільки
  // саме перебір. `GET /server/info` публічний, облікових даних не
  // потребує й значень не розкриває.
  const CORE_COLLECTION_CAP = 25;
  let licensed = false;
  try {
    const info = await api('GET', '/server/info');
    licensed = Boolean(info?.license?.source);
  } catch {
    // Недоступний `/server/info` — поводимось як без ліцензії, бо
    // запасний шлях мусить падати в бік помітного.
    licensed = false;
  }

  if (registered.length > CORE_COLLECTION_CAP) {
    const over = registered.length - CORE_COLLECTION_CAP;
    const names = registered.sort().join(', ');
    if (licensed) {
      console.warn(
        `   ⚠️  ${registered.length} registered collections — ` +
        `${over} over the Core cap of ${CORE_COLLECTION_CAP}.\n` +
        `      The grant lifts the cap, so this run is fine. But the day\n` +
        `      the key lapses, ${over} of these stop working:\n        ${names}`,
      );
    } else {
      console.error(
        `\n   🔴 ${registered.length} registered collections on an\n` +
        `      UNLICENSED instance — the Core cap is ${CORE_COLLECTION_CAP}.\n` +
        `      ${over} collection(s) over. Registered:\n        ${names}\n` +
        `\n      🔴 DO NOT free space by deleting collections: the vendor's\n` +
        `      DELETE /collections/:key drops the TABLE (see the note in\n` +
        `      step 1). Unregister by removing the row in\n` +
        `      directus_collections, or set LICENSE_KEY.`,
      );
      process.exitCode = 1;
    }
  }

  // 🔴 ПРОПУЩЕНЕ НА КРОЦІ 3 ЧЕРВОНИТЬ ПРОГІН — АЛЕ ПІСЛЯ КРОКУ 4.
  //
  // Кинути виняток одразу означало б лишити політики й ролі
  // неоновленими через те, що відстала одна міграція. Тому крок 3 не
  // валить прогін на місці, а запамʼятовує; робота доводиться до кінця,
  // і лише тоді прогін оголошується невдалим. Мовчазний пропуск був би
  // гіршим за обидва варіанти.
  if (conditionsSkipped.length) {
    console.error(
      `\n   🔴 Умовні поля виставлено НЕ ПОВНІСТЮ (${conditionsSkipped.length}):\n` +
        conditionsSkipped.map((x) => `        ${x}`).join('\n') +
        '\n      Крок 4 виконано. Прогін червоний саме через це.',
    );
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exitCode = 1;
});
