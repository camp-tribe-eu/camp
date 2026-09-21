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
  for (const collection of ['users', 'trips', 'trip_stops', 'osm_camping_staging']) {
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
  const created = await call('POST', '/items/guides', {
    token,
    body: { slug, category: 'verification', status: 'draft' },
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
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\n❌', err.message);
  process.exitCode = 1;
});
