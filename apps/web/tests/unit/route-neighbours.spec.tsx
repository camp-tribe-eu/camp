import { expect, test } from '@playwright/test';
import RoutePage from '@/app/routes/[slug]/page';
import RouteMapEmbed from '@/components/route-map-embed';
import RouteStageCampsites from '@/components/route-campsites';
import { CURATED_ROUTES } from '../../src/data/routes';
import {
  CAMPSITES_PER_STAGE,
  getRouteNeighbours,
  STAGE_RADIUS_M,
  type RouteNeighbour,
  type StageNeighbours,
} from '../../src/lib/routes';
import { SERVICE_RADIUS_M } from '../../src/lib/route-services';
import { renderAsyncComponent, renderComponent } from './render-component';

// CAMP-160 — 🔴 WHAT THE ROUTE PAGE SAYS WHEN IT COULD NOT LOOK FOR
// CAMPSITES, AND WHAT IT SAYS WHEN IT LOOKED AND FOUND NONE.
//
// `getRouteNeighbours` used to return an empty `spots` array per stage on
// ANY failure — a dead API, a 500, an answer for the wrong number of
// stages — and the page printed, under every stop:
//
//   "Our database holds no campsite within 25 km of this stop."
//
// That is a statement about the ground made by code that never looked at
// it. The empty array from a failed fetch and the empty array from a
// genuinely empty area were the same value, so nothing downstream could
// tell them apart. The services block beside it was fixed for exactly
// this in CAMP-113 (`getRouteServices` → `{ looked, groups }`); this is
// the same third state for the campsite list.
//
// 🔴 EVERY ASSERTION ABOUT WHAT A READER IS TOLD READS THE RENDERED
// HTML, with tags stripped — not a prop, not a class, not a `data-testid`
// on its own. A check must not assert a property it cannot see, and a
// data function can be right while the page hands the component the
// wrong flag; only the page's output shows that.
//
// The first block drives the real function with a swapped-in `fetch`, the
// second the real component, the third the real PAGE with the same
// `fetch` swapped in — so nothing here ever reaches a network, and in
// particular never the API on :3001.

// ── helpers ──────────────────────────────────────────────────────────────

/**
 * 🔴 Applied until it stops changing the string, not once — the
 * single-pass form is the shape CodeQL calls "incomplete multi-character
 * sanitization". Nothing here sanitises for display; the input is our own
 * `renderToStaticMarkup` output. But every assertion below leans on this
 * helper, and it should not be the one place with a known hole.
 */
const stripTags = (html: string): string => {
  let out = html;
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(/<[^>]*>/g, ' ');
  }
  return out;
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  mdash: '—',
  ndash: '–',
  middot: '·',
};

/** One pass with a lookup table — a chain of `.replace` double-unescapes. */
const decodeEntities = (s: string): string =>
  s.replace(
    /&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g,
    (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[body] ?? whole;
    },
  );

/**
 * Everything a person would actually read. `sr-only` content is removed
 * FIRST: a screen-reader caption is not something a sighted reader is
 * told, so an assertion it could satisfy would be about a property the
 * page does not visibly have.
 */
const visibleText = (html: string): string => {
  let out = html;
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(
      /<([a-z]+)\b[^>]*\bclass="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g,
      ' ',
    );
  }
  return decodeEntities(stripTags(out)).replace(/\s+/g, ' ').trim();
};

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

// 🔴 The helper every other assertion here leans on, tested: were it to
// return '' the "must never say" assertions would all pass over a page
// that said anything at all.
test.describe('the helper itself is honest', () => {
  test('removes sr-only content and keeps the visible words', () => {
    expect(
      visibleText('<p>Campsites<span class="sr-only">hidden</span> near</p>'),
    ).toBe('Campsites near');
  });

  test('a rendered stage block is not empty text', () => {
    const html = renderComponent(RouteStageCampsites, {
      group: undefined,
      looked: true,
    });
    expect(visibleText(html).length).toBeGreaterThan(40);
  });
});

/** Swap global fetch for one test, and always put it back. */
async function withFetch(
  impl: (url: string) => Promise<Response> | Response,
  run: () => Promise<void>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
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

const route = CURATED_ROUTES[0];
const stages = route.stages.length;

const emptyGroups = (): StageNeighbours[] =>
  route.stages.map((s) => ({ lat: s.lat, lon: s.lon, spots: [] }));

const spot = (over: Partial<RouteNeighbour> = {}): RouteNeighbour => ({
  slug: 'camping-des-mouettes',
  name: 'Camping des Mouettes',
  country: 'fr',
  region: 'Charente-Maritime',
  path: '/camping/fr/charente-maritime/camping-des-mouettes',
  type: 'paid',
  lat: 46.1,
  lon: -1.2,
  metres: 1_800,
  amenities: {} as RouteNeighbour['amenities'],
  sources: [],
  ...over,
});

/** A well-formed `/routes/near` answer: we looked, this is what is there. */
const nearBody = (groups: StageNeighbours[] = emptyGroups()) => ({
  groups,
  perPoint: CAMPSITES_PER_STAGE,
  radiusMetres: STAGE_RADIUS_M,
  returned: groups.reduce((n, g) => n + g.spots.length, 0),
});

/** A well-formed, EMPTY `/routes/services` answer. */
const servicesBody = () => ({
  groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, services: [] })),
  radiusMetres: SERVICE_RADIUS_M,
  perKind: 1,
  returned: 0,
  truncated: false,
});

