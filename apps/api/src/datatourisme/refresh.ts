// CAMP-528: keep the DATAtourisme campsites we already hold up to date.
//
//   npx ts-node src/datatourisme/refresh.ts <dir with the 13 region CSVs>
//   node dist/datatourisme/refresh.js <dir> --apply
//
// 🔴 WHY THIS IS NOT `import.ts --apply` ON A TIMER.
//
// `import.ts` is a first-load tool and is not safe to repeat. Measured
// 13.11.2026 on a copy of the production rows for France (23 917 rows,
// 8 752 of them DATAtourisme) against that morning's regional files:
//
//   · it has no key. There is no `ON CONFLICT`, and no unique index on
//     the source URI; a record is recognised by distance and name. Its
//     own plan for 9 003 parsed campsites: UPDATE 8 342, INSERT 372.
//   · the UPDATE never touches `last_seen_at`. Applied to the two
//     regions with nothing to insert (cor, idf): 52 rows rewritten, 0
//     rows with a new `last_seen_at` — the freshness guard would stay
//     red for ever.
//   · the UPDATE sets `content_changed_at = now()` unconditionally, so
//     every page's <lastmod> would claim a change each week.
//   · the UPDATE goes to the NEAREST matching row, which may be an OSM
//     row: in those same two regions, 2 of the 52 were OSM rows that
//     received a DATAtourisme source entry. Since CAMP-144 the two sources are
//     joined by `spot_links`, not merged, so that write is simply wrong.
//   · it never looks at what disappeared. Nothing is stamped, nothing is
//     deleted.
//
// So this file does the one thing a schedule can do safely: it finds
// the rows we hold BY THEIR SOURCE URI and brings them up to date.
//
// 🔴 WHAT IT WRITES, EXHAUSTIVELY. Only rows with `osm_ref IS NULL` that
// carry a `datatourisme` source entry:
//
//   seen again      last_seen_at = this run; missing_since = NULL
//   …and changed    name, description, stars, website, the source entry
//                   (its date); content_changed_at ONLY if one of the
//                   four published values really differs
//   not seen        missing_since = this run, first time only — unless
//                   the row is folded into a live OSM page (see GONE_SQL)
//                   or the run was started with --no-mark-missing
//
// 🔴 WHAT IT NEVER DOES.
//
//   · DELETE. A campsite the source stopped listing keeps its row; the
//     site answers 410 from `missing_since`, as it does for OSM.
//   · INSERT. A URI we do not hold is counted and printed, not written:
//     publishing a new page needs the matcher, the duplicate rules and a
//     region, which is `import.ts` and a person. 839 on 13.11.2026.
//   · move a point, a slug or a region. A moved coordinate is counted.
//   · touch `owner_overrides`, or any row that came from OSM.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import {
  dedupeByRef,
  fieldsToFill,
  readCampsites,
  sourceEntry,
} from './import';
import { metresApart } from './match';
import type { ParsedSpot } from './parse';

const SOURCE_ID = 'datatourisme';

/**
 * The regional files a run must have — all of them, or it writes nothing.
 *
 * 🔴 A row does not record which regional file it came from, so a region
 * that is simply absent from the directory would read as "every campsite
 * in Brittany closed this week". The same list as METROPOLITAN in
 * `scripts/datatourisme/fetch-regions.mjs`; the spec compares the two.
 */
export const REQUIRED_REGIONS = [
  'ara',
  'bfc',
  'bre',
  'cor',
  'cvl',
  'gde',
  'hdf',
  'idf',
  'naq',
  'nor',
  'occ',
  'pac',
  'pdl',
] as const;

/**
 * The largest share of live rows one run may stamp as missing.
 *
 * 🔴 Measured 13.11.2026, 50 days after the only load (24.09.2026): of
 * the 8 752 rows held, 601 are in none of the 13 files. 359 of those are
 * folded into a live OSM page and are never stamped, which leaves 242 —
 * 2.77% over seven weeks, about 0.4% a week. 5% in ONE run is twelve
 * times that rate: a truncated or half-published file crosses it at
 * once, an ordinary week does not, and the first run after the gap
 * passes on the measured number rather than on an exception.
 *
 * 🔴 WHY the 242 left is NOT established. Only 4 of the 601 have a
 * same-named unknown record within 400 m, so they were not re-keyed; but
 * 527 carry a 2026 source date, and tourist offices may unpublish a
 * campsite for the winter. A stamp hides the page at once and turns it
 * into a 410 after 28 days; a record that comes back is un-stamped by
 * the next run. `--no-mark-missing` exists so the first run can be made
 * without deciding that question.
 */
