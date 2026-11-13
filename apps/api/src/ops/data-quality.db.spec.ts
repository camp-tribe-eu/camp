import { Client } from 'pg';
import {
  ATTRIBUTES,
  MEASURES,
  NOT_MEASURED,
  measure,
  qualitySql,
  share,
  type Line,
  type Measure,
  type Report,
} from './data-quality';

// CAMP-522 — the data-quality measures against a REAL PostgreSQL with
// PostGIS, on rows built so that every line has a count of its own.
//
// 🔴 THE FIXTURE IS THE TEST. On a table where every row is live, has a
// region, one source and no link, "rows", "campsites" and "campsites
// with a page" are one number, and a measure that confused them would
// pass. So each predicate a measure applies has, below, at least one row
// that only that predicate excludes — and the comment on the row says
// which. Break the predicate and that row is counted.
//
// 🔴 EXPECTED NUMBERS ARE WRITTEN OUT, counted by hand from the rows —
// not computed with the SQL under test, and not with a copy of it.
//
// 🔴 TEMP tables: they shadow the real ones for this session only, so
// the spec is safe on a database somebody else is using.
//
// 🔴 A MISSING DATABASE IS A FAILURE, NOT A SKIP.

const URL = process.env.CAMP_TEST_DATABASE_URL ?? process.env.CI_DATABASE_URL;

