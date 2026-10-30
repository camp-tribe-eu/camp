import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readSpots } from '../../../../scripts/seed-rows.mjs';
import { expect, test } from '@playwright/test';
import CampsitePage from '@/app/camping/[country]/[region]/[slug]/page';
import { spotFacts } from '@/lib/spot-facts';
import type { Spot } from '@/lib/api';
import { CLIENT_ISLANDS } from './client-islands';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';

// The campsite page: the line of facts under the heading, and the scales
// in "What's around it" (docs/design-audit.md §10).
//
// 🔴 EVERY EXPECTED STRING AND NUMBER BELOW IS A CONSTANT, WORKED OUT BY
// HAND from the row as typed in the spec, never computed here from the
// fields the code reads. 2 100 m of a 20 km scale is 10.5 % because
// 2100 / 20000 = 0.105, and "10.5" is typed in; a spec that re-derived it
// with the implementation's own division would agree with any bug in it.
//
// 🔴 EVERY CLAIM IS READ OFF THE HTML THE REAL `CampsitePage` RENDERS, with
// `fetch` swapped for a canned API. The text of the line is the text a
// reader sees (`visibleText`: hidden elements removed, tags gone). The one
// thing that cannot be a sentence is the width of a bar, and that is read
// from the `style` the page delivers for the bar — the drawing itself.
//
// 🔴 THE TWO MUTATIONS THE CARD NAMES are run against this file, and the
// matrix is in the pull request:
//   · a fact with no data printed as "—"            → the line holds a dash
//   · the scale normalised to the farthest neighbour → the bars change width

type Fetcher = (url: string) => Response | Promise<Response>;