export const MAX_GONE_SHARE = 0.05;

/**
 * Every flag this tool knows. An unknown one is refused: `--aply` would
 * otherwise be a dry run on a timer — a unit that succeeds every week
 * and writes nothing. The spec holds the systemd unit to this list.
 */
export const KNOWN_FLAGS = ['--apply', '--no-mark-missing'] as const;

/** A file older than this is not "this run's source". */
export const MAX_FILE_AGE_HOURS = 48;

export type Held = {
  id: string;
  ref: string;
  updatedAt: string | null;
  name: string | null;
  description: string | null;
  stars: number | null;
  website: string | null;
  lat: number;
  lon: number;
  missing: boolean;
  /** Secondary of a live link: its page is a 301 to the OSM row. */
  folded: boolean;
};

export type RefreshPlan = {
  /** Held and listed again: every one gets this run's stamp. */
  seen: {
    held: Held;
    spot: ParsedSpot;
    contentChanged: boolean;
    dateChanged: boolean;
  }[];
  /** Held, live, not folded, and in no file: these get stamped. */
  gone: Held[];
  /** In no file, but folded into a live OSM page: never stamped. */
  heldBack: Held[];
  /** Was missing, is listed again. */
  returned: number;
  /** In the files, not in the table. Never written by this tool. */
  unknown: ParsedSpot[];
  /** Listed more than 50 m from where we hold it. Reported, not moved. */
  moved: number;
  /** Non-null means: write nothing. */
  refusal: string | null;
};

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** Pure: what a run would do. No database, no clock. */
export function planRefresh(
  held: Held[],
  parsed: ParsedSpot[],
  opts: { markMissing: boolean } = { markMissing: true },
): RefreshPlan {
  const spots = dedupeByRef(parsed);
  const byRef = new Map(spots.map((s) => [s.ref, s]));
  const heldRefs = new Set(held.map((h) => h.ref));
  const out: RefreshPlan = {
    seen: [],
    gone: [],
    heldBack: [],
    returned: 0,
    unknown: [],
    moved: 0,
    refusal: null,
  };

  for (const h of held) {
    const spot = byRef.get(h.ref);
    if (!spot) {
      if (h.missing) continue;
      (h.folded ? out.heldBack : out.gone).push(h);
      continue;
    }
    if (h.missing) out.returned++;
    if (metresApart(spot, h) > 50) out.moved++;
    out.seen.push({
      held: h,
      spot,
      contentChanged:
        !same(spot.name, h.name) ||
        !same(spot.description, h.description) ||
        !same(spot.stars, h.stars) ||
        !same(spot.website, h.website),
      dateChanged: spot.updatedAt !== h.updatedAt,
    });
  }
  out.unknown = spots.filter((s) => !heldRefs.has(s.ref));

  const live = held.filter((h) => !h.missing).length;
  if (held.length === 0) {
    out.refusal =
      'the table holds no DATAtourisme campsites — this tool refreshes, it does not load';
  } else if (
    opts.markMissing &&
    live > 0 &&
    out.gone.length / live > MAX_GONE_SHARE
  ) {
    out.refusal =
      `${out.gone.length} of ${live} live campsites would be stamped missing ` +
      `(${((out.gone.length / live) * 100).toFixed(1)}%, limit ${MAX_GONE_SHARE * 100}%) — ` +
      'that is a broken download, not a week of closures';
  }
  return out;
}