const id = (n: number) =>
  `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

type Row = {
  n: number;
  src: string | null | string[];
  /** Days ago the source last changed the record; DATAtourisme's `updatedAt`. */
  upd?: number;
  country?: string;
  region?: string | null;
  name?: string | null;
  lon?: number;
  lat?: number;
  outline?: boolean;
  seen?: number | null;
  missing?: number;
  edited?: number;
  website?: string;
  contact?: Record<string, string>;
  description?: string;
  stars?: number;
  amenities?: Record<string, string>;
  overnight?: string;
};

// Numbers 1–12 and 22 are OpenStreetMap rows, 13–19 and 23 DATAtourisme,
// 20–21 neither.
const A = (n: number, r: Omit<Row, 'n' | 'src'>): Row => ({
  n,
  src: 'osm',
  ...r,
});
const D = (n: number, r: Omit<Row, 'n' | 'src'>): Row => ({
  n,
  src: 'datatourisme',
  ...r,
});

const ROWS: Row[] = [
  // A1 — a French campsite two sources describe (D13 is folded into it).
  A(1, {
    country: 'FR',
    region: 'Bretagne',
    name: 'Camping du Lac',
    lon: 2,
    lat: 48,
    outline: true,
    seen: 1,
    edited: 30,
    stars: 3,
    overnight: 'allowed',
    contact: { website: 'https://www.lac.fr/x', phone: '+33 1' },
    amenities: { electricity: 'yes', water: 'unknown' },
  }),
  // A2 — the same, and its two sources DISAGREE (D14): place, site, stars.
  A(2, {
    country: 'FR',
    region: 'Bretagne',
    name: 'Les Pins',
    lon: 3,
    lat: 47,
    seen: 1,
    edited: 800,
    stars: 3,
    contact: { website: 'https://lespins.fr', email: 'a@lespins.fr' },
    amenities: { toilets: 'no', shower: 'yes' },
  }),
  // A3 — every amenity "unknown": a full object that answers nothing.
  // No edit date. Carries A12 (same source) and a DEAD link to D17.
  A(3, {
    country: 'DE',
    region: 'Bayern',
    name: 'Waldcamp',
    lon: 11,
    lat: 48,
    outline: true,
    seen: 1,
    contact: { openingHours: 'Apr-Oct' },
    amenities: {
      electricity: 'unknown',
      water: 'unknown',
      toilets: 'unknown',
      shower: 'unknown',
    },
  }),
  // A4 — no region and no name: a campsite, but it has no page.
  A(4, {
    country: 'DE',
    region: null,
    name: null,
    lon: 12,
    lat: 49,
    seen: 1,
    edited: 10,
    contact: { openingHours: 'all year' },
    amenities: { electricity: 'no' },
  }),
  // A5 — a country we hold and do not publish: a campsite, no page.
  // Its website is in `contact` only, and nothing is folded into it.
  A(5, {
    country: 'CY',
    region: 'Limassol',
    name: 'Cyprus Camp',
    lon: 33,
    lat: 34.7,
    seen: 1,
    edited: 20,
    stars: 2,
    contact: { website: 'https://cy.example' },
    amenities: { dogFriendly: 'yes' },
  }),
  // A6, A7 — gone from OpenStreetMap. A6 has an outline nobody may count.
  A(6, {
    country: 'IT',
    region: 'Toscana',
    name: 'Chiuso',
    lon: 11,
    lat: 43,
    outline: true,
    seen: 40,
    missing: 20,
  }),
  A(7, {
    country: 'IT',
    region: 'Toscana',
    name: 'Sparito',
    lon: 11.5,
    lat: 43,
    seen: 40,
    missing: 20,
  }),
  // A8, A9 — the same name in two cases, 0.003° of longitude apart at
  // 69°N: 120 m. A prefilter in "metres as degrees at the equator"
  // (0.00135°) loses this pair. A8 also has a GONE second copy (D19).
  A(8, {
    country: 'FI',
    region: 'Lappi',
    name: 'Camping Municipal',
    lon: 25,
    lat: 69,
    outline: true,
    seen: 1,
    edited: 100,
    contact: { openingHours: 'Jun-Aug' },
    amenities: { water: 'yes', electricity: 'no' },
  }),
  A(9, {
    country: 'FI',
    region: 'Lappi',
    name: 'camping municipal',
    lon: 25.003,
    lat: 69,
    seen: 1,
    overnight: 'forbidden',
    contact: { openingHours: 'Jun-Aug' },
    amenities: { water: 'yes' },
  }),
  // A10 — the same name again, 0.004° north: INSIDE the degree prefilter
  // (0.005°) and 445 m away. Only the test in metres keeps it out.
  A(10, {
    country: 'FI',
    region: 'Lappi',
    name: 'Camping Municipal',
    lon: 25,
    lat: 69.004,
    seen: 1,
    contact: { openingHours: 'Jun-Aug' },
    amenities: { shower: 'yes', water: 'no' },
  }),
  // A11 — not seen for 30 days, yet not stamped missing; edited 400 days
  // ago. Nameless, and it answers no amenity itself: its name and its one
  // answered amenity come from D18, folded in. It and D18 name the SAME
  // website domain and DIFFERENT stars.
  A(11, {
    country: 'SE',
    region: 'Skåne',
    name: null,
    lon: 13,
    lat: 56,
    seen: 30,
    edited: 400,
    stars: 4,
    contact: { website: 'https://vieux.se' },
  }),
  // A12 — a second OSM object for A3 (node + area): folded, SAME source.
  A(12, {
    country: 'DE',
    region: 'Bayern',
    name: 'Waldcamp',
    lon: 11.001,
    lat: 48,
    seen: 30,
    edited: 5,
    contact: { phone: '+49 1' },
  }),

  // D13 — second copy of A1: same website domain, same stars. Its
  // outline and its name (same as A1's, 40 m away) must not be counted.
  D(13, {
    country: 'FR',
    region: 'Bretagne',
    name: 'Camping du Lac',
    lon: 2.0005,
    lat: 48,
    outline: true,
    seen: 2,
    upd: 10,
    website: 'http://lac.fr',
    stars: 3,
    description: 'Au bord du lac.',
  }),
  // D14 — second copy of A2: 200 m off, another domain, another rating.
  D(14, {
    country: 'FR',
    region: 'Bretagne',
    name: 'Camping Les Pins',
    lon: 3.002,
    lat: 47,
    seen: 50,
    upd: 600,
    website: 'https://autre.com',
    stars: 4,
    description: 'Sous les pins.',
    overnight: 'allowed',
  }),
  // D15 — linked to A7, which is GONE: so it is shown again, on its own.
  D(15, {
    country: 'FR',
    region: 'Bretagne',
    name: 'Trois',
    lon: 4,
    lat: 47,
    seen: 50,
    upd: 500,
    stars: 5,
    description: 'Trois.',
  }),
  // D16 — nothing linked. The one DATAtourisme row seen lately besides D13.
  D(16, {
    country: 'FR',
    region: 'Corse',
    name: 'Quatre',
    lon: 9,
    lat: 42,
    seen: 2,
    upd: 5,
    website: 'https://quatre.fr',
    stars: 2,
    description: 'Quatre.',
  }),
  // D17 — its link to A3 was UNDONE; it carries no date of change.
  D(17, {
    country: 'FR',
    region: 'Alsace',
    name: null,
    lon: 7.5,
    lat: 48.5,
    seen: 50,
    stars: 1,
    description: 'Cinq.',
  }),
  // D18 — second copy of A11, 10 m away.
  D(18, {
    country: 'SE',
    region: 'Skåne',
    name: 'Vieux',
    lon: 13.0001,
    lat: 56,
    seen: 50,
    upd: 20,
    website: 'https://www.vieux.se/a',
    stars: 5,
    amenities: { wifi: 'yes' },
  }),
  // D19 — second copy of A8, but GONE: its website is nobody's.
  D(19, {
    country: 'FI',
    region: 'Lappi',
    name: 'Poissa',
    lon: 25.0001,
    lat: 69,
    seen: 50,
    missing: 5,
    upd: 700,
    website: 'https://poissa.fi',
  }),

  // X20 — a row with NO source at all. Never seen, never dated.
  {
    n: 20,
    src: null,
    country: 'PL',
    region: 'Pomorskie',
    name: null,
    lon: 18,
    lat: 54,
    seen: null,
  },
  // X21 — a source we have no licence on file for, AND OpenStreetMap.
  {
    n: 21,
    src: ['acsi', 'osm'],
    upd: 3,
    country: 'NL',
    region: null,
    name: 'Acsi one',
    lon: 5,
    lat: 52,
    seen: 1,
    stars: 4,
    description: 'Een.',
    amenities: { electricity: 'yes', toilets: 'yes', shower: 'no' },
  },

  // A22, D23 — a pair in which each side says what the other does not:
  // only A22 names a website, only D23 gives stars. They cannot disagree,
  // so they belong in neither "both name a website" nor "both give stars".
  A(22, {
    country: 'PT',
    region: 'Algarve',
    name: 'Um',
    lon: -8,
    lat: 37,
    seen: 1,
    contact: { website: 'https://um.pt' },
  }),
  D(23, {
    country: 'PT',
    region: 'Algarve',
    name: 'Um',
    lon: -8.0005,
    lat: 37,
    seen: 50,
    upd: 30,
    stars: 2,
  }),
];

// primary, secondary, metres, undone
const LINKS: [number, number, number, boolean][] = [
  [1, 13, 40, false],
  [2, 14, 200, false],
  [11, 18, 10, false],
  [22, 23, 60, false],
  [3, 12, 300, false], // same source
  [7, 15, 500, false], // primary gone
  [8, 19, 400, false], // secondary gone
  [3, 17, 999, true], // undone
];

// spot, days until validity ends (negative: ended), or null for none
const TARIFFS: [number, number | null][] = [
  [1, -1],
  [1, 30],
  [13, -100],
  [3, null],
  [16, 0], // ends TODAY: still valid
  [14, 5],
  [6, null], // on a row that is gone
];

// hours since the newest frame, or null when the provider gave none
const CAMERAS: (number | null)[] = [1, 2, 23, 30, 240, null];

let db: Client;
let report: Report;

async function seed(): Promise<void> {
  await db.query(`
    CREATE TEMP TABLE camping_spots (
      id uuid PRIMARY KEY, name text, country text NOT NULL, region text,
      location geometry(Point, 4326) NOT NULL, outline geometry(MultiPolygon, 4326),
      website text, contact jsonb NOT NULL DEFAULT '{}', description text,
      stars smallint, amenities jsonb NOT NULL DEFAULT '{}',
      overnight_status text NOT NULL DEFAULT 'unknown',
      sources jsonb NOT NULL DEFAULT '[]', last_seen_at timestamptz,
      missing_since timestamptz, osm_record_edited_at timestamptz);
    CREATE INDEX ON camping_spots USING gist (location);
    CREATE TEMP TABLE spot_links (
      primary_id uuid NOT NULL, secondary_id uuid NOT NULL,
      metres int NOT NULL, unlinked_at timestamptz);
    CREATE TEMP TABLE spot_tariffs (spot_id uuid NOT NULL, valid_until date);
    CREATE TEMP TABLE webcams (last_frame_at timestamptz);
  `);
  for (const r of ROWS) {
    const ids = r.src === null ? [] : Array.isArray(r.src) ? r.src : [r.src];
    await db.query(
      `INSERT INTO camping_spots
         (id, name, country, region, location, outline, website, contact,
          description, stars, amenities, overnight_status, sources,
          last_seen_at, missing_since, osm_record_edited_at)
       SELECT $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326),
              CASE WHEN $7 THEN ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint($5, $6), 4326), 0.0001)) END,
              $8, $9::jsonb, $10, $11, $12::jsonb, $13,
              -- 🔴 An OSM source ALWAYS carries updatedAt: the importer
              -- writes the import day there. A measure that read it as
              -- the date of the last change would find every OSM row dated.
              (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                        'id', s, 'ref', 'r',
                        'updatedAt', CASE WHEN s = 'osm' THEN to_char(now(), 'YYYY-MM-DD')
                                          ELSE to_char(now() - make_interval(days => $14), 'YYYY-MM-DD') END))), '[]')
                 FROM unnest($15::text[]) s),
              now() - make_interval(days => $16),
              now() - make_interval(days => $17),
              now() - make_interval(days => $18)`,
      [
        id(r.n),
        r.name ?? null,
        r.country ?? 'FR',
        r.region ?? null,
        r.lon ?? 0,
        r.lat ?? 45,
        r.outline ?? false,
        r.website ?? null,
        JSON.stringify(r.contact ?? {}),
        r.description ?? null,
        r.stars ?? null,
        JSON.stringify(r.amenities ?? {}),
        r.overnight ?? 'unknown',
        r.upd ?? null,
        ids,
        r.seen ?? null,
        r.missing ?? null,
        r.edited ?? null,
      ],
    );
  }
  for (const [p, s, m, undone] of LINKS) {
    await db.query(
      `INSERT INTO spot_links VALUES ($1, $2, $3, CASE WHEN $4 THEN now() END)`,
      [id(p), id(s), m, undone],
    );
  }
  for (const [spot, days] of TARIFFS) {
    await db.query(
      `INSERT INTO spot_tariffs VALUES ($1, current_date + $2::int)`,
      [id(spot), days],
    );
  }
  for (const h of CAMERAS) {
    await db.query(
      `INSERT INTO webcams VALUES (now() - make_interval(hours => $1))`,
      [h],
    );
  }
}

/** `key` or `key/label` → that one line's `[n, of]`. */
const got = (key: string, label: string | null = null): [number, number] => {
  const found = report.lines.filter((l) => l.key === key && l.label === label);
  expect(found).toHaveLength(1);
  return [found[0].n, found[0].of];
};

const labelsOf = (key: string) =>
  report.lines.filter((l) => l.key === key).map((l) => l.label);

beforeAll(async () => {
  if (!URL) {
    throw new Error(
      'set CAMP_TEST_DATABASE_URL (or CI_DATABASE_URL): a reachable PostgreSQL with PostGIS',
    );
  }
  db = new Client({ connectionString: URL });
  await db.connect();
  await seed();
  report = await measure(db);
});
afterAll(async () => {
  await db?.end();
});

describe('the data-quality measures', () => {
  it('measured everything: no measure failed on the fixture', () => {
    expect(report.failures).toEqual([]);
    expect(new Set(report.lines.map((l) => l.key))).toEqual(
      new Set(MEASURES.map((m) => m.key)),
    );
  });

  it('counts campsites, not rows', () => {
    // 23 rows; 3 gone (A6 A7 D19); 5 folded (A12 D13 D14 D18 D23) → 15.
    expect(got('unique_campsites')).toEqual([15, 23]);
    // the 15 without A4 and X21 (no region) and A5 (unpublished country).
    expect(got('campsites_with_a_page')).toEqual([12, 23]);
  });

  it('counts a position as confirmed only by a second, live, DIFFERENT source', () => {
    // A1, A2, A11, A22. Not A3 (same source; and an undone link to D17),
    // not A8 (its second copy is gone).
    expect(got('position_given_by_two_sources')).toEqual([4, 15]);
    // A1 A3 A8. Not A6 (gone), not D13 (folded into A1).
    expect(got('position_with_an_outline')).toEqual([3, 15]);
  });

  it('counts folded duplicates and the suspects still shown apart', () => {
    // A12 D13 D14 D18 D23 of the 20 rows still in their source. D15 is not:
    // the row that carried it is gone, so it is shown again.
    expect(got('duplicate_rows_folded')).toEqual([5, 20]);
    // A8 and A9. Not A10 (445 m), not A1 or A22 (the namesake is folded).
    expect(got('duplicate_suspects_still_separate')).toEqual([2, 15]);
  });

  it('counts the rows that left their source', () => {
    expect(got('rows_gone_from_their_source')).toEqual([3, 23]);
  });

  it('says, per source, how many rows the source confirmed lately', () => {
    expect(labelsOf('rows_seen_by_their_source_lately')).toEqual([
      'acsi',
      'datatourisme',
      'no source recorded',
      'osm',
    ]);
    // A1–A5, A8–A12, A22 are live; A11 and A12 were last seen 30 days ago.
    expect(got('rows_seen_by_their_source_lately', 'osm')).toEqual([9, 11]);
    // D13–D18 and D23 are live; only D13 and D16 were seen lately.
    expect(got('rows_seen_by_their_source_lately', 'datatourisme')).toEqual([
      2, 7,
    ]);
    expect(got('rows_seen_by_their_source_lately', 'acsi')).toEqual([1, 1]);
    // never seen is "not lately", and the row is still in the population.
    expect(
      got('rows_seen_by_their_source_lately', 'no source recorded'),
    ).toEqual([0, 1]);
  });

  it('counts a tariff as expired the day AFTER its validity ends', () => {
    // 5 state an end; A1's first and D13's have ended; D16's ends today.
    expect(got('tariffs_past_their_validity')).toEqual([2, 5]);
  });

  it('reads the date of the last change from the edit, not from our import', () => {
    // A1 A2 A4 A5 A8 A11 A12; A3 A9 A10 A22 carry no edit date — though
    // all eleven carry `updatedAt`, which is the day we imported them.
    expect(got('rows_with_a_date_of_last_change', 'osm')).toEqual([7, 11]);
    // all but D17.
    expect(got('rows_with_a_date_of_last_change', 'datatourisme')).toEqual([
      6, 7,
    ]);
    expect(got('rows_with_a_date_of_last_change', 'acsi')).toEqual([1, 1]);
    expect(
      got('rows_with_a_date_of_last_change', 'no source recorded'),
    ).toEqual([0, 1]);
  });

  it('counts recent changes among the DATED rows only', () => {
    // of the 7 dated: not A2 (800 days), not A11 (400).
    expect(got('rows_changed_within_a_year', 'osm')).toEqual([5, 7]);
    // of the 6 dated: D13 D16 D18 D23; not D14 (600), not D15 (500).
    expect(got('rows_changed_within_a_year', 'datatourisme')).toEqual([4, 6]);
    expect(got('rows_changed_within_a_year', 'acsi')).toEqual([1, 1]);
    // 🔴 no dated row, so no line — not "0 of 0" dressed as a result.
    expect(labelsOf('rows_changed_within_a_year')).not.toContain(
      'no source recorded',
    );
  });

  it('finds the contradictions between two sources of one campsite', () => {
    // four pairs: A1–D13 (40 m), A2–D14 (200 m), A11–D18 (10 m),
    // A22–D23 (60 m).
    expect(got('pairs_further_apart_than_one_site')).toEqual([1, 4]);
    // 🔴 Of the four, A22–D23 is in neither population below: one side
    // is silent each time. And the THREE that remain split one against
    // two, never two and two:
    // on a symmetric fixture `<>` and `=` count the same and a flipped
    // comparison passes. `www.lac.fr`/`lac.fr` and `vieux.se`/
    // `www.vieux.se` are one domain each; `lespins.fr`/`autre.com` are not.
    expect(got('pairs_naming_different_websites')).toEqual([1, 3]);
    // A1–D13 agree on 3; A2–D14 say 3 and 4; A11–D18 say 4 and 5.
    expect(got('pairs_giving_different_stars')).toEqual([2, 3]);
  });

  it('splits rows by licence, and names a source it has no licence for', () => {
    expect(labelsOf('rows_by_licence')).toEqual([
      'Licence Ouverte 2.0 (Etalab) — datatourisme',
      'no licence on file — acsi',
      'no licence on file — no source recorded',
      'Open Database License (ODbL) 1.0 — osm',
    ]);
    // A1–A12, A22, and X21, which carries two sources and is counted under both.
    expect(
      got('rows_by_licence', 'Open Database License (ODbL) 1.0 — osm'),
    ).toEqual([14, 23]);
    expect(
      got('rows_by_licence', 'Licence Ouverte 2.0 (Etalab) — datatourisme'),
    ).toEqual([8, 23]);
    expect(got('rows_by_licence', 'no licence on file — acsi')).toEqual([
      1, 23,
    ]);
    expect(
      got('rows_by_licence', 'no licence on file — no source recorded'),
    ).toEqual([1, 23]);
  });

  it('asks each attribute of the CAMPSITE: its own row or a live row folded into it', () => {
    const filled = Object.fromEntries(
      report.lines
        .filter((l) => l.key === 'campsites_with_the_attribute')
        .map((l) => [l.label, [l.n, l.of]]),
    );
    expect(filled).toEqual({
      // not A4, D17, X20. A11 has one only through D18.
      name: [12, 15],
      // not A4, X21.
      region: [13, 15],
      // A1 A2 A5 A11 A22 in `contact`, D16 in the column. Not A8: D19 is gone.
      website: [6, 15],
      // A1; A3 through A12.
      phone: [2, 15],
      // A2.
      email: [1, 15],
      // A3 A4 A8 A9 A10.
      'opening hours': [5, 15],
      // A1 (D13), A2 (D14), D15 D16 D17, X21.
      description: [6, 15],
      // A1 A2 A5 A11 D15 D16 D17 X21, and A22 through D23.
      stars: [9, 15],
      // A1 A2 A4 A5 A8 A9 A10 X21, and A11 through D18. Not A3: all "unknown".
      'any amenity answered': [9, 15],
      // A1 A4 A8 X21.
      'electricity answered': [4, 15],
      // A8 A9 A10. Not A1: "unknown".
      'drinking water answered': [3, 15],
      // A2 X21.
      'toilets answered': [2, 15],
      // A2 A10 X21.
      'showers answered': [3, 15],
      // A1, A9, and A2 through D14.
      'overnight stay answered': [3, 15],
      // A1, A3, D16, and A2 through D14. Not A6: gone.
      'a published tariff': [4, 15],
    });
    expect(Object.keys(filled)).toHaveLength(ATTRIBUTES.length);
  });

  it('calls a camera working by the age of its newest frame', () => {
    // 1 h, 2 h, 23 h. Not 30 h, not 10 days, not the one with no frame.
    expect(got('cameras_with_a_recent_frame')).toEqual([3, 6]);
  });

  it('prints, beside every number, the query that reproduces it', async () => {
    for (const l of report.lines) {
      const m = MEASURES.find((x) => x.key === l.key) as Measure;
      expect(l.sql).toBe(m.sql);
      // 🔴 Run the PRINTED text, not the module's: the line is what a
      // partner is handed, so the line is what must reproduce.
      const again = (await db.query(l.sql)).rows as {
        label: string | null;
        n: string;
        of: string;
      }[];
      const row = again.filter((r) => r.label === l.label);
      expect(row).toHaveLength(1);
      expect([Number(row[0].n), Number(row[0].of)]).toEqual([l.n, l.of]);
    }
  });

  it('never prints a numerator larger than the population it is a share of', () => {
    for (const l of report.lines) {
      expect(l.n).toBeLessThanOrEqual(l.of);
      expect(l.of).toBeGreaterThan(0);
    }
  });

  it('carries the moment and the database it was measured on', async () => {
    expect(report.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    const { rows } = await db.query('SELECT current_database() AS db');
    expect(report.database).toBe((rows[0] as { db: string }).db);
    expect(Math.abs(Date.now() - Date.parse(report.measuredAt))).toBeLessThan(
      120_000,
    );
  });

  it('lists what it cannot measure instead of leaving it out', () => {
    expect(report.notMeasured).toBe(NOT_MEASURED);
    expect(NOT_MEASURED.map((x) => x.group).sort()).toEqual([
      'closed',
      'coordinates',
    ]);
  });
});

describe('a measure that breaks', () => {
  const broken: Measure = {
    key: 'broken',
    group: 'unique',
    what: 'x',
    of: 'y',
    sql: 'SELECT NULL AS label, count(*) AS n, count(*) AS of FROM no_such_table',
  };

  it('costs one measure, is named with the database’s words, and is never a zero', async () => {
    const r = await measure(db, [MEASURES[0], broken, MEASURES[1]]);
    expect(r.lines.map((l) => l.key)).toEqual([
      MEASURES[0].key,
      MEASURES[1].key,
    ]);
    expect(r.lines.map((l) => l.n)).toEqual([15, 12]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].key).toBe('broken');
    expect(r.failures[0].error).toMatch(/no_such_table/);
    expect(r.failures[0].sql).toBe(broken.sql);
  });

  it('is reported when the query outlives the timeout, and the rest still run', async () => {
    const slow: Measure = {
      ...broken,
      key: 'slow',
      sql: 'SELECT NULL AS label, 1 AS n, 1 AS of FROM pg_sleep(2)',
    };
    const r = await measure(db, [slow, MEASURES[0]], 200);
    expect(r.failures.map((f) => f.key)).toEqual(['slow']);
    expect(r.failures[0].error).toMatch(/statement timeout/);
    expect(r.lines.map((l) => l.n)).toEqual([15]);
  });

  it('is reported when the answer is not a count, or is no answer', async () => {
    const r = await measure(db, [
      {
        ...broken,
        key: 'negative',
        sql: 'SELECT NULL AS label, -1 AS n, 1 AS of',
      },
      {
        ...broken,
        key: 'null',
        sql: 'SELECT NULL AS label, NULL AS n, 1 AS of',
      },
      {
        ...broken,
        key: 'empty',
        sql: 'SELECT NULL AS label, 1 AS n, 1 AS of WHERE false',
      },
    ]);
    expect(r.lines).toEqual([]);
    expect(r.failures.map((f) => f.key)).toEqual(['negative', 'null', 'empty']);
  });

  it('runs read-only, and a measure that writes leaves nothing behind', async () => {
    const r = await measure(db, [
      {
        ...broken,
        key: 'read_only',
        sql: "SELECT NULL AS label, (current_setting('transaction_read_only') = 'on')::int AS n, 1 AS of",
      },
      {
        ...broken,
        key: 'writes',
        // 🔴 A TEMP table MAY be written in a read-only transaction, so
        // on this fixture the INSERT is not refused. What is proved here
        // is the ROLLBACK: the row is not there afterwards.
        sql: "WITH w AS (INSERT INTO camping_spots (id, country, location) SELECT gen_random_uuid(), 'XX', ST_SetSRID(ST_MakePoint(0, 0), 4326) RETURNING 1) SELECT NULL AS label, count(*) AS n, count(*) AS of FROM w",
      },
    ]);
    expect(r.lines.find((l) => l.key === 'read_only')?.n).toBe(1);
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM camping_spots',
    );
    expect((rows[0] as { n: number }).n).toBe(23);
  });

  it('leaves no transaction open behind it', async () => {
    await measure(db, [broken]);
    const { rows } = await db.query(
      `SELECT current_setting('transaction_read_only') AS ro,
              current_setting('statement_timeout') AS t`,
    );
    expect(rows[0]).toEqual({ ro: 'off', t: '0' });
  });
});

describe('the psql script for a database this build is not on yet', () => {
  it('returns, statement by statement, exactly what measure() returned', async () => {
    const stmts = qualitySql().split('\n');
    expect(stmts[0]).toBe('\\set ON_ERROR_ROLLBACK on');
    expect(stmts[1]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;');
    expect(stmts[2]).toMatch(/^SET LOCAL statement_timeout = \d+;$/);
    expect(stmts.at(-1)).toBe('ROLLBACK;');
    const selects = stmts.slice(4, -1);
    expect(selects).toHaveLength(MEASURES.length);
    const seen: Pick<Line, 'key' | 'label' | 'n' | 'of'>[] = [];
    for (const s of selects) {
      const res = await db.query({ text: s, rowMode: 'array' });
      for (const [key, label, n, of] of res.rows as string[][]) {
        seen.push({
          key,
          label: label === '' ? null : label,
          n: Number(n),
          of: Number(of),
        });
      }
    }
    expect(seen).toEqual(
      report.lines.map(({ key, label, n, of }) => ({ key, label, n, of })),
    );
  });
});

describe('share()', () => {
  it('is a percentage, and nothing at all over an empty population', () => {
    expect(share(1, 3)).toBe('33.3%');
    expect(share(14, 14)).toBe('100.0%');
    expect(share(0, 5)).toBe('0.0%');
    expect(share(0, 0)).toBeNull();
  });
});