// ── 1. THE DATA FUNCTION: LOOKED, OR DID NOT ─────────────────────────────

test.describe('getRouteNeighbours says whether it looked', () => {
  test('a healthy answer with campsites is looked, and they survive the journey', async () => {
    const groups = emptyGroups();
    groups[0].spots = [spot()];
    await withFetch(
      () => json(nearBody(groups)),
      async () => {
        const r = await getRouteNeighbours(route);
        expect(r.looked).toBe(true);
        expect(r.groups).toHaveLength(stages);
        expect(r.groups[0].spots[0].slug).toBe('camping-des-mouettes');
      },
    );
  });

  // 🔴 THE OTHER HALF OF THE FIX, AND THE ONE AN OVER-CORRECTION BREAKS.
  //
  // Reading every empty answer as a failure would also be a lie — it
  // would say "we could not reach our database" about an area we DID
  // check and that genuinely holds nothing. The genuine empty answer must
  // stay a successful look.
  test('🔴 a healthy answer that is empty everywhere is still "looked"', async () => {
    await withFetch(
      () => json(nearBody()),
      async () => {
        const r = await getRouteNeighbours(route);
        expect(r.looked).toBe(true);
        expect(r.groups).toHaveLength(stages);
        expect(r.groups.every((g) => g.spots.length === 0)).toBe(true);
      },
    );
  });

  // 🔴 The body here is a VALID one. An error body would be refused by the
  // group-count guard instead, and this test would pass with `!res.ok`
  // deleted — measured 29.09.2026: removing that line left 614/614 green.
  // A status check is only tested by a response that nothing else rejects.
  test('🔴 a 500 is "we could not look", not "there is nothing there"', async () => {
    await withFetch(
      () => json(nearBody(), 500),
      async () => {
        const r = await getRouteNeighbours(route);
        expect(r.looked).toBe(false);
        // Still stage-shaped, so the page keeps its layout — it just must
        // not read the groups as absences.
        expect(r.groups).toHaveLength(stages);
      },
    );
  });

  test('🔴 a thrown fetch (the API is down) is "we could not look"', async () => {
    await withFetch(
      () => {
        throw new Error('ECONNREFUSED');
      },
      async () => {
        const r = await getRouteNeighbours(route);
        expect(r.looked).toBe(false);
        expect(r.groups).toHaveLength(stages);
      },
    );
  });

  test('🔴 a 200 whose body is not JSON is "we could not look"', async () => {
    await withFetch(
      () => new Response('<html>502 Bad Gateway</html>', { status: 200 }),
      async () => {
        expect((await getRouteNeighbours(route)).looked).toBe(false);
      },
    );
  });

  test('🔴 a group count that does not match the stages is never merged by index', async () => {
    await withFetch(
      () => json(nearBody(emptyGroups().slice(1))),
      async () => {
        const r = await getRouteNeighbours(route);
        expect(r.looked).toBe(false);
        expect(r.groups).toHaveLength(stages);
      },
    );
  });

  // 🔴 Both sides, not one. The guard is `!==`, so a body with MORE groups
  // than stages must be refused too — otherwise the extra one is read as a
  // stage that does not exist.
  test('🔴 more groups than stages is also "we could not look"', async () => {
    await withFetch(
      () => json(nearBody([...emptyGroups(), ...emptyGroups().slice(0, 1)])),
      async () => {
        const r = await getRouteNeighbours(route);
        expect(r.looked).toBe(false);
        expect(r.groups).toHaveLength(stages);
      },
    );
  });

  // 🔴 A group we cannot read is not an empty group.
  test('🔴 a group with no readable list of campsites is "we could not look"', async () => {
    const body = nearBody();
    (body.groups[2] as { spots: unknown }).spots = null;
    await withFetch(
      () => json(body),
      async () => {
        expect((await getRouteNeighbours(route)).looked).toBe(false);
      },
    );
  });

  // 🔴 The page prints "within 25 km" beside every stop and the API
  // clamps the radius it is given. If the two ever disagree, every one of
  // those sentences is false while the page still renders — so the answer
  // is compared, not assumed.
  test('🔴 a radius the API did not apply is "we could not look"', async () => {
    await withFetch(
      () => json({ ...nearBody(), radiusMetres: 60_000 }),
      async () => {
        expect((await getRouteNeighbours(route)).looked).toBe(false);
      },
    );
  });

  // 🔴 And the other direction, which is the dangerous one. A radius clamped
  // DOWN means we looked at less ground than the sentence claims, and the
  // page would print "within 25 km" over a narrower search with nothing red.
  test('🔴 a radius clamped DOWN is "we could not look" too', async () => {
    await withFetch(
      () => json({ ...nearBody(), radiusMetres: 10_000 }),
      async () => {
        expect((await getRouteNeighbours(route)).looked).toBe(false);
      },
    );
  });
});