/** The region files in a directory, or the reason they cannot be used. */
export function regionFiles(
  dir: string,
  now: number,
  ls: (d: string) => string[] = (d) => readdirSync(d),
  mtimeMs: (p: string) => number = (p) => statSync(p).mtimeMs,
): { files: string[]; refusal: string | null } {
  const present = new Set(ls(dir));
  const absent = REQUIRED_REGIONS.filter((r) => !present.has(`${r}.csv`));
  if (absent.length) {
    return {
      files: [],
      refusal: `region file(s) absent from ${dir}: ${absent.join(', ')}`,
    };
  }
  const files = REQUIRED_REGIONS.map((r) => join(dir, `${r}.csv`));
  const old = files.filter(
    (f) => (now - mtimeMs(f)) / 36e5 > MAX_FILE_AGE_HOURS,
  );
  if (old.length) {
    return {
      files,
      refusal:
        `${old.length} region file(s) are older than ${MAX_FILE_AGE_HOURS} h ` +
        `(first: ${old[0]}) — stamping rows "seen today" from them would be a lie`,
    };
  }
  return { files, refusal: null };
}

/** Every DATAtourisme-only row, with the values a refresh compares. */
export const HELD_SQL = `
  SELECT s.id::text AS id, e->>'ref' AS ref, e->>'updatedAt' AS "updatedAt",
         s.name, s.description, s.stars::int AS stars, s.website,
         ST_Y(s.location::geometry) AS lat, ST_X(s.location::geometry) AS lon,
         (s.missing_since IS NOT NULL) AS missing,
         EXISTS (SELECT 1 FROM spot_links l
                   JOIN camping_spots pri ON pri.id = l.primary_id
                  WHERE l.secondary_id = s.id AND l.unlinked_at IS NULL
                    AND pri.missing_since IS NULL) AS folded
    FROM camping_spots s, jsonb_array_elements(s.sources) e
   WHERE s.osm_ref IS NULL AND e->>'id' = '${SOURCE_ID}'`;

export const TOUCH_SQL = `
  UPDATE camping_spots SET last_seen_at = $1, missing_since = NULL
   WHERE id = ANY($2::uuid[]) AND osm_ref IS NULL`;

/**
 * 🔴 `content_changed_at` moves only when a published value moves. The
 * source re-dates a record without changing a word of it — measured
 * 13.11.2026: 3 123 of 8 151 re-dated in 50 days, 2 845 of them with all
 * four values identical — and <lastmod> must not follow that.
 */
export const UPDATE_SQL = `
  UPDATE camping_spots SET
    name             = $2,
    description      = $3,
    description_lang = CASE WHEN $3::text IS NULL THEN NULL ELSE 'fr' END,
    stars            = $4,
    website          = $5,
    sources          = (
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) || $6::jsonb
        FROM jsonb_array_elements(sources) e
       WHERE e->>'id' <> '${SOURCE_ID}'
    ),
    content_changed_at = CASE WHEN $7::boolean THEN $8::timestamptz
                              ELSE content_changed_at END
  WHERE id = $1 AND osm_ref IS NULL`;

/**
 * 🔴 The same exemption as MARK_GONE_SQL in `osm/import-spots.ts`, for
 * the same reason: a row folded into a LIVE primary answers 301 to that
 * primary only while its own `missing_since` is NULL. Stamping it would
 * turn a working redirect into a 410 about a campsite OSM still lists.
 */
export const GONE_SQL = `
  UPDATE camping_spots SET missing_since = $1
   WHERE id = ANY($2::uuid[]) AND osm_ref IS NULL AND missing_since IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM spot_links l
         JOIN camping_spots pri ON pri.id = l.primary_id
        WHERE l.secondary_id = camping_spots.id
          AND l.unlinked_at IS NULL
          AND pri.missing_since IS NULL)
  RETURNING id`;

export type Written = {
  touched: number;
  updated: number;
  contentChanged: number;
  stamped: number;
};

