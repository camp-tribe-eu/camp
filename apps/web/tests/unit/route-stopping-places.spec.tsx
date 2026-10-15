import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import RoutePage from '@/app/routes/[slug]/page';
import RouteMapEmbed from '@/components/route-map-embed';
import OvernightStay from '@/components/overnight-stay';
import { CURATED_ROUTES } from '../../src/data/routes';
import { OVERNIGHT_LABEL } from '../../src/lib/overnight';
import {
  CAMPSITES_PER_STAGE,
  STAGE_RADIUS_M,
  STRAIGHT_LINE_LABEL,
} from '../../src/lib/routes';
import {
  FACILITY_KEYS,
  FACILITY_KINDS,
  readFacilities,
  SERVICE_KINDS,
  SERVICE_LABEL,
  SERVICE_RADIUS_M,
  type ServiceKind,
} from '../../src/lib/route-services';
import { renderAsyncComponent, renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-119, SECOND HALF — THE ROUTE PAGE SHOWS THE STOPPING PLACES.
//
// 🔴 WHY THIS FILE EXISTS. The first half of the card (PR #234) put 23 000-odd
// rest and service areas into the database with nine facility columns and
// touched no file in apps/web. Its 1 723 tests were green and a reader could
// not see one of them: the data reached the database and stopped. A test in
// the API workspace cannot notice that, because the API workspace is not the
// place a reader is.
//
// So every assertion here reads the HTML of the ROUTE PAGE, rendered with the
// API's answer swapped in — never a constant, a class name, a data-testid on
// its own, or an sr-only caption (`visibleText` drops those). A check must
// not assert a property it cannot see.
//
// 🔴 The API is never reached: `fetch` is replaced for the duration of each
// render, and anything that is not one of the two endpoints throws.

// ── what the API serves, read off its own file ──────────────────────────

const ROUTE_POI_FILE = join(__dirname, '..', '..', '..', 'api', 'src', 'osm', 'route-poi.ts');

/**
 * A closed `as const` list from the API's route-poi.ts, as written there.
 *
 * 🔴 Read from DISK, not imported: apps/web and apps/api are separate
 * workspaces and the web test project must not depend on the API's build.
 * `route-fuel.spec.tsx` reads `apps/api/src/fuel/stations.ts` the same way,
 * for the same reason. The anchor (a non-empty list) is asserted by the
 * caller, because a regex that finds nothing must not read as "no kinds".
 */
function apiList(name: 'ROUTE_POI_KINDS' | 'REST_STOP_KINDS'): string[] {
  const src = readFileSync(ROUTE_POI_FILE, 'utf8');
  const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(src);
  if (!m) throw new Error(`${name} is not in ${ROUTE_POI_FILE} — the spec cannot read the API's list`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

// ── rendering the page ───────────────────────────────────────────────────

const route = CURATED_ROUTES[0];
const stages = route.stages.length;

async function withFetch(
  impl: (url: string) => Response,
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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const nearBody = () => ({
  groups: route.stages.map((s) => ({ lat: s.lat, lon: s.lon, spots: [] })),
  perPoint: CAMPSITES_PER_STAGE,
  radiusMetres: STAGE_RADIUS_M,
  returned: 0,
});

type Wire = Record<string, unknown>;

/** What the endpoint sends for one stage, given the services it found. */
const servicesBody = (perStage: (stage: number) => Wire[]) => ({
  groups: route.stages.map((s, i) => ({ lat: s.lat, lon: s.lon, services: perStage(i) })),
  radiusMetres: SERVICE_RADIUS_M,
  perKind: 1,
  returned: 0,
  truncated: false,
});

/** The wire shape of one service, written out as the API's mapper writes it. */
const wire = (kind: string, over: Wire = {}): Wire => ({
  kind,
  osmRef: `n${kind.length}`,
  name: null,
  lat: 46.1,
  lon: -1.1,
  metres: 1234,
  phone: null,
  website: null,
  openingHours: null,
  ...over,
});

async function renderRoute(body: unknown | null): Promise<string> {
  let html = '';
  await withFetch(
    (url) => {
      if (url.includes('/routes/near')) return json(nearBody());
      if (url.includes('/routes/services')) {
        if (body === null) throw new Error('ECONNREFUSED');
        return json(body);
      }
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

const occurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

/**
 * The n-th row of one kind on the page, as HTML: from its opening testid to
 * the next ROW (found or absent, of any kind) or the end of the list. Rows
 * are siblings in a `<dl>`, so this cannot swallow a neighbour.
 *
 * 🔴 The end is looked for by the rows' own testids, kind by kind, and not
 * by "the next `service-` anything": the facilities list inside a row is
 * `service-facilities` and the hours are `service-hours`, and cutting at
 * either would hand back half a row — which an assertion about its
 * facilities would then report as the row not having any.
 */
function rowOf(html: string, kind: string, nth = 0): string {
  const marker = `data-testid="service-${kind}"`;
  let at = -1;
  for (let i = 0; i <= nth; i++) at = html.indexOf(marker, at + 1);
  if (at < 0) throw new Error(`no ${kind} row #${nth} on the page`);
  const rest = html.slice(at + marker.length);
  const ends = [
    rest.indexOf('</dl>'),
    ...SERVICE_KINDS.flatMap((k) => [
      rest.indexOf(`data-testid="service-${k}"`),
      rest.indexOf(`data-testid="service-${k}-absent"`),
    ]),
  ].filter((n) => n >= 0);
  const next = ends.length > 0 ? Math.min(...ends) : rest.length;
  return html.slice(at, at + marker.length + next);
}

/** The facilities `<ul>` of one row, as the words a reader meets. */
const facilitiesText = (rowHtml: string): string => {
  const m = /<ul[^>]*data-testid="service-facilities"[\s\S]*?<\/ul>/.exec(rowHtml);
  if (!m) throw new Error('the row has no facilities list');
  return visibleText(m[0]);
};

const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length;

// ── 1. THE TWO LISTS ARE ONE LIST ────────────────────────────────────────

test.describe('the API serves what the page can show, and the page shows what the API serves', () => {
  // 🔴 THE MUTATION THE CARD NAMES: take `rest_area` out of the API's
  // ROUTE_POI_KINDS. The endpoint stops returning rest areas, the web list
  // still has a row for them, every row says "our database holds no rest
  // area", and nothing in the API workspace is any the wiser about what a
  // reader now sees. This is the test in the workspace where a reader is.
  test('🔴 the API’s ROUTE_POI_KINDS is exactly this page’s SERVICE_KINDS, in the same order', () => {
    const api = apiList('ROUTE_POI_KINDS');
    // Anchor: the parse found the list. An empty one would be "equal" to
    // nothing and fail below, but say it plainly first.
    expect(api.length).toBeGreaterThan(7);
    expect(api).toEqual([...SERVICE_KINDS]);
  });

  test('🔴 the kinds that carry facilities are the same two on both sides', () => {
    const api = apiList('REST_STOP_KINDS');
    expect(api.length).toBeGreaterThan(0);
    expect(api).toEqual([...FACILITY_KINDS]);
    // …and they are on the page's list, which is what makes them showable.
    for (const kind of api) expect(SERVICE_KINDS as readonly string[]).toContain(kind);
  });
});

// ── 2. THE PAGE, FOR EVERY KIND THE API SERVES ───────────────────────────

test.describe('the route page lists every kind the API serves, at every stop', () => {
  test('🔴 every one of them has a row with a distance, said as a straight line', async () => {
    const served = apiList('ROUTE_POI_KINDS');
    expect(served.length).toBeGreaterThan(0);

    const html = await renderRoute(
      servicesBody(() =>
        served.map((kind, i) => wire(kind, { name: `Test ${kind}`, metres: 1100 + i * 100 })),
      ),
    );
    const text = visibleText(html);

    for (const kind of served) {
      // one row per stop, found rather than absent
      expect(occurrences(html, `data-testid="service-${kind}"`), `${kind} rows`).toBe(stages);
      expect(occurrences(html, `data-testid="service-${kind}-absent"`), `${kind} absences`).toBe(0);
      expect(text, `${kind} has no label on the page`).toContain(
        SERVICE_LABEL[kind as ServiceKind],
      );
    }
    // The distance and how it was measured, in the row of every kind.
    for (const [i, kind] of served.entries()) {
      const km = ((1100 + i * 100) / 1000).toFixed(1);
      expect(visibleText(rowOf(html, kind)), kind).toContain(
        `${km} km away ${STRAIGHT_LINE_LABEL}`,
      );
    }
  });
});

// ── 3. THE CARD'S SENTENCES, AS A READER MEETS THEM ──────────────────────

test.describe('a rest area and a service area, rendered', () => {
  const rest = wire('rest_area', {
    osmRef: 'n10',
    name: 'Aire du Test',
    metres: 1234,
    facilities: {
      toilets: 'yes',
      shower: 'no',
      drinkingWater: 'unknown',
      dumpStation: 'unknown',
      fee: 'unknown',
    },
  });
  const service = wire('service_area', {
    osmRef: 'w20',
    name: 'Aire de Service',
    metres: 18_400,
    // 🔴 four keys missing on purpose: an object that names only what OSM
    // said. The page must say the other four, and say them as unknown.
    facilities: { toilets: 'yes' },
  });

  test('🔴 the rows carry the name, the distance as a straight line, and the facilities as three different words', async () => {
    const html = await renderRoute(servicesBody(() => [rest, service]));

    const restRow = visibleText(rowOf(html, 'rest_area'));
    expect(restRow).toContain('Rest area');
    expect(restRow).toContain('Aire du Test');
    expect(restRow).toContain(`1.2 km away ${STRAIGHT_LINE_LABEL}`);

    const restFacilities = facilitiesText(rowOf(html, 'rest_area'));
    expect(restFacilities).toContain('Toilets: Yes');
    expect(restFacilities).toContain('Shower: No');
    expect(restFacilities).toContain('Drinking water: Not known');
    expect(restFacilities).toContain('Chemical toilet disposal: Not known');
    expect(restFacilities).toContain('Fee: Not known');

    const serviceRow = visibleText(rowOf(html, 'service_area'));
    expect(serviceRow).toContain('Service area');
    expect(serviceRow).toContain('Aire de Service');
    expect(serviceRow).toContain(`18.4 km away ${STRAIGHT_LINE_LABEL}`);
    const serviceFacilities = facilitiesText(rowOf(html, 'service_area'));
    expect(serviceFacilities).toContain('Toilets: Yes');
    // four keys the payload never named
    expect(count(serviceFacilities, /: Not known/g)).toBe(4);
  });

  // 🔴 "NO MINUTES TO A STOP", the brief's own line. There is no routing
  // engine on this site (CAMP-42), so a rest-area row that said "12 min" or
  // "by road" would be a figure we do not compute, on the one row a driver
  // is most likely to act on.
  test('🔴 the rows promise no travel time and no road distance, and carry no rating or picture', async () => {
    const html = await renderRoute(servicesBody(() => [rest, service]));
    for (const kind of ['rest_area', 'service_area']) {
      const row = rowOf(html, kind);
      const text = visibleText(row);
      // 🔴 `hours` alone is NOT in this list: the row says "Opening hours
      // unknown", which is not a travel time. A NUMBER before it would be.
      expect(text, `${kind}: a travel time`).not.toMatch(
        /\bmin(?:ute)?s?\b|\d\s*(?:h|hr|hrs|hours?)\b|\bdriv(?:e|ing)\b|\bby road\b|\bby car\b/i,
      );
      expect(text, `${kind}: a rating`).not.toMatch(/[★☆]|\b\d(\.\d)?\s*\/\s*5\b|\bstars?\b|\brated?\b|\brating\b/i);
      expect(row, `${kind}: a picture`).not.toMatch(/<img\b/i);
      // only straight-line distance is ever given
      expect(text, `${kind}: a distance that is not a straight line`).toContain(STRAIGHT_LINE_LABEL);
    }
  });

  test('every stop prints its own facilities, not one per page', async () => {
    const html = await renderRoute(servicesBody(() => [rest, service]));
    expect(occurrences(html, 'data-testid="service-facilities"')).toBe(stages * 2);
  });
});

// ── 4. THE THREE STATES, AND THE ONE THAT MUST NOT BECOME THE SECOND ─────

test.describe('🔴 not known is never printed as no', () => {
  const NO_ANSWER: [string, unknown][] = [
    ['an API that predates the field (no `facilities` at all)', undefined],
    ['null', null],
    ['an empty object', {}],
    ['five written unknowns', Object.fromEntries(FACILITY_KEYS.map((k) => [k, 'unknown']))],
    ['values that are not the three words', { toilets: 'maybe', shower: null, drinkingWater: 'YES', dumpStation: 1, fee: true }],
    ['a string where an object was expected', 'toilets=yes'],
  ];

  for (const [why, facilities] of NO_ANSWER) {
    for (const kind of ['rest_area', 'service_area']) {
      test(`${kind} with ${why}: five "Not known", no "No", no "Yes"`, async () => {
        const over: Wire = facilities === undefined ? {} : { facilities };
        const html = await renderRoute(servicesBody(() => [wire(kind, over)]));
        const text = facilitiesText(rowOf(html, kind));
        expect(count(text, /: Not known/g), text).toBe(5);
        // 🔴 `No\b` does not match "Not": a word boundary is needed after it.
        expect(text, 'a gap was printed as a no').not.toMatch(/: No\b/);
        expect(text, 'a gap was printed as a yes').not.toMatch(/: Yes\b/);
      });
    }
  }

  // The other direction, so "never prints No" cannot be satisfied by a
  // component that has simply stopped printing it.
  test('five written noes are five "No" and not one "Not known"', async () => {
    const html = await renderRoute(
      servicesBody(() => [
        wire('rest_area', {
          facilities: Object.fromEntries(FACILITY_KEYS.map((k) => [k, 'no'])),
        }),
      ]),
    );
    const text = facilitiesText(rowOf(html, 'rest_area'));
    expect(count(text, /: No\b/g), text).toBe(5);
    expect(text).not.toContain('Not known');
  });

  test('five written yeses are five "Yes"', async () => {
    const html = await renderRoute(
      servicesBody(() => [
        wire('service_area', {
          facilities: Object.fromEntries(FACILITY_KEYS.map((k) => [k, 'yes'])),
        }),
      ]),
    );
    const text = facilitiesText(rowOf(html, 'service_area'));
    expect(count(text, /: Yes\b/g), text).toBe(5);
  });

  // 🔴 THE FIVE ARE FIVE DIFFERENT FACILITIES. A swap of two keys on the
  // way to the page would print "Shower: Yes" for a toilet; one answer per
  // facility makes that a red test.
  test('each facility word is the facility’s own', async () => {
    const html = await renderRoute(
      servicesBody(() => [
        wire('rest_area', {
          facilities: {
            toilets: 'yes',
            shower: 'no',
            drinkingWater: 'unknown',
            dumpStation: 'yes',
            fee: 'no',
          },
        }),
      ]),
    );
    const text = facilitiesText(rowOf(html, 'rest_area'));
    expect(text).toContain('Toilets: Yes');
    expect(text).toContain('Shower: No');
    expect(text).toContain('Drinking water: Not known');
    expect(text).toContain('Chemical toilet disposal: Yes');
    expect(text).toContain('Fee: No');
  });

  // 🔴 CAMP-255 SAYS "NOT KNOWN" FOR THE SAME STATE. One word for one idea,
  // read off both pages' rendered text.
  test('the third word is the one the overnight answer uses', async () => {
    const overnight = visibleText(renderComponent(OvernightStay, { overnight: null }));
    expect(overnight).toContain(OVERNIGHT_LABEL.unknown);

    const html = await renderRoute(servicesBody(() => [wire('rest_area')]));
    expect(facilitiesText(rowOf(html, 'rest_area'))).toContain(`: ${OVERNIGHT_LABEL.unknown}`);
  });
});

// ── 5. THE FACILITIES BELONG TO THE TWO KINDS ────────────────────────────

test.describe('the facilities are printed for the two stopping places and no other kind', () => {
  test('🔴 a fuel station or a dump point whose payload carries facilities prints none', async () => {
    const carried = {
      toilets: 'yes',
      shower: 'yes',
      drinkingWater: 'yes',
      dumpStation: 'yes',
      fee: 'no',
    };
    const html = await renderRoute(
      servicesBody(() => [
        wire('fuel', { facilities: carried }),
        wire('dump', { facilities: carried }),
        wire('shelter', { facilities: carried }),
      ]),
    );
    for (const kind of ['fuel', 'dump', 'shelter']) {
      expect(rowOf(html, kind), kind).not.toContain('service-facilities');
      expect(visibleText(rowOf(html, kind)), kind).not.toMatch(/Toilets:|Shower:|Fee:/);
    }
    expect(occurrences(html, 'data-testid="service-facilities"')).toBe(0);
  });
});

// ── 6. ABSENT, AND COULD-NOT-LOOK ────────────────────────────────────────

test.describe('when there is no rest area, and when we could not look', () => {
  test('🔴 nothing within the radius: the row says our database holds none, and prints no facilities', async () => {
    const html = await renderRoute(servicesBody(() => [wire('fuel')]));
    expect(occurrences(html, 'data-testid="service-rest_area-absent"')).toBe(stages);
    expect(occurrences(html, 'data-testid="service-service_area-absent"')).toBe(stages);
    expect(occurrences(html, 'data-testid="service-facilities"')).toBe(0);
    const text = visibleText(html);
    expect(text).toContain('Our database holds no rest area within 25 km of this stop.');
    expect(text).toContain('Our database holds no service area within 25 km of this stop.');
  });

  test('🔴 the API is down: no rest-area claim of any kind, and no absence', async () => {
    const html = await renderRoute(null);
    const text = visibleText(html);
    expect(text).not.toContain('holds no rest area');
    expect(text).not.toContain('holds no service area');
    expect(occurrences(html, 'data-testid="service-facilities"')).toBe(0);
    expect(occurrences(html, 'data-testid="stage-services-unavailable"')).toBe(stages);
  });
});

// ── 7. WHAT THE PAGE SAYS ABOUT THE GAP ──────────────────────────────────

test.describe('the page says what "Not known" means, and what we do not know', () => {
  test('🔴 once per stop: a gap is not a no, and the condition of a toilet is not in open data', async () => {
    const html = await renderRoute(servicesBody(() => [wire('rest_area')]));
    const text = visibleText(html);
    const said = count(text, /“Not known” means nobody has written it down, which is not the same as “No”\./g);
    expect(said, 'the explanation of the third state is not on every stop').toBe(stages);
    const owner = count(text, /Whether a toilet is clean or working is not in open data, so nothing here says\./g);
    expect(owner, 'the page does not say it knows nothing about a toilet’s condition').toBe(stages);
  });

  test('the sources paragraph names the new kinds as OpenStreetMap-only', async () => {
    const html = await renderRoute(servicesBody(() => []));
    expect(visibleText(html)).toContain(
      'rest areas and service areas all come from OpenStreetMap alone',
    );
  });
});

// ── 8. THE READER OF THE PAYLOAD, ON ITS OWN ─────────────────────────────

test.describe('readFacilities', () => {
  test('is total, and no input makes a gap into a no', () => {
    const inputs: unknown[] = [
      undefined, null, 0, 1, '', 'yes', [], [1], {}, { toilets: undefined },
      { toilets: 'Yes' }, { toilets: ' yes' }, { toilets: true }, { toilets: 'designated' },
    ];
    for (const raw of inputs) {
      const out = readFacilities(raw);
      expect(Object.keys(out).sort()).toEqual([...FACILITY_KEYS].sort());
      for (const key of FACILITY_KEYS) {
        expect(out[key], `${JSON.stringify(raw)} → ${key}`).toBe('unknown');
      }
    }
  });

  test('keeps exactly the two words that are answers', () => {
    expect(readFacilities({ toilets: 'yes', shower: 'no' })).toMatchObject({
      toilets: 'yes',
      shower: 'no',
      fee: 'unknown',
    });
  });
});