// ── 2. THE COMPONENT: THREE STATES, THREE DIFFERENT SENTENCES ────────────

const stageGroup = (spots: RouteNeighbour[]): StageNeighbours => ({
  lat: 46.16,
  lon: -1.15,
  spots,
});

const UNAVAILABLE = 'We could not reach our own database';
const EMPTY = `Our database holds no campsite within ${STAGE_RADIUS_M / 1000} km of this stop`;

const renderCampsites = (
  group: StageNeighbours | undefined,
  looked: boolean,
): string => renderComponent(RouteStageCampsites, { group, looked });

test.describe('the campsite block tells the three states apart, in words', () => {
  test('we looked and found campsites: they are listed, with no notice', () => {
    const text = visibleText(renderCampsites(stageGroup([spot()]), true));
    expect(text).toContain('Camping des Mouettes');
    expect(text).toContain('1.8 km away in a straight line');
    expect(text).not.toContain(UNAVAILABLE);
    expect(text).not.toContain('holds no campsite');
  });

  test('🔴 we looked and found none: the block says our database holds none', () => {
    const text = visibleText(renderCampsites(stageGroup([]), true));
    expect(text).toContain(EMPTY);
    // …and says it is a gap in what is recorded, not in the world.
    expect(text).toContain('not a statement that nothing is there');
    expect(text).not.toContain('could not');
  });

  // 🔴 THE DEFECT, AS THE READER WOULD HAVE SEEN IT.
  test('🔴 we could not look: the block says so and NEVER says our database holds none', () => {
    const text = visibleText(renderCampsites(stageGroup([]), false));
    expect(text).toContain(UNAVAILABLE);
    expect(text).not.toContain('holds no campsite');
    // Broader than the exact sentence, so rewording the false claim
    // cannot slip past a check that only knows its old form.
    expect(text).not.toMatch(/\bno campsites?\b/i);
    expect(text).not.toMatch(/holds no/i);
    // It says whose fault it is.
    expect(text).toContain('fault of ours');
  });

  // 🔴 DISTINGUISHABLE IN THE OUTPUT, NOT ONLY IN A PROP.
  test('🔴 "we looked and found none" and "we could not look" are different text', () => {
    const empty = visibleText(renderCampsites(stageGroup([]), true));
    const failed = visibleText(renderCampsites(stageGroup([]), false));
    expect(empty).not.toBe(failed);
    // Neither contains the other's distinguishing sentence.
    expect(empty).not.toContain(UNAVAILABLE);
    expect(failed).not.toContain(EMPTY);
    // …and the served markup differs too, so a page test or a script can
    // tell them apart without reading prose.
    const emptyHtml = renderCampsites(stageGroup([]), true);
    const failedHtml = renderCampsites(stageGroup([]), false);
    expect(emptyHtml).toContain('data-testid="stage-no-campsites"');
    expect(emptyHtml).not.toContain('data-testid="stage-campsites-unavailable"');
    expect(failedHtml).toContain('data-testid="stage-campsites-unavailable"');
    expect(failedHtml).not.toContain('data-testid="stage-no-campsites"');
  });

  test('the heading is there in every state, so the block is never silent', () => {
    for (const looked of [true, false]) {
      for (const spots of [[], [spot()]]) {
        expect(
          visibleText(renderCampsites(stageGroup(spots), looked)),
          `looked=${looked}, ${spots.length} spots`,
        ).toContain('Campsites near this stop');
      }
    }
  });
});

// ── 3. THE PAGE ──────────────────────────────────────────────────────────
//
// 🔴 The whole route page, rendered with the fetch swapped in. The map is
// left out — a client-only island whose server render is a loading box.
// Everything else is the page as served.

/** What `fetch` does for one test: each endpoint on its own. */
interface Api {
  near: () => Response;
  services: () => Response;
}

const dead = (): Response => {
  throw new Error('ECONNREFUSED');
};

async function renderRoute(api: Api): Promise<string> {
  let html = '';
  await withFetch(
    (url) => {
      if (url.includes('/routes/near')) return api.near();
      if (url.includes('/routes/services')) return api.services();
      // Nothing else may leave this process — least of all towards :3001.
      throw new Error(`unexpected request in a unit test: ${url}`);
    },
    async () => {
      html = await renderAsyncComponent(
        RoutePage,
        { params: Promise.resolve({ slug: route.slug }) },
        { omit: [RouteMapEmbed] },
      );
    },
  );
  return html;
}

