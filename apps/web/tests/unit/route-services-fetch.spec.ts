import { expect, test } from '@playwright/test';
import { CURATED_ROUTES } from '../../src/data/routes';
import {
  getRouteServices,
  SERVICE_KINDS,
  SERVICE_RADIUS_M,
} from '../../src/lib/route-services';

// CAMP-113 — 🔴 WHAT THE PAGE DOES WHEN WE COULD NOT LOOK.
//
// This is the test for the defect review found, and it is worth stating
// plainly because the symptom was invisible to every other test we have:
//
//   getRouteServices returned `services: []` per stage on ANY failure —
//   a non-ok response, a throw, a group-count mismatch. `serviceOf` then
//   answered null for every kind and the component rendered, seven times
//   per stage, "Our database holds no fuel station within 25 km of this
//   stop." On a seven-stage route that is 49 false statements about the
//   ground, printed because a fetch failed.
//
// The e2e suite was green on it by construction: its per-kind assertion
// is `found.count() + absent.count() === 1`, which all-absent satisfies
// perfectly.
//
// So the contract is now three-state, and these tests drive the real
// function with a stubbed `fetch` rather than asserting anything about
// how it is written.

const route = CURATED_ROUTES[0];

/** Swap global fetch for the run of one test, and always put it back. */
async function withFetch(
  impl: (url: string) => Promise<Response> | Response,
  run: () => Promise<void>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve(impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** A well-formed answer for this route. */
const goodBody = () => ({
  groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, services: [] })),
  radiusMetres: SERVICE_RADIUS_M,
  perKind: 1,
  returned: 0,
  truncated: false,
});

test('a healthy answer is marked as looked at', async () => {
  await withFetch(
    () => json(goodBody()),
    async () => {
      const r = await getRouteServices(route);
      expect(r.looked).toBe(true);
      expect(r.groups).toHaveLength(route.stages.length);
    },
  );
});

test('🔴 a 500 is "we could not look", not "there is nothing there"', async () => {
  await withFetch(
    () => json({ error: 'boom' }, 500),
    async () => {
      const r = await getRouteServices(route);
      expect(r.looked).toBe(false);
      // The groups are still stage-shaped, so the page keeps its layout —
      // it just must not read them as absences.
      expect(r.groups).toHaveLength(route.stages.length);
    },
  );
});

test('🔴 a thrown fetch is "we could not look"', async () => {
  await withFetch(
    () => {
      throw new Error('ECONNREFUSED');
    },
    async () => {
      const r = await getRouteServices(route);
      expect(r.looked).toBe(false);
    },
  );
});

test('🔴 a group count that does not match the stages is never merged by index', async () => {
  await withFetch(
    () => json({ ...goodBody(), groups: goodBody().groups.slice(1) }),
    async () => {
      const r = await getRouteServices(route);
      expect(r.looked).toBe(false);
      expect(r.groups).toHaveLength(route.stages.length);
    },
  );
});

// 🔴 The cap that used to bind at stage 9. A short answer is not an
// empty area, and the API now says which it is.
test('🔴 a truncated answer is "we could not look"', async () => {
  await withFetch(
    () => json({ ...goodBody(), truncated: true }),
    async () => {
      expect((await getRouteServices(route)).looked).toBe(false);
    },
  );
});

// 🔴 The page prints "within 25 km" in three places and the API clamps
// the radius it was given. If the two ever disagree, every one of those
// sentences is false — so the answer is compared, not assumed.
test('🔴 a radius the API did not apply is "we could not look"', async () => {
  await withFetch(
    () => json({ ...goodBody(), radiusMetres: 60_000 }),
    async () => {
      expect((await getRouteServices(route)).looked).toBe(false);
    },
  );
});

// A real answer carrying real services comes through intact, so the
// three-state contract has not simply made everything unavailable.
test('services in a healthy answer survive the journey', async () => {
  const body = goodBody();
  body.groups[0].services = [
    {
      kind: SERVICE_KINDS[0],
      osmRef: 'n1',
      name: 'Station',
      lat: 1,
      lon: 2,
      metres: 300,
      phone: null,
      website: null,
      openingHours: '24/7',
    },
  ] as never;
  await withFetch(
    () => json(body),
    async () => {
      const r = await getRouteServices(route);
      expect(r.looked).toBe(true);
      expect(r.groups[0].services[0].osmRef).toBe('n1');
      expect(r.groups[0].services[0].openingHours).toBe('24/7');
    },
  );
});
