import { expect, test } from '@playwright/test';
import CampsitePage from '@/app/camping/[country]/[region]/[slug]/page';
import { renderAsyncComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-256 — what the CAMPSITE PAGE says about when its record was last
// edited in OpenStreetMap.
//
// 🔴 EVERY ASSERTION READS THE HTML THE PAGE RENDERS, through the same
// `visibleText` the other page specs use: hidden elements removed first, no
// attributes, no class names, no `data-testid`. The real `CampsitePage` is
// rendered with `fetch` swapped for a canned API, so a component that is
// right while the PAGE hands it the wrong field — `lastSeenAt` for
// `osmRecordEditedAt`, the card's whole risk — is caught here and nowhere
// else.
//
// 🔴 THE TWO DATES ARE YEARS APART on purpose. The page holds both: the day
// our importer last found the place (this week, for nearly every campsite)
// and the day a mapper last edited it. If they were close together a page
// reading the wrong one would pass.
//
// The page stamps the grade with the build's clock, so the dates below are
// offsets from NOW — 100, 400 and 1 500 days, far from any edge — and the
// month names in the expectations come from a table written out here, not
// from the `toLocaleDateString` the component uses.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December',
];
/** "June 2023" for an instant, from the table above, in UTC. */
const monthYear = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

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

/** A campsite as the API returns it. Only what the page reads. */
const spot = (extra: Record<string, unknown>) => ({
  slug: 'camping-test',
  name: 'Camping Test',
  country: 'hr',
  region: 'Istria',
  type: 'paid',
  lat: 45.1,
  lon: 13.9,
  amenities: {
    electricity: 'yes',
    water: 'unknown',
    shower: 'yes',
    toilets: 'unknown',
    dogFriendly: 'unknown',
    wifi: 'unknown',
    greyWater: 'unknown',
    laundry: 'unknown',
    wheelchair: 'unknown',
    wheelchairFull: 'unknown',
  },
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
    {
      id: 'osm',
      ref: 'w1',
      updatedAt: '2026-10-12',
      fields: ['name', 'location', 'amenities'],
    },
  ],
  warningAreas: null,
  tariffs: [],
  ...extra,
});

const PARAMS = { country: 'hr', region: 'istria', slug: 'camping-test' };

async function pageText(extra: Record<string, unknown>): Promise<string> {
  let html = '';
  await withFetch(
    (url) =>
      url.includes('/spots/hr/istria/camping-test')
        ? json({ spot: spot(extra), nearby: [] })
        : json({}, 404),
    async () => {
      html = await renderAsyncComponent(CampsitePage, {
        params: Promise.resolve(PARAMS),
      });
    },
  );
  return visibleText(html);
}

/**
 * The sentence the page prints, from "Record last edited:" to the end of
 * the date-and-caption part. The fixed explanatory sentence that follows
 * is read separately.
 */
const recordLine = (text: string): string | null => {
  const m = /Record last edited: .*?(?= This is the last time| We hold no edit date| Getting there|$)/s.exec(text);
  return m ? m[0].trim() : null;
};

/**
 * The WHOLE block as the page prints it: from the label to the heading of the
 * next section, with nothing cut off.
 *
 * 🔴 `recordLine` above stops at the fixed sentence, which is right for
 * reading the date line and was WRONG as the only guard: whatever is added
 * after that point was never compared with anything. This keeps everything
 * the page prints in between, so a sentence appended anywhere in the block is
 * part of what the test compares.
 */
const recordBlock = (text: string): string | null => {
  const m = /Record last edited: .*?(?= Getting there|$)/s.exec(text);
  return m ? m[0].trim() : null;
};

const UNKNOWN_SENTENCE =
  'We hold no edit date for this place from OpenStreetMap or DATAtourisme.';
const CAVEAT_DT =
  'This is the last time the source system behind DATAtourisme updated this record, as of our last import, not the day we last checked it. An older date says when it was last touched, not whether it is right.';

/** A source entry as the API sends it. `updatedAt` is a DAY for DATAtourisme. */
const datatourisme = (updatedAt: string) => ({
  id: 'datatourisme',
  ref: 'https://data.datatourisme.fr/13/71389ebb-090b-3ff0-ac17-386c0ab52a21',
  updatedAt,
  fields: ['name', 'location'],
});
const osmLookedThisWeek = {
  id: 'osm',
  ref: 'w1',
  updatedAt: '2026-10-12',
  fields: ['name', 'location', 'amenities'],
};
/** `YYYY-MM-DD`, as DATAtourisme gives it: no time of day. */
const dayAgo = (n: number) => daysAgo(n).slice(0, 10);
const CAVEAT =
  'This is the last time a mapper changed the OpenStreetMap record this page is built on, not the day we last checked it. An older date says when it was last touched, not whether it is right.';