/** Apply a plan in one transaction. Nothing is written on a refusal. */
export async function applyRefresh(
  db: Client,
  p: RefreshPlan,
  startedAt: Date,
  opts: { markMissing: boolean } = { markMissing: true },
): Promise<Written> {
  if (p.refusal) throw new Error(p.refusal);
  const w: Written = { touched: 0, updated: 0, contentChanged: 0, stamped: 0 };
  await db.query('BEGIN');
  try {
    w.touched =
      (await db.query(TOUCH_SQL, [startedAt, p.seen.map((s) => s.held.id)]))
        .rowCount ?? 0;
    for (const { held, spot, contentChanged, dateChanged } of p.seen) {
      if (!contentChanged && !dateChanged) continue;
      const fields = [
        ...fieldsToFill(spot, { name: null, website: null }),
        'location',
      ];
      await db.query(UPDATE_SQL, [
        held.id,
        spot.name,
        spot.description,
        spot.stars,
        spot.website,
        JSON.stringify([sourceEntry(spot, fields)]),
        contentChanged,
        startedAt,
      ]);
      w.updated++;
      if (contentChanged) w.contentChanged++;
    }
    if (opts.markMissing) {
      w.stamped =
        (await db.query(GONE_SQL, [startedAt, p.gone.map((g) => g.id)]))
          .rowCount ?? 0;
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
  return w;
}

async function main() {
  const dir = process.argv[2];
  const apply = process.argv.includes('--apply');
  const markMissing = !process.argv.includes('--no-mark-missing');
  const unknown = process.argv
    .slice(3)
    .filter((a) => !(KNOWN_FLAGS as readonly string[]).includes(a));
  if (!dir || dir.startsWith('--') || unknown.length) {
    if (unknown.length)
      console.error(`✗ unknown argument(s): ${unknown.join(' ')}`);
    console.error(
      'usage: refresh.ts <dir with region CSVs> [--apply] [--no-mark-missing]',
    );
    process.exit(1);
  }
  const startedAt = new Date();
  const { files, refusal } = regionFiles(dir, startedAt.getTime());
  if (refusal) {
    console.error(`✗ ${refusal}`);
    process.exit(1);
  }

  const parsed: ParsedSpot[] = [];
  for (const file of files) {
    const rows = await readCampsites(file);
    // 🔴 One spoiled file costs the run, not the table: zero campsites in
    // a region is a broken file, and going on would stamp that region gone.
    if (rows.length === 0) {
      console.error(`✗ ${file}: no campsites parsed — refusing to continue`);
      process.exit(1);
    }
    console.log(`  ${String(rows.length).padStart(5)}  ${file}`);
    parsed.push(...rows);
  }

  await import('dotenv/config');
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev',
  });
  await db.connect();
  try {
    const held = (await db.query<Held>(HELD_SQL)).rows.map((h) => ({
      ...h,
      lat: Number(h.lat),
      lon: Number(h.lon),
    }));
    const p = planRefresh(held, parsed, { markMissing });
    const live = held.filter((h) => !h.missing).length;
    console.log(
      `\nDATAtourisme refresh — ${parsed.length} parsed, ${held.length} held (${live} live)\n`,
    );
    console.log(`  seen again                       ${p.seen.length}`);
    console.log(
      `    source re-dated the record     ${p.seen.filter((s) => s.dateChanged).length}`,
    );
    console.log(
      `    a published value changed      ${p.seen.filter((s) => s.contentChanged).length}`,
    );
    console.log(`    listed > 50 m away (not moved) ${p.moved}`);
    console.log(`  back after being missing         ${p.returned}`);
    console.log(
      `  absent, to be stamped missing    ${p.gone.length}  (${live ? ((p.gone.length / live) * 100).toFixed(2) : '0.00'}% of live)${markMissing ? '' : '  — NOT stamped: --no-mark-missing'}`,
    );
    console.log(
      `  absent, folded into a live page  ${p.heldBack.length}  (never stamped)`,
    );
    console.log(`  in the files, not held (unwritten) ${p.unknown.length}`);
    for (const s of p.unknown.slice(0, 15))
      console.log(`      ${s.name} — ${s.ref}`);
    if (p.unknown.length > 15)
      console.log(`      … and ${p.unknown.length - 15} more`);

    if (p.refusal) {
      console.error(`\n✗ ${p.refusal}`);
      process.exitCode = 1;
      return;
    }
    if (!apply) {
      console.log('\n(dry run — nothing was written. Add --apply to write.)');
      return;
    }
    const w = await applyRefresh(db, p, startedAt, { markMissing });
    console.log(
      `\n✓ stamped seen ${w.touched}, rewrote ${w.updated} (content changed on ${w.contentChanged}), ` +
        `marked missing ${w.stamped} of ${p.gone.length}`,
    );
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
