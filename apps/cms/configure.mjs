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
  trip_stops: 'Private user data. Managed by the API.',
  migrations: 'TypeORM bookkeeping.',
  osm_camping_staging: 'Raw OSM import staging. Rebuilt weekly by the pipeline.',
  spatial_ref_sys: 'PostGIS internals.',
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

async function setCollectionMeta(name, meta) {
  try {
    await api('PATCH', `/collections/${name}`, { meta });
    return true;
  } catch (err) {
    // A table that is not there yet is not an error worth stopping for.
    if (String(err).includes('404')) {
      console.log(`   ⏭  ${name} — no such collection, skipped`);
      return false;
    }
    throw err;
  }
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
  let downgraded = 0;
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
      // We do not silently drop the grant and we do not crash: we widen it
      // to the whole collection, count it, and say so at the end. Locally
      // that is acceptable; on staging and production the licence key is
      // set, the precise rule applies, and this counter reads zero.
      const restricted =
        String(err).includes('custom_permission_rules_enabled') ||
        String(err).includes('restricted resource');
      if (!restricted || !g.fields) throw err;
      await api('POST', '/permissions', { ...body, fields: ['*'] });
      downgraded++;
    }
  }
  return downgraded;
}

const READ_WRITE = ['read', 'create', 'update'];

async function main() {
  await login();
  console.log('✅ admin login\n');

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

  console.log('\n3. Policies and roles');

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
  const editorDowngraded = await setPermissions(editorPolicy, editorGrants);
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
  const modDowngraded = await setPermissions(modPolicy, modGrants);
  const modRole = await upsertRole('Moderator', 'Photo and review moderation');
  await linkPolicy(modRole, modPolicy);
  console.log(`   Moderator ${modGrants.length} grants`);

  const downgraded = editorDowngraded + modDowngraded;
  if (downgraded > 0) {
    console.log(
      `\n   ⚠️  ${downgraded} field-level grant(s) widened to the whole collection.\n` +
      `      Narrowing permissions to named fields needs the licence key;\n` +
      `      this run is on the free Core tier. On staging and production\n` +
      `      (LICENSE_KEY set) this number must read 0.`,
    );
  }

  const all = await api('GET', '/collections');
  const visible = all.filter(
    (c) => !c.collection.startsWith('directus_') && !c.meta?.hidden,
  ).length;
  const total = all.filter((c) => !c.collection.startsWith('directus_')).length;
  console.log(`\n✅ done — ${visible} visible collections of ${total} tables\n`);
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exitCode = 1;
});