test.describe('the campsite page says when its record was last edited', () => {
  // 🔴 The anchor, asserted first. If the page rendered nothing at all,
  // every "does not say X" below would pass over an empty string.
  test('anchor: the page renders, with the campsite, the facilities and the line', async () => {
    const text = await pageText({ osmRecordEditedAt: daysAgo(400) });
    expect(text).toContain('Camping Test');
    expect(text).toContain('Facilities');
    expect(text).toContain('Record last edited:');
    expect(text.length).toBeGreaterThan(300);
  });

  test('within the last year: the month, and a caption that says so', async () => {
    const at = daysAgo(100);
    const text = await pageText({ osmRecordEditedAt: at });
    expect(recordLine(text)).toBe(
      `Record last edited: ${monthYear(at)} — within the last year`,
    );
  });

  test('between one and three years: the month, and the caption for it', async () => {
    const at = daysAgo(400);
    const text = await pageText({ osmRecordEditedAt: at });
    expect(recordLine(text)).toBe(
      `Record last edited: ${monthYear(at)} — between one and three years ago`,
    );
  });

  test('more than three years: still shown, with its month and its caption', async () => {
    const at = daysAgo(1500);
    const text = await pageText({ osmRecordEditedAt: at });
    expect(recordLine(text)).toBe(
      `Record last edited: ${monthYear(at)} — more than three years ago`,
    );
  });

  test('the fixed sentence says what the date is — and is not', async () => {
    const text = await pageText({ osmRecordEditedAt: daysAgo(1500) });
    expect(text).toContain(CAVEAT);
  });

  // 🔴 THE CARD'S RISK. The page holds two dates; the line must carry the
  // OSM one, and the box at the foot must still carry ours.
  test('🔴 with the dates years apart, the line carries the EDIT date and the source box still carries the date we looked', async () => {
    const edited = daysAgo(1500);
    const text = await pageText({
      osmRecordEditedAt: edited,
      lastSeenAt: '2026-10-12T05:00:00.000Z',
    });
    const line = recordLine(text);
    expect(line).toContain(monthYear(edited));
    // The importer's date is 12 October 2026 and is nowhere in the line…
    expect(line).not.toContain('October 2026');
    // …but it is still on the page, in the box that says what it is.
    expect(text).toContain('Last checked against this source on');
    expect(text).toContain('12 October 2026');
  });

  test('🔴 no edit date is "Not known" — even though the page holds a last-seen date of this week', async () => {
    const text = await pageText({
      osmRecordEditedAt: null,
      lastSeenAt: '2026-10-12T05:00:00.000Z',
    });
    expect(recordLine(text)).toBe('Record last edited: Not known');
    // It must not borrow the importer's date, in any wording.
    expect(recordLine(text)).not.toContain('2026');
    // …and the fixed sentence about a date is not printed under no date;
    // the one that says which date is missing is.
    expect(text).not.toContain('This is the last time a mapper changed');
    expect(text).toContain(`Record last edited: Not known ${UNKNOWN_SENTENCE}`);
  });

  test('a date is never followed by the "we hold no edit date" sentence', async () => {
    const text = await pageText({ osmRecordEditedAt: daysAgo(400) });
    expect(text).not.toContain(UNKNOWN_SENTENCE);
  });

  test('an API that has never heard of the field reads as "Not known", not as a crash', async () => {
    const text = await pageText({});
    expect(recordLine(text)).toBe('Record last edited: Not known');
  });

  test('a value that is not an OSM edit date is "Not known": garbage, the future, the year 1970', async () => {
    for (const bad of ['last Tuesday', '2099-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', 1787953167, {}]) {
      const text = await pageText({ osmRecordEditedAt: bad });
      expect([JSON.stringify(bad), recordLine(text)]).toEqual([
        JSON.stringify(bad),
        'Record last edited: Not known',
      ]);
    }
  });

  test('it sits under the facilities it describes, before "Getting there"', async () => {
    const text = await pageText({ osmRecordEditedAt: daysAgo(400) });
    const facilities = text.indexOf('Facilities');
    const line = text.indexOf('Record last edited:');
    const there = text.indexOf('Getting there');
    expect(facilities).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(facilities);
    expect(there).toBeGreaterThan(line);
  });

  test('it says it for a campsite whose owner has corrected its name, too', async () => {
    const at = daysAgo(400);
    const text = await pageText({
      osmRecordEditedAt: at,
      ownerOverrides: { name: 'Camping Owner' },
    });
    expect(text).toContain('Camping Owner');
    expect(recordLine(text)).toBe(
      `Record last edited: ${monthYear(at)} — between one and three years ago`,
    );
  });

  // 🔴 THE RED RULE AS A PROPERTY. The page's block is exactly the template —
  // see record-edited-text.spec.ts for why equality and not a word list. This
  // is the same property read off the REAL page, so a sentence added
  // anywhere between the label and the next section is compared too.
  test('🔴 the block on the page is the date line and the fixed sentence, and nothing else — in every grade', async () => {
    for (const [days, caption] of [
      [100, 'within the last year'],
      [400, 'between one and three years ago'],
      [1500, 'more than three years ago'],
    ] as [number, string][]) {
      const at = daysAgo(days);
      const text = await pageText({ osmRecordEditedAt: at });
      expect(recordBlock(text)).toBe(
        `Record last edited: ${monthYear(at)} — ${caption} ${CAVEAT}`,
      );
    }
  });

  test('🔴 …and so is the block with no date', async () => {
    const text = await pageText({ osmRecordEditedAt: null });
    expect(recordBlock(text)).toBe(
      `Record last edited: Not known ${UNKNOWN_SENTENCE}`,
    );
  });

  test('anchor for the two above: the block really is found, and the next heading really ends it', async () => {
    const text = await pageText({ osmRecordEditedAt: daysAgo(400) });
    expect(recordBlock(text)?.length).toBeGreaterThan(200);
    expect(recordBlock(text)).not.toContain('Getting there');
    expect(text).toContain('Getting there');
  });

  // ---- a record that comes ONLY from DATAtourisme -------------------------
  //
  // It has no OpenStreetMap date, but the source dates its own records
  // (`sources[].updatedAt`, a day). Shown in the same words, with the source's
  // name beside it, and the block still equal to its template.

  test('🔴 a DATAtourisme-only page: the source date, the source named, its own sentence, nothing else', async () => {
    for (const [days, caption] of [
      [100, 'within the last year'],
      [400, 'between one and three years ago'],
      [1500, 'more than three years ago'],
    ] as [number, string][]) {
      const day = dayAgo(days);
      const text = await pageText({
        osmRecordEditedAt: null,
        sources: [datatourisme(day)],
      });
      expect(recordBlock(text)).toBe(
        `Record last edited: ${monthYear(day)} (DATAtourisme) — ${caption} ${CAVEAT_DT}`,
      );
    }
  });

  test('the oldest record we hold, 2002-05-24, is printed — not read as "before OpenStreetMap"', async () => {
    const text = await pageText({
      osmRecordEditedAt: null,
      sources: [datatourisme('2002-05-24')],
    });
    expect(recordBlock(text)).toBe(
      `Record last edited: May 2002 (DATAtourisme) — more than three years ago ${CAVEAT_DT}`,
    );
  });

  test('it is the same date the source box prints, and the box still says whose', async () => {
    const day = dayAgo(400);
    const text = await pageText({
      osmRecordEditedAt: null,
      sources: [datatourisme(day)],
    });
    expect(text).toContain('Last updated by the source on');
    // The box prints the full day; the block prints the month of that day.
    const full = new Date(day).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    expect(text).toContain(full);
    expect(recordBlock(text)).toContain(monthYear(day));
  });

  test('🔴 an OpenStreetMap edit date wins over a DATAtourisme date, and the OSM wording is used', async () => {
    const osm = daysAgo(400);
    const text = await pageText({
      osmRecordEditedAt: osm,
      sources: [osmLookedThisWeek, datatourisme(dayAgo(100))],
    });
    expect(recordBlock(text)).toBe(
      `Record last edited: ${monthYear(osm)} — between one and three years ago ${CAVEAT}`,
    );
    expect(recordBlock(text)).not.toContain('DATAtourisme');
  });

  test('🔴 the OpenStreetMap source entry`s updatedAt — the day we looked — is never the edit date', async () => {
    // `sources` holds an `osm` entry dated 12 October 2026 and nothing else.
    const text = await pageText({
      osmRecordEditedAt: null,
      sources: [osmLookedThisWeek],
    });
    expect(recordBlock(text)).toBe(
      `Record last edited: Not known ${UNKNOWN_SENTENCE}`,
    );
  });

  test('a source the registry does not mark as dating its own records is not read', async () => {
    const text = await pageText({
      osmRecordEditedAt: null,
      sources: [{ id: 'eea-bathing-water', ref: 'x', updatedAt: dayAgo(30), fields: [] }],
    });
    expect(recordBlock(text)).toBe(
      `Record last edited: Not known ${UNKNOWN_SENTENCE}`,
    );
  });
});
