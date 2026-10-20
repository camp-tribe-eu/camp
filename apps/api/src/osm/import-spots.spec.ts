import {
  dedupe,
  mergeUnnamed,
  stagingSelectSql,
  assertStoredOutlines,
  MARK_GONE_SQL,
  UPSERT_SPOT_SQL,
  upsertSpotParams,
} from './import-spots';

// CAMP-28. The upsert is the whole card, and its two most important
// properties are things it must NOT do. Both are one careless line away,
// and neither would throw - they would just quietly destroy work:
//
//   slug             following the OSM name would change the URL every
//                    time a mapper renames a campsite, throwing away the
//                    links and rankings that page had earned (CAMP-87).
//
//   owner_overrides  belongs to the campsite owner (CAMP-86). A weekly job
//                    rewriting it would erase their corrections and they
//                    would never be told why.
describe('the weekly upsert', () => {
  const doUpdate = UPSERT_SPOT_SQL.slice(
    UPSERT_SPOT_SQL.indexOf('DO UPDATE SET'),
  );

  it('upserts on the stable OSM id, not on a row counter', () => {
    expect(UPSERT_SPOT_SQL).toContain('ON CONFLICT (osm_ref)');
  });

  it('never overwrites the slug', () => {
    expect(doUpdate).not.toMatch(/\bslug\s*=/);
  });

  it("never overwrites the owner's corrections", () => {
    expect(doUpdate).not.toMatch(/\bowner_overrides\s*=/);
  });

  it('does refresh the fields that come from OSM', () => {
    // 🔴 `contact` (CAMP-141) belongs here, and was missing.
    //
    // Review deleted `contact = EXCLUDED.contact` from the DO UPDATE and
    // all 330 tests stayed green: the column would have been written
    // once on insert and never refreshed, so a campsite that changed its
    // phone number in OSM would keep the old one indefinitely. This
    // file's header exists to prevent exactly that shape of one-line
    // mistake, and the list it is checked against has to grow with it.
    for (const field of ['name', 'type', 'amenities', 'contact', 'location']) {
      expect(doUpdate).toMatch(new RegExp(`\\b${field}\\s*=`));
    }
  });

  it('🔴 a changed contact counts as a change a reader would notice', () => {
    // CAMP-39: content_changed_at drives <lastmod>. A contact block
    // appearing on a page is exactly the kind of change a crawler should
    // be told about — and deleting `contact` from this comparison also
    // survived the whole suite.
    const compare = UPSERT_SPOT_SQL.slice(
      UPSERT_SPOT_SQL.indexOf('content_changed_at = CASE'),
    );
    expect(compare).toMatch(/camping_spots\.contact/);
    expect(compare).toMatch(/EXCLUDED\.contact/);
  });

  it('🔴 declares contact among the fields this source gave us', () => {
    // The page prints this list as "what OpenStreetMap gave us". A field
    // we write and do not declare is an attribution that lies by
    // omission — and dropping it from the list passed every test.
    expect(UPSERT_SPOT_SQL).toMatch(
      /"fields"[^)]*contact|'fields'[^)]*contact/,
    );
  });

  it('clears missing_since so a returning campsite comes back', () => {
    // A site deleted in OSM by mistake usually reappears within a week.
    expect(doUpdate).toMatch(/missing_since\s*=\s*NULL/);
  });
});