async function withFetch(impl: Fetcher, run: () => Promise<void>) {
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

const UNKNOWN = {
  electricity: 'unknown',
  water: 'unknown',
  shower: 'unknown',
  toilets: 'unknown',
  dogFriendly: 'unknown',
  wifi: 'unknown',
  greyWater: 'unknown',
  laundry: 'unknown',
  wheelchair: 'unknown',
  wheelchairFull: 'unknown',
};

/** A campsite as the API returns it: only what the page reads. */
const spot = (extra: Record<string, unknown>) => ({
  slug: 'camping-test',
  name: 'Camping Test',
  country: 'hr',
  region: 'Istria',
  type: 'paid',
  lat: 45.1,
  lon: 13.9,
  amenities: { ...UNKNOWN },
  ownerOverrides: {},
  lastSeenAt: '2026-10-12T05:00:00.000Z',
  missingSince: null,
  context: {},
  description: null,
  descriptionLang: null,
  stars: null,
  website: null,
  contact: {},
  sources: [
    { id: 'osm', ref: 'w1', updatedAt: '2026-10-12', fields: ['name', 'location', 'amenities'] },
  ],
  warningAreas: null,
  tariffs: [],
  ...extra,
});

const PARAMS = { country: 'hr', region: 'istria', slug: 'camping-test' };

async function render(extra: Record<string, unknown>): Promise<string> {
  let html = '';
  await withFetch(
    (url) =>
      url.includes('/spots/hr/istria/camping-test')
        ? json({ spot: spot(extra), nearby: [] })
        : json({}, 404),
    async () => {
      html = await renderAsyncComponent(
        CampsitePage,
        { params: Promise.resolve(PARAMS) },
        { omit: CLIENT_ISLANDS },
      );
    },
  );
  return html;
}

/** What a reader reads in the line of facts, or null when there is no line. */
function factsLine(html: string): string | null {
  const m = /<ul[^>]*aria-label="Key facts"[^>]*>[\s\S]*?<\/ul>/.exec(html);
  return m ? visibleText(m[0]) : null;
}

/** The "What's around it" section, as markup. */
function aroundSection(html: string): string {
  const m = /<section[^>]*>\s*<h2[^>]*>What.s around it<\/h2>[\s\S]*?<\/section>/.exec(html);
  expect(m, 'the page has no "What’s around it" section').not.toBeNull();
  return m![0];
}

/** One row of that section, as markup: from its marker to the next one. */
function aroundRow(html: string, key: string): string | null {
  const section = aroundSection(html);
  const mark = section.indexOf(`data-row="${key}"`);
  if (mark < 0) return null;
  const start = section.lastIndexOf('<div', mark);
  const next = section.indexOf('data-row="', mark + 1);
  const end = next < 0 ? section.indexOf('</dl>', mark) : section.lastIndexOf('<div', next);
  return section.slice(start, end);
}

/** The width, in percent, of the bar drawn in a row. */
function fillOf(row: string): number | null {
  const m = /style="width:([\d.]+)%"/.exec(row);
  return m ? Number(m[1]) : null;
}

/** The row's label and value as a reader reads them. */
const rowText = (row: string) => visibleText(row);

// ═══ 1. The line of facts ══════════════════════════════════════════════

test.describe('the line of facts under the heading', () => {
  test('🔴 a campsite with nothing recorded but its type gets no line', async () => {
    // Type is the one fact every row has. One fact is the eyebrow above the
    // heading said twice, so there is no line.
    const html = await render({ context: {}, amenities: { ...UNKNOWN } });
    expect(factsLine(html)).toBeNull();
    expect(visibleText(html)).not.toContain('Type Campsite');
  });

  test('🔴 a campsite whose only extra is a nameless water gets no line either', async () => {
    // The water is there (`{ m: 71, kind: 'river' }`) and has no name: the
    // line says "nearest water" only with a name and a distance, so this is
    // still one fact. A river without a name is a property of the map.
    const html = await render({ context: { water: { m: 71, kind: 'river' } } });
    expect(factsLine(html)).toBeNull();
  });

  test('🔴 a campsite where "no" is all that is recorded gets no line', async () => {
    // Three facilities recorded as ABSENT. A count of "known" facilities
    // would print "3 recorded" over a campsite that has none of them.
    const html = await render({
      amenities: { ...UNKNOWN, shower: 'no', toilets: 'no', wifi: 'no' },
    });
    expect(factsLine(html)).toBeNull();
  });

  test('🔴 three facts: exactly those three, with the names and distances of the data', async () => {
    // Kamp Trnovo, Kobarid (ci-seed.sql): town Kobarid 4 926 m, stop Kanal
    // 23 213 m, a river 71 m away WITHOUT a name, no facility recorded.
    const html = await render({
      context: {
        town: { m: 4926, name: 'Kobarid' },
        water: { m: 71, kind: 'river' },
        station: { m: 23213, name: 'Kanal' },
        supermarket: { m: 4626, name: 'Mercator' },
      },
    });
    expect(factsLine(html)).toBe(
      'Type Campsite Nearest town Kobarid, 4.9 km Railway stop Kanal, 23.2 km',
    );
  });

  test('🔴 five facts, from a real row of the CI seed (Autocamp Marko, Zadarska)', async () => {
    // Worked out by hand from the row: river "Velika Paklenica" 293 m, town
    // Obrovac 20 668 m, stop Lovinac 19 566 m; amenities yes: wifi, water,
    // shower, toilets, electricity — FIVE general ones — plus wheelchair and
    // wheelchairFull, which are the accessibility group and are not summed.
    const html = await render({
      amenities: {
        ...UNKNOWN,
        wifi: 'yes',
        water: 'yes',
        shower: 'yes',
        toilets: 'yes',
        electricity: 'yes',
        wheelchair: 'yes',
        wheelchairFull: 'yes',
      },
      context: {
        town: { m: 20668, name: 'Obrovac' },
        water: { m: 293, kind: 'river', name: 'Velika Paklenica' },
        station: { m: 19566, name: 'Lovinac' },
        supermarket: { m: 156, name: 'Tommy' },
      },
    });
    expect(factsLine(html)).toBe(
      'Type Campsite ' +
        'Nearest water Velika Paklenica, 293 m ' +
        'Nearest town Obrovac, 20.7 km ' +
        'Railway stop Lovinac, 19.6 km ' +
        'Facilities 5 recorded',
    );
  });

  test('two facts are enough: type and one facility', async () => {
    const html = await render({ amenities: { ...UNKNOWN, shower: 'yes' } });
    expect(factsLine(html)).toBe('Type Campsite Facilities 1 recorded');
  });

  test('a free campsite says so, in the words of the type label', async () => {
    const html = await render({
      type: 'free',
      context: { town: { m: 900, name: 'Pula' } },
    });
    expect(factsLine(html)).toBe('Type Free campsite Nearest town Pula, 900 m');
  });

  test('a town with no name is "Nearest town" and the distance, not a gap', async () => {
    const html = await render({ context: { town: { m: 2100 } } });
    expect(factsLine(html)).toBe('Type Campsite Nearest town 2.1 km');
  });

  test('🔴 a named water with no distance is not a fact', async () => {
    const html = await render({
      context: { water: { name: 'Lake Bled', kind: 'lake' }, town: { m: 2100, name: 'Bled' } },
    });
    expect(factsLine(html)).toBe('Type Campsite Nearest town Bled, 2.1 km');
    expect(visibleText(aroundSection(html))).not.toContain('undefined');
  });

  test('🔴 a railway stop beyond 100 km is an artefact of the extract, not a fact', async () => {
    // 561 live rows in the local database say so; the largest is 1 887 707 m.
    const html = await render({
      context: { town: { m: 2100, name: 'Bled' }, station: { m: 1887707, name: 'Far Away' } },
    });
    expect(factsLine(html)).toBe('Type Campsite Nearest town Bled, 2.1 km');
  });

  test('the edge of that rule: exactly 100 km still counts, 100 001 m does not', async () => {
    const at = await render({
      context: { town: { m: 2100, name: 'Bled' }, station: { m: 100000, name: 'Edge' } },
    });
    expect(factsLine(at)).toBe(
      'Type Campsite Nearest town Bled, 2.1 km Railway stop Edge, 100.0 km',
    );
    const over = await render({
      context: { town: { m: 2100, name: 'Bled' }, station: { m: 100001, name: 'Edge' } },
    });
    expect(factsLine(over)).toBe('Type Campsite Nearest town Bled, 2.1 km');
  });

  test('a fact with nothing behind it is never a dash or an "n/a"', async () => {
    const html = await render({
      context: { town: { m: 2100, name: 'Bled' } },
      amenities: { ...UNKNOWN, wifi: 'yes' },
    });
    const line = factsLine(html)!;
    expect(line).toBe('Type Campsite Nearest town Bled, 2.1 km Facilities 1 recorded');
    for (const filler of ['—', '–', 'n/a', 'N/A', 'unknown', 'Unknown', 'undefined', 'null']) {
      expect(line, filler).not.toContain(filler);
    }
  });

  test('the owner overrides win: a campsite the owner has told us about is read as told', async () => {
    // The page applies the overrides before it builds the line, so a fact the
    // owner supplied counts and one the source holds but the owner has
    // replaced is the owner's.
    const html = await render({
      amenities: { ...UNKNOWN, wifi: 'no' },
      ownerOverrides: { amenities: { wifi: 'yes' } },
    });
    expect(factsLine(html)).toBe('Type Campsite Facilities 1 recorded');
  });
});

// ═══ 2. How many campsites get the line — over the CI seed ═════════════

test.describe('over the 72 campsites of the CI seed', () => {
  const rows = readSpots(
    readFileSync(join(__dirname, '../../../api/test/fixtures/ci-seed.sql'), 'utf8'),
  ) as Record<string, string | null>[];

  const facts = rows.map((r) => ({
    slug: r.slug as string,
    facts: spotFacts({
      type: r.type as Spot['type'],
      amenities: JSON.parse(r.amenities ?? '{}') as Spot['amenities'],
      context: JSON.parse(r.context ?? '{}') as Spot['context'],
    }),
  }));

  test('anchor: the seed is the 72 rows it says it is', () => {
    expect(rows.length).toBe(72);
  });

  test('🔴 70 of 72 get a line; the two that do not are the two with no context and no facility', () => {
    // Counted by hand from the dump of the seed (`kamp-vinia` and `3` are
    // the only rows with `context = {}` and no `yes` anywhere).
    const without = facts.filter((f) => f.facts.length === 0).map((f) => f.slug);
    expect(without.sort()).toEqual(['3', 'kamp-vinia']);
    expect(facts.length - without.length).toBe(70);
  });

  test('every line there is has at least two facts and starts with the type', () => {
    for (const f of facts.filter((x) => x.facts.length > 0)) {
      expect(f.facts.length, f.slug).toBeGreaterThanOrEqual(2);
      expect(f.facts[0].key, f.slug).toBe('type');
    }
  });
});

// ═══ 3. The scales ═════════════════════════════════════════════════════

test.describe('"What’s around it": distances drawn to a fixed scale', () => {
  test('🔴 the bar is distance over the END OF ITS SCALE — 2 100 m of 20 km is 10.5 %', async () => {
    const html = await render({ context: { town: { m: 2100, name: 'Bled' } } });
    const row = aroundRow(html, 'town')!;
    expect(rowText(row)).toContain('Bled 2.1 km');
    expect(fillOf(row)).toBe(10.5);
    // …and the end of the scale is written under the bar.
    expect(rowText(row)).toContain('0 20 km');
  });

  test('all four scales, each at its own fixed end', async () => {
    // water 500 / 5 000 = 10; town 2 100 / 20 000 = 10.5;
    // supermarket 3 000 / 10 000 = 30; stop 7 500 / 30 000 = 25.
    const html = await render({
      context: {
        water: { m: 500, kind: 'lake', name: 'Lake Bled' },
        town: { m: 2100, name: 'Bled' },
        supermarket: { m: 3000, name: 'Spar' },
        station: { m: 7500, name: 'Lesce-Bled' },
      },
    });
    expect(fillOf(aroundRow(html, 'water')!)).toBe(10);
    expect(fillOf(aroundRow(html, 'town')!)).toBe(10.5);
    expect(fillOf(aroundRow(html, 'supermarket')!)).toBe(30);
    expect(fillOf(aroundRow(html, 'stop')!)).toBe(25);
    expect(rowText(aroundRow(html, 'water')!)).toContain('0 5 km');
    expect(rowText(aroundRow(html, 'supermarket')!)).toContain('0 10 km');
    expect(rowText(aroundRow(html, 'stop')!)).toContain('0 30 km');
  });

  test('🔴 the scale does not depend on the other rows: a remote valley is not drawn as a village', async () => {
    // The same town, 2 100 m. Alone on the page, and beside a shop 9 000 m
    // away and a stop 30 000 m away. Normalised to the farthest of the rows
    // the first would fill the bar (100) and the second 7; fixed, both are
    // 10.5, because 2.1 km is 2.1 km wherever the campsite stands.
    const alone = await render({ context: { town: { m: 2100, name: 'Bled' } } });
    const beside = await render({
      context: {
        town: { m: 2100, name: 'Bled' },
        supermarket: { m: 9000, name: 'Spar' },
        station: { m: 30000, name: 'Far' },
      },
    });
    expect(fillOf(aroundRow(alone, 'town')!)).toBe(10.5);
    expect(fillOf(aroundRow(beside, 'town')!)).toBe(10.5);
    expect(fillOf(aroundRow(beside, 'supermarket')!)).toBe(90);
    expect(fillOf(aroundRow(beside, 'stop')!)).toBe(100);
  });

  test('a distance beyond the end fills the bar and the figure is still the real one', async () => {
    const html = await render({ context: { town: { m: 45000, name: 'Far Town' } } });
    const row = aroundRow(html, 'town')!;
    expect(fillOf(row)).toBe(100);
    expect(rowText(row)).toContain('Far Town 45.0 km');
  });

  test('a campsite on the water draws a sliver, not a bar that is not there', async () => {
    // 15 m of 5 000 m is 0.3 %: the bar is that narrow and the figure says 15 m.
    const html = await render({
      context: { water: { m: 15, kind: 'sea' } },
    });
    const row = aroundRow(html, 'water')!;
    expect(fillOf(row)).toBe(0.3);
    expect(rowText(row)).toContain('Sea 15 m');
  });

  test('🔴 a figure with no distance has no row and no track', async () => {
    // The supermarket is named and has no `m`; the town's `m` is null.
    const html = await render({
      context: {
        supermarket: { name: 'Spar' },
        town: { m: null, name: 'Bled' },
        water: { m: 500, kind: 'lake', name: 'Lake Bled' },
      },
    });
    expect(aroundRow(html, 'supermarket')).toBeNull();
    expect(aroundRow(html, 'town')).toBeNull();
    expect(aroundRow(html, 'water')).not.toBeNull();
    const section = aroundSection(html);
    // One track in the section: the water's. Counted from the delivered markup.
    expect(section.match(/role="meter"/g)?.length).toBe(1);
    const text = visibleText(section);
    expect(text).not.toContain('Spar');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('null');
  });

  test('🔴 a campsite whose only figures have no distance says it has not been calculated', async () => {
    const html = await render({ context: { supermarket: { name: 'Spar' } } });
    expect(visibleText(aroundSection(html))).toContain(
      'The surroundings of this site have not been calculated yet.',
    );
    expect(aroundSection(html)).not.toContain('role="meter"');
  });

  test('elevation and terrain stay plain rows: they are not distances and get no bar', async () => {
    const html = await render({
      context: {
        town: { m: 2100, name: 'Bled' },
        elevation: 474,
        terrain: { type: 'hilly', relief: 120 },
      },
    });
    expect(rowText(aroundRow(html, 'elevation')!)).toBe('Elevation 474 m');
    expect(fillOf(aroundRow(html, 'elevation')!)).toBeNull();
    expect(rowText(aroundRow(html, 'terrain')!)).toBe('Terrain Hilly (120 m relief)');
    expect(fillOf(aroundRow(html, 'terrain')!)).toBeNull();
  });

  test('the section says what a bar means, once, and only when a bar is drawn', async () => {
    const drawn = await render({ context: { town: { m: 2100, name: 'Bled' } } });
    expect(visibleText(aroundSection(drawn))).toContain(
      'a full bar means that far or farther',
    );
    const plain = await render({ context: { elevation: 474 } });
    expect(visibleText(aroundSection(plain))).not.toContain('full bar');
  });

  test('the existing label of the stop is kept: the row says railway stop, not station', async () => {
    const html = await render({ context: { station: { m: 2100, name: 'Lesce-Bled' } } });
    expect(rowText(aroundRow(html, 'stop')!)).toContain('Lesce-Bled railway stop 2.1 km');
  });
});

// ═══ 4. The page stays static ══════════════════════════════════════════

test('🔴 the campsite page and everything it imports read no request', () => {
  // The page is one of 48 944 prerendered at build. A `headers()`, a
  // `cookies()`, a `no-store`, a `force-dynamic` anywhere in what it
  // imports, or a `searchParams` prop on the page, makes it a page rendered
  // per request — the one thing this change must not do. Walked through the
  // import graph (`@/` and relative imports) the way the hub pages' guard
  // walks theirs.
  const SRC = resolve(__dirname, '..', '..', 'src');
  const page = join(SRC, 'app', 'camping', '[country]', '[region]', '[slug]', 'page.tsx');
  const resolveImport = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/')
      ? join(SRC, spec.slice(2))
      : spec.startsWith('.')
        ? resolve(dirname(from), spec)
        : null;
    if (!base) return null;
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const p = base + ext;
      if (existsSync(p) && /\.tsx?$/.test(p)) return p;
    }
    return null;
  };
  const seen = new Set<string>();
  const queue = [page];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const next = resolveImport(file, m[1]);
      if (next) queue.push(next);
    }
  }
  // Anchor: the walk reached the pieces this change added, or it proves nothing.
  const names = [...seen].map((f) => f.slice(SRC.length + 1));
  expect(names).toContain('lib/spot-facts.ts');
  expect(names).toContain('components/spot-facts.tsx');
  expect(seen.size).toBeGreaterThan(15);

  const FORBIDDEN = [/\bheaders\(\)/, /\bcookies\(\)/, /no-store/, /force-dynamic/];
  const offenders: string[] = [];
  for (const file of seen) {
    const src = readFileSync(file, 'utf8');
    for (const re of FORBIDDEN) {
      if (re.test(src)) offenders.push(`${file.slice(SRC.length + 1)}: ${re.source}`);
    }
  }
  if (/\bsearchParams\b/.test(readFileSync(page, 'utf8'))) {
    offenders.push('page.tsx: searchParams in the page');
  }
  expect(offenders).toEqual([]);
});