test.describe('the route page, rendered', () => {
  // 🔴 THE CARD'S REPRODUCTION: the API is dead.
  test('🔴 API down: every stop says "we could not look" and none says our database holds none', async () => {
    const html = await renderRoute({ near: dead, services: dead });
    const text = visibleText(html);

    expect(text, 'the page must not claim an absence it did not check').not.toContain(
      'holds no campsite',
    );
    // One line per stop in the campsite list, one per stop in the
    // services block — the same sentence, so the page fails one way.
    expect(occurrences(html, 'data-testid="stage-campsites-unavailable"')).toBe(
      stages,
    );
    expect(occurrences(html, 'data-testid="stage-services-unavailable"')).toBe(
      stages,
    );
    expect(occurrences(text, UNAVAILABLE)).toBe(stages * 2);
    // And nothing in the page is a per-kind denial either.
    expect(html).not.toContain('data-testid="stage-no-campsites"');
    expect(text).not.toMatch(/Our database holds no /);
  });

  // 🔴 THE CASE THE FIX MUST NOT DAMAGE: we looked, and there is nothing.
  test('🔴 API up, nothing within 25 km: every stop says our database holds none — and does not claim a failure', async () => {
    const html = await renderRoute({
      near: () => json(nearBody()),
      services: () => json(servicesBody()),
    });
    const text = visibleText(html);

    expect(occurrences(text, EMPTY)).toBe(stages);
    expect(occurrences(html, 'data-testid="stage-no-campsites"')).toBe(stages);
    expect(html).not.toContain('data-testid="stage-campsites-unavailable"');
    expect(text).not.toContain('could not reach');
  });

  // 🔴 The two are told apart by the page's own output, side by side.
  test('🔴 the failing page and the genuinely empty page differ in what they say', async () => {
    const failing = visibleText(await renderRoute({ near: dead, services: dead }));
    const empty = visibleText(
      await renderRoute({
        near: () => json(nearBody()),
        services: () => json(servicesBody()),
      }),
    );
    expect(failing).not.toBe(empty);
    expect(failing).toContain(UNAVAILABLE);
    expect(failing).not.toContain(EMPTY);
    expect(empty).toContain(EMPTY);
    expect(empty).not.toContain(UNAVAILABLE);
  });

  // 🔴 Two flags, two endpoints, and neither may borrow the other's.
  // Hard-coding `looked={true}`, or handing the campsite block the
  // services flag, each turn one of these red while the data function and
  // the component still pass on their own.
  test('🔴 only the campsite call failing: campsites say so, services are unaffected', async () => {
    const html = await renderRoute({
      near: dead,
      services: () => json(servicesBody()),
    });
    expect(occurrences(html, 'data-testid="stage-campsites-unavailable"')).toBe(
      stages,
    );
    expect(html).not.toContain('data-testid="stage-services-unavailable"');
    expect(visibleText(html)).not.toContain('holds no campsite');
  });

  test('🔴 only the services call failing: services say so, campsites keep their honest empty', async () => {
    const html = await renderRoute({
      near: () => json(nearBody()),
      services: dead,
    });
    expect(occurrences(html, 'data-testid="stage-services-unavailable"')).toBe(
      stages,
    );
    expect(html).not.toContain('data-testid="stage-campsites-unavailable"');
    expect(occurrences(visibleText(html), EMPTY)).toBe(stages);
  });

  test('campsites that were found are listed on the page, with no failure notice', async () => {
    const groups = emptyGroups();
    groups[0].spots = [spot()];
    const html = await renderRoute({
      near: () => json(nearBody(groups)),
      services: () => json(servicesBody()),
    });
    const text = visibleText(html);

    expect(text).toContain('Camping des Mouettes');
    expect(html).toContain(
      'href="/camping/fr/charente-maritime/camping-des-mouettes"',
    );
    // Stage 1 has one; the other stages were looked at and have none.
    expect(occurrences(html, 'data-testid="stage-no-campsites"')).toBe(stages - 1);
    expect(html).not.toContain('data-testid="stage-campsites-unavailable"');
  });

  // The licence paragraph counts what THE PAGE shows ("this page shows 0
  // campsites"), which stays true when the look failed — it is not a
  // count of the database. Pinned so a change to the failure path cannot
  // quietly drop the attribution block along with the list.
  test('the failed page still carries its sources and licence paragraph', async () => {
    const html = await renderRoute({ near: dead, services: dead });
    expect(html).toContain('data-testid="route-sources"');
    expect(visibleText(html)).toContain('this page shows 0 campsites');
  });
});