describe('🔴 MARK_GONE_SQL: a folded twin is not a missing campsite (CAMP-274)', () => {
  it('still stamps rows this import did not see', () => {
    // Чого воно не перестало робити. Без цього рядка решта тестів
    // пройшла б і на запиті, який не позначає нічого взагалі.
    expect(MARK_GONE_SQL).toMatch(/SET\s+missing_since\s*=\s*\$1/);
    expect(MARK_GONE_SQL).toMatch(/missing_since\s+IS\s+NULL/);
    expect(MARK_GONE_SQL).toMatch(/last_seen_at/);
  });

  it('skips a row that is a live secondary of a link', () => {
    expect(MARK_GONE_SQL).toMatch(/NOT\s+EXISTS/);
    expect(MARK_GONE_SQL).toMatch(/spot_links/);
    expect(MARK_GONE_SQL).toMatch(/l\.secondary_id\s*=\s*camping_spots\.id/);
    expect(MARK_GONE_SQL).toMatch(/l\.unlinked_at\s+IS\s+NULL/);
  });

  it('🔴 asks about the PRIMARY too — a pair that really vanished must still be stamped', () => {
    // Якби умова питала лише «чи я вторинний», закритий кемпінг, чия
    // пара теж зникла, назавжди лишився б із живою сторінкою. Саме цей
    // join відрізняє «наш нормалізатор прибрав близнюка» від «кемпінгу
    // більше немає».
    expect(MARK_GONE_SQL).toMatch(
      /JOIN\s+camping_spots\s+pri\s+ON\s+pri\.id\s*=\s*l\.primary_id/,
    );
    expect(MARK_GONE_SQL).toMatch(/pri\.missing_since\s+IS\s+NULL/);
  });

  it('does not touch rows without an osm_ref', () => {
    // Рядки DATAtourisme не приходять із жодного екстракту OSM, тож
    // «не бачив цього разу» про них не означає нічого.
    expect(MARK_GONE_SQL).toMatch(/osm_ref\s+IS\s+NOT\s+NULL/);
  });
});

describe('dedupe (CAMP-71)', () => {
  const row = (
    osm_ref: string,
    lon: number,
    lat: number,
    tags: Record<string, string>,
    outline_wkt: string | null = null,
  ) => ({
    osm_ref,
    point_wkt: `POINT(${lon} ${lat})`,
    admin_region: 'Bovec',
    admin_country: 'SI',
    outline_wkt,
    tags,
  });

  it('merges a node into the way of the same campsite', () => {
    const out = dedupe([
      row('n1', 14.0, 46.0, { name: 'Camp Bovec', shower: 'yes' }),
      row('w2', 14.0002, 46.0001, { name: 'Camp Bovec', wifi: 'yes' }),
    ]);
    expect(out).toHaveLength(1);
    // The way wins — it carries the footprint the page is meant to draw.
    expect(out[0].osm_ref).toBe('w2');
    // ...but the node's tags are not thrown away with it.
    expect(out[0].tags.shower).toBe('yes');
    expect(out[0].tags.wifi).toBe('yes');
  });

  it('keeps the winner own tag when both carry the same key', () => {
    const out = dedupe([
      row('n1', 14.0, 46.0, { name: 'X', wifi: 'no' }),
      row('w2', 14.0, 46.0, { name: 'X', wifi: 'yes' }),
    ]);
    expect(out[0].tags.wifi).toBe('yes');
  });

  it('does not merge identically named sites that are far apart', () => {
    // "Camping Municipal" repeats across a whole country; distance is the
    // only thing separating a duplicate from a namesake.
    const out = dedupe([
      row('n1', 14.0, 46.0, { name: 'Camping Municipal' }),
      row('n2', 14.5, 46.5, { name: 'Camping Municipal' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('merges unnamed sites that are metres apart', () => {
    // Measured: 54 unnamed pairs sit within 50 m, 39 of them an area and
    // the way it was built from, averaging 19 m. That is `osmium export`
    // emitting one outline twice, not two campsites.
    const out = dedupe([
      row('w1', 14.0, 46.0, {}),
      row('a2', 14.0001, 46.0001, {}),
    ]);
    expect(out).toHaveLength(1);
  });

  it('🔴 leaves unnamed sites beyond the tight radius alone', () => {
    // ~120 m apart. Without a name there is no second signal, so the
    // radius is the only guard and it stays a quarter of the named one.
    const out = dedupe([
      row('n1', 14.0, 46.0, {}),
      row('n2', 14.0, 46.00108, {}),
    ]);
    expect(out).toHaveLength(2);
  });

  it('leaves a unique campsite untouched', () => {
    const out = dedupe([row('w9', 13.5, 46.3, { name: 'Solo' })]);
    expect(out).toHaveLength(1);
    expect(out[0].osm_ref).toBe('w9');
  });
});

describe('🔴 dedupe is deterministic (CAMP-39)', () => {
  const row = (osm_ref: string, lon: number, lat: number, tags = {}) => ({
    osm_ref,
    point_wkt: `POINT(${lon} ${lat})`,
    admin_region: 'Bled',
    admin_country: 'SI',
    outline_wkt: null,
    tags,
  });

  // Two polygons, same name, same tag count, 18 m apart — the real
  // Camping Bled. Nothing but osm_ref can separate them.
  const pair = () => [
    row('w460186862', 14.0779, 46.3608, { name: 'Camping Bled' }),
    row('a920373724', 14.0781, 46.3609, { name: 'Camping Bled' }),
  ];

  it('picks the same winner whatever order the rows arrive in', () => {
    // Input order comes from Postgres, which does not guarantee it. When
    // the winner depended on it, the published URL flipped between
    // /camping-bled and /camping-bled-2 on consecutive imports of
    // identical data — silent URL churn, every Monday.
    const forward = dedupe(pair());
    const reversed = dedupe(pair().reverse());
    expect(forward).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(forward[0].osm_ref).toBe(reversed[0].osm_ref);
  });

  it('picks the same winner for unnamed pairs too', () => {
    const unnamed = () => [
      row('w1266747456', 14.0779, 46.3608),
      row('a2533494912', 14.0781, 46.3609),
    ];
    expect(dedupe(unnamed())[0].osm_ref).toBe(
      dedupe(unnamed().reverse())[0].osm_ref,
    );
  });

  it('still prefers the polygon over the node regardless of order', () => {
    const mixed = () => [
      row('n111', 14.0779, 46.3608, { name: 'X' }),
      row('w222', 14.0781, 46.3609, { name: 'X' }),
    ];
    expect(dedupe(mixed())[0].osm_ref).toBe('w222');
    expect(dedupe(mixed().reverse())[0].osm_ref).toBe('w222');
  });
});

describe('🔴 CAMP-256: the OSM edit date in the weekly upsert', () => {
  const doUpdate = UPSERT_SPOT_SQL.slice(
    UPSERT_SPOT_SQL.indexOf('DO UPDATE SET'),
  );
  /** The statement with its `--` comments removed, so a placeholder named in prose is not counted. */
  const code = UPSERT_SPOT_SQL.replace(/--[^\n]*/g, '');

  const values = {
    name: 'Camp Bovec',
    country: 'SI',
    region: 'Bovec',
    slug: 'camp-bovec',
    type: 'paid',
    amenities: { shower: 'yes' },
    pointWkt: 'POINT(14 46)',
    osmRef: 'w2',
    seenAt: '2026-10-12T05:00:00Z',
    contact: {},
    overnightStatus: 'unknown',
    overnightSource: null,
    record: {
      ref: 'w2',
      editedAt: new Date('2023-06-14T10:11:12Z'),
      version: 7,
    },
  };

  it('🔴 the builder gives one value for every placeholder the statement has', () => {
    // CAMP-255 added two placeholders and the link rehearsal went on
    // passing ten; CI found it, a week later. The number is read out of
    // the statement itself, not typed here.
    const highest = Math.max(
      ...[...code.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
    );
    expect(highest).toBe(16);
    expect(upsertSpotParams(values)).toHaveLength(highest);
  });

  it('🔴 the edit date is the 13th value and the run date is the 9th — and they are two values', () => {
    const p = upsertSpotParams(values);
    expect(p[8]).toBe('2026-10-12T05:00:00Z');
    expect(p[12]).toEqual(new Date('2023-06-14T10:11:12Z'));
    expect(p[13]).toBe(7);
    expect(p[12]).not.toEqual(new Date(p[8] as string));
  });

  it("🔴 the object the date belongs to is the 15th value, and it is the edit's own ref — NOT osm_ref", () => {
    // osmRef is `w2`; the edit is a merged-away node's. Different strings on
    // purpose: a builder that wrote osmRef into the 15th place would pass
    // every test whose two refs are the same.
    const p = upsertSpotParams({
      ...values,
      osmRef: 'w2',
      record: {
        ref: 'n1',
        editedAt: new Date('2026-09-30T10:11:12Z'),
        version: 2,
      },
    });
    expect(p[7]).toBe('w2');
    expect(p[14]).toBe('n1');
    expect(p[12]).toEqual(new Date('2026-09-30T10:11:12Z'));
    expect(p[13]).toBe(2);
  });

  it('🔴 "not known" is passed as null in all three places, not as the run date', () => {
    const p = upsertSpotParams({ ...values, record: null });
    expect(p[12]).toBeNull();
    expect(p[13]).toBeNull();
    expect(p[14]).toBeNull();
  });

  it('writes the edit date from its own placeholder, never from the run date ($9)', () => {
    expect(code).toMatch(/\$13::timestamptz/);
    expect(code).toMatch(/\$14::integer/);
  });

  it('writes the ref into its own column, and from EXCLUDED on every run', () => {
    expect(code).toMatch(/\bosm_record_ref\b/);
    expect(doUpdate.replace(/--[^\n]*/g, '')).toMatch(
      /\bosm_record_ref\s*=\s*EXCLUDED\.osm_record_ref/,
    );
  });

  it('refreshes the date and the version on every run', () => {
    expect(doUpdate).toMatch(
      /\bosm_record_edited_at\s*=\s*EXCLUDED\.osm_record_edited_at/,
    );
    expect(doUpdate).toMatch(
      /\bosm_record_version\s*=\s*EXCLUDED\.osm_record_version/,
    );
  });

  it("🔴 a NULL date replaces an old one: no COALESCE keeping last import's date alive", () => {
    const update = doUpdate.replace(/--[^\n]*/g, '');
    expect(update).not.toMatch(/COALESCE\s*\([^)]*osm_record/i);
  });

  it('🔴 the date is NOT in the content_changed_at comparison — the first load must not restamp every page', () => {
    const compare = UPSERT_SPOT_SQL.slice(
      UPSERT_SPOT_SQL.indexOf('content_changed_at = CASE'),
    ).replace(/--[^\n]*/g, '');
    expect(compare).not.toMatch(/osm_record/);
  });

  describe('🔴 a row built from several objects is dated by the NEWEST of them — and says WHOSE date it is', () => {
    // Review's finding, from a real row: the name on the page came from a newer
    // version of an object than the date printed under "Record last edited". The
    // merged tags are a union, so the date must not be older than any of them.
    // And review's second finding: the date then belonged to an object the row
    // was not keyed on, with nothing to say which — so every row now carries
    // the ref of the object whose date and version it holds.
    const mk = (
      osm_ref: string,
      lon: number,
      editedAt: string | null,
      version: number | null,
      name: string | null = 'Camp Bovec',
      extraTags: Record<string, string> = {},
    ) => ({
      osm_ref,
      point_wkt: `POINT(${lon} 46)`,
      admin_region: 'Bovec',
      admin_country: 'SI',
      outline_wkt: null,
      // Built the way main() builds it: each object's record names ITSELF.
      record: {
        edit:
          editedAt === null
            ? null
            : { ref: osm_ref, editedAt: new Date(editedAt), version },
        problem: editedAt === null ? ('missing' as const) : null,
      },
      tags: { ...(name === null ? {} : { name }), ...extraTags },
    });

    it("a node edited AFTER the way it was merged into: the row carries the node's date, version AND ref", () => {
      const out = dedupe([
        mk('n1', 14.0, '2026-09-01T10:00:00Z', 2),
        mk('w2', 14.0002, '2019-06-14T08:00:00Z', 5),
      ]);
      expect(out).toHaveLength(1);
      // The way is still the row (its id, its slug)…
      expect(out[0].osm_ref).toBe('w2');
      // …and the date is the newest, with ITS version and ITS ref: one edit.
      expect(out[0].record?.edit).toEqual({
        ref: 'n1',
        editedAt: new Date('2026-09-01T10:00:00Z'),
        version: 2,
      });
    });

    it("🔴 review's case, through the real dedupe: way w2 (2012, v9) with a node n1 that adds no tag (2026-09-30, v2)", () => {
      const out = dedupe([
        mk('w2', 14.0, '2012-04-05T06:07:08Z', 9, 'Camp Bovec', {
          website: 'https://bovec.example',
          toilets: 'yes',
        }),
        // n1's only tag is the name w2 already has: it contributes no tag.
        mk('n1', 14.0002, '2026-09-30T10:11:12Z', 2),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].osm_ref).toBe('w2');
      // Anchor: every tag shown is w2's — n1 added nothing, which is the
      // case that made the pair (2026-09-30, v2) the one no shown tag owns.
      expect(out[0].tags).toEqual({
        name: 'Camp Bovec',
        website: 'https://bovec.example',
        toilets: 'yes',
      });
      // The pair is n1's, and the row says so.
      expect(out[0].record?.edit).toEqual({
        ref: 'n1',
        editedAt: new Date('2026-09-30T10:11:12Z'),
        version: 2,
      });
      // The two refs differ — or "ref = osm_ref" would pass for any value.
      expect(out[0].record?.edit?.ref).not.toBe(out[0].osm_ref);
    });

    it("the way edited after the node: the way's date, version and ref, as before", () => {
      const out = dedupe([
        mk('n1', 14.0, '2019-06-14T08:00:00Z', 2),
        mk('w2', 14.0002, '2026-09-01T10:00:00Z', 5),
      ]);
      expect(out[0].record?.edit).toEqual({
        ref: 'w2',
        editedAt: new Date('2026-09-01T10:00:00Z'),
        version: 5,
      });
      expect(out[0].record?.edit?.ref).toBe(out[0].osm_ref);
    });

    it('whichever order they arrive in', () => {
      const a = dedupe([
        mk('w2', 14.0002, '2019-06-14T08:00:00Z', 5),
        mk('n1', 14.0, '2026-09-01T10:00:00Z', 2),
      ]);
      expect(a[0].osm_ref).toBe('w2');
      expect(a[0].record?.edit?.version).toBe(2);
      expect(a[0].record?.edit?.ref).toBe('n1');
    });

    it('an unnamed pair, merged on the tighter radius, is dated — and named — the same way', () => {
      const out = dedupe([
        mk('n1', 14.0, '2026-09-01T10:00:00Z', 2, null),
        mk('w2', 14.0002, '2019-06-14T08:00:00Z', 5, null),
      ]);
      expect(out).toHaveLength(1);
      // Anchor: the rows REALLY are unnamed, or this is the named path again —
      // an earlier version of this test passed `undefined`, which a default
      // parameter turned into a name, and the unnamed path went untested.
      expect(out[0].tags.name).toBeUndefined();
      expect(out[0].osm_ref).toBe('w2');
      expect(out[0].record?.edit).toEqual({
        ref: 'n1',
        editedAt: new Date('2026-09-01T10:00:00Z'),
        version: 2,
      });
    });

    it('three objects: the newest of all three, and its ref', () => {
      const out = dedupe([
        mk('n1', 14.0, '2024-01-01T00:00:00Z', 1),
        mk('n3', 14.0001, '2026-03-03T00:00:00Z', 4),
        mk('w2', 14.0002, '2019-06-14T08:00:00Z', 5),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].record?.edit?.version).toBe(4);
      expect(out[0].record?.edit?.ref).toBe('n3');
    });

    it('🔴 three objects with a WAY, a node and a node as the newest: a three-way merge keeps the pair of one object', () => {
      // A version of 1 under a fresh date — the shape a substituted date has —
      // belongs to n3 here and nowhere else, and the ref must say n3.
      const out = dedupe([
        mk('w2', 14.0, '2015-05-05T05:05:05Z', 14),
        mk('n1', 14.0001, '2022-02-02T02:02:02Z', 6),
        mk('n3', 14.0002, '2026-10-01T01:01:01Z', 1),
      ]);
      expect(out[0].osm_ref).toBe('w2');
      expect(out[0].record?.edit).toEqual({
        ref: 'n3',
        editedAt: new Date('2026-10-01T01:01:01Z'),
        version: 1,
      });
    });

    it('🔴 if ANY merged object has no date, the row has none — no date, no version, no ref: "not known", not the others\' date', () => {
      const out = dedupe([
        mk('n1', 14.0, null, null),
        mk('w2', 14.0002, '2019-06-14T08:00:00Z', 5),
      ]);
      expect(out).toHaveLength(1);
      expect(out[0].record).toEqual({ edit: null, problem: 'missing' });
    });

    it('a row that was not merged keeps its own date untouched, and its ref is its osm_ref', () => {
      const out = dedupe([mk('w2', 14.0002, '2019-06-14T08:00:00Z', 5)]);
      expect(out[0].record?.edit).toEqual({
        ref: 'w2',
        editedAt: new Date('2019-06-14T08:00:00Z'),
        version: 5,
      });
      expect(out[0].record?.edit?.ref).toBe(out[0].osm_ref);
    });
  });
});

// CAMP-352. Контур ділянки. Картка просить намалювати обрис там, де він
// є, тож спершу його треба донести живим від staging до таблиці — через
// злиття дублікатів, яке досі обʼєднувало теги й мовчки губило геометрію.
describe('🔴 CAMP-352: контур ділянки', () => {
  /** Statement без `--` коментарів: плейсхолдер, названий у прозі, не рахується. */
  const code = UPSERT_SPOT_SQL.replace(/--[^\n]*/g, '');
  const doUpdate = code.slice(code.indexOf('DO UPDATE SET'));
  const RING =
    'MULTIPOLYGON(((14 46,14.001 46,14.001 46.001,14 46.001,14 46)))';
  const RING2 =
    'MULTIPOLYGON(((15 46,15.001 46,15.001 46.001,15 46.001,15 46)))';

  it('пишеться своїм плейсхолдером і як геометрія, а не як текст', () => {
    expect(code).toMatch(/ST_GeomFromText\(\$16,\s*4326\)/);
  });

  it('🔴 оновлюється РАЗОМ із точкою, бо міграція вимагає точку НА контурі', () => {
    // CAMP-352 крок 1 поставив CHECK ST_DWithin(outline, location, 0.0001).
    // Рядок, зібраний із двох прогонів — цьоготижнева точка і торішній
    // контур, — не пройде його на вставці, і вся країна відкотиться.
    expect(doUpdate).toMatch(/location\s*=\s*EXCLUDED\.location/);
    expect(doUpdate).toMatch(/outline\s*=\s*EXCLUDED\.outline/);
  });

  it('🔴 змінений контур рухає <lastmod>, а його ПЕРШЕ заповнення — ні', () => {
    const when = doUpdate.slice(doUpdate.indexOf('content_changed_at'));
    // Без цього сторожа перший прогін після міграції перетворює NULL на
    // геометрію в кожному полігонному рядку і перештампує десятки тисяч
    // сторінок за появу колонки. Це дослівно помилка CAMP-256.
    expect(when).toMatch(/camping_spots\.outline\s+IS\s+NOT\s+NULL/);
    // А зникнення контуру рахується зміною: ST_Equals на NULL віддає
    // NULL, тож без явного випадку втрата обрису пройшла б непоміченою.
    expect(when).toMatch(/EXCLUDED\.outline\s+IS\s+NULL/);
  });

  // Переможця злиття обирає isPolygon(ref) = !ref.startsWith('n'), а це
  // питання про ПРЕФІКС, не про геометрію: вижилий `w…` — LineString без
  // контуру (normalise-export.mjs:11). Отже переможець може не мати
  // контуру, тоді як програвший поруч має.
  const spot = (
    osm_ref: string,
    tags: Record<string, string>,
    outline_wkt: string | null,
    lon = 14,
    admin_region: string | null = 'Bovec',
    admin_country: string | null = 'SI',
    raw_country: string | null = 'SI',
  ) => ({
    osm_ref,
    point_wkt: `POINT(${lon} 46)`,
    admin_region,
    admin_country,
    raw_country,
    outline_wkt,
    tags,
  });

  it('🔴 переможець без контуру успадковує контур програвшого — РАЗОМ із точкою', () => {
    // w1 виграє за кількістю тегів (3 проти 1), хоч контур є лише в a2.
    const out = dedupe([
      spot('w1', { name: 'X', shower: 'yes', wifi: 'yes' }, null, 14),
      spot('a2', { name: 'X' }, RING, 14.0005),
    ]);
    expect(out).toHaveLength(1);
    // URL не зрушив: ранжування лишилось тим самим, отже slug теж (CAMP-87).
    expect(out[0].osm_ref).toBe('w1');
    expect(out[0].outline_wkt).toBe(RING);
    // І точка переїхала з контуром — інакше CHECK міграції відмовить.
    expect(out[0].point_wkt).toBe('POINT(14.0005 46)');
  });

  it('🔴 через межу регіону контур НЕ переноситься — адреса сторінки дорожча', () => {
    // Точка несе з собою admin_region, а він сегмент опублікованого URL.
    const out = dedupe([
      spot('w1', { name: 'X', shower: 'yes', wifi: 'yes' }, null, 14),
      spot('a2', { name: 'X' }, RING, 14.0005, 'Kranj'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].admin_region).toBe('Bovec');
    expect(out[0].outline_wkt).toBeNull();
    expect(out[0].point_wkt).toBe('POINT(14 46)');
  });

  it('🔴 через кордон теж НЕ переноситься, навіть коли регіон однаково NULL', () => {
    // Це не вигаданий випадок. Екстракт Geofabrik несе смугу за кордоном
    // (коментар у staging-запиті: девʼять точок зі словенського файлу
    // стоять у Хорватії та Австрії), а точка в полігоні без ISO-коду
    // лишається з region = NULL (CAMP-125). Тоді NULL === NULL проходить
    // сторож регіону, і єдине, що тримає сторінку в її країні, — це
    // сторож країни. Без нього контур тягне за собою точку, а точка —
    // перший сегмент URL.
    const out = dedupe([
      spot(
        'w1',
        { name: 'X', shower: 'yes', wifi: 'yes' },
        null,
        14,
        null,
        'SI',
      ),
      spot('a2', { name: 'X' }, RING, 14.0005, null, 'HR'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].admin_country).toBe('SI');
    expect(out[0].outline_wkt).toBeNull();
    expect(out[0].point_wkt).toBe('POINT(14 46)');
  });

  it('переможець із власним контуром лишає свій, а не бере чужий', () => {
    const other =
      'MULTIPOLYGON(((15 46,15.001 46,15.001 46.001,15 46.001,15 46)))';
    const out = dedupe([
      spot('a1', { name: 'X', shower: 'yes', wifi: 'yes' }, RING, 14),
      spot('a2', { name: 'X' }, other, 14.0005),
    ]);
    expect(out[0].outline_wkt).toBe(RING);
    expect(out[0].point_wkt).toBe('POINT(14 46)');
  });

  it('🔴 результат НЕ залежить від порядку рядків (урок CAMP-39)', () => {
    // adoptOutline рухає точку переможця — цього вимагає CHECK міграції.
    // Якщо тим самим числом міряти сусідство, ланцюжок 31 м + 31 м
    // схлопується транзитивно: заміряно 20.10.2026, порядок [w1,a2,a3]
    // давав ОДИН рядок, [w1,a3,a2] — ДВА. Кількість кемпінгів починала
    // залежати від `ORDER BY p.id`, а з нею й те, яка сторінка виживе.
    //
    // 🔴 Рядки будуються заново на кожен виклик: mergeUnnamed мутує їх.
    const trio = () => [
      spot('w1', { shower: 'yes', wifi: 'yes' }, null, 14),
      spot('a2', {}, RING, 14.0004),
      spot('a3', {}, RING2, 14.0008),
    ];
    const [p1, p2, p3] = trio();
    const forward = mergeUnnamed([p1, p2, p3]).map((r) => r.osm_ref);
    const [q1, q2, q3] = trio();
    const swapped = mergeUnnamed([q1, q3, q2]).map((r) => r.osm_ref);

    expect(forward).toEqual(swapped);
    // Крайні за 62 м один від одного — тобто поза радіусом 50 м.
    expect(forward).toHaveLength(2);
  });

  it('🔴 raw_country їде разом із точкою, бо рахується з неї ж', () => {
    // Обидва рядки стоять у полігоні без ISO-коду, тож region і country
    // однаково NULL і сторожі пропускають. Але raw_country — це те, що
    // Natural Earth написав ДЛЯ ЦІЄЇ ТОЧКИ, і лічильник полігонів без
    // коду рахує саме його. Лишити старе значення означало б віднести
    // рядок до чужого полігона.
    const out = dedupe([
      spot(
        'w1',
        { name: 'X', shower: 'yes', wifi: 'yes' },
        null,
        14,
        null,
        null,
        '-1',
      ),
      spot('a2', { name: 'X' }, RING, 14.0005, null, null, '-99'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].outline_wkt).toBe(RING);
    expect(out[0].raw_country).toBe('-99');
  });

  it('🔴 те саме на безіменній гілці — вона має власне злиття', () => {
    // mergeUnnamed() це окремий прохід із власним betterRow(); виправити
    // один шлях і лишити другий означало б полагодити половину.
    const out = mergeUnnamed([
      spot('w1', { shower: 'yes', wifi: 'yes' }, null, 14),
      spot('a2', {}, RING, 14.0002),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].osm_ref).toBe('w1');
    expect(out[0].outline_wkt).toBe(RING);
    expect(out[0].point_wkt).toBe('POINT(14.0002 46)');
  });
});

// 🔴 Винесено з main() саме заради цього блоку: у матриці 20.10.2026
// мутація «брати контур за префіксом» вижила — найдорожчий рядок
// імпорту не пінило ніщо.
describe('🔴 CAMP-352: staging віддає контур за ТИПОМ геометрії', () => {
  /** Без `--` коментарів: сторож на текст мусить читати код, а не прозу поруч. */
  const sql = stagingSelectSql('osm_camping_staging').replace(/--[^\n]*/g, '');

  it('🔴 питає GeometryType, а не префікс osm_ref', () => {
    expect(sql).toMatch(
      /GeometryType\(p\.geom\)\s+IN\s+\('POLYGON',\s*'MULTIPOLYGON'\)/,
    );
  });

  it('🔴 загортає в ST_Multi — колонка оголошена MultiPolygon', () => {
    // Без ST_Multi звичайний POLYGON не пройде typmod колонки.
    expect(sql).toMatch(/ST_AsText\(ST_Multi\(p\.geom\)\)/);
  });

  it('підставляє саме ту таблицю, яку просили', () => {
    expect(stagingSelectSql('zzz_staging')).toContain('"zzz_staging"');
    expect(stagingSelectSql('zzz_staging')).not.toContain('${TABLE}');
  });
});

// Сам SELECT тут не виконується — його поведінку пінить db-спек. Тут
// пінимо ВИРОК: свідок, який лише рахує й ніколи не кидає, не стереже.
describe('🔴 CAMP-352: свідок записаних контурів', () => {
  const fake = (n: string, off: string) => ({
    query: async () => ({ rows: [{ n, off }] }),
  });
  const run = (n: string, off: string) =>
    assertStoredOutlines(fake(n, off), new Date('2026-10-20T05:00:00Z'), 'SI');

  it('віддає кількість рядків із контуром', async () => {
    await expect(run('1303', '0')).resolves.toBe(1303);
  });

  it('🔴 кидає, коли хоч один рядок не стоїть на власному контурі', async () => {
    // CHECK міграції пропускає 0.0001 градуса (~11 м), а наша побудова
    // обіцяє нуль. Рядок у цій щілині означає пару, зібрану з двох різних
    // обʼєктів, і CHECK про неї не скаже нічого.
    await expect(run('1303', '2')).rejects.toThrow(/2 rows carry an outline/);
  });

  it('нуль контурів — це не помилка', async () => {
    await expect(run('0', '0')).resolves.toBe(0);
  });
});
