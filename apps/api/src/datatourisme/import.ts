// CAMP-101: put a DATAtourisme regional file into the database.
//
//   npx ts-node src/datatourisme/import.ts <file.csv>            # dry run
//   npx ts-node src/datatourisme/import.ts <file.csv> --apply
//
// 🔴 A dry run by default, and that is not caution for its own sake.
// This importer can MERGE a record into a campsite that already has a
// page and a URL. A wrong merge publishes one business's description and
// official star rating on another's page. The default therefore prints
// what it would do and writes nothing, and `--apply` is a deliberate act.
//
// 🔴 The merge rule, in one line: DATAtourisme FILLS GAPS, it never
// overwrites. The two sources are good at different things — measured,
// not assumed:
//
//               OSM (Slovenia, 448)     DATAtourisme (PACA, 478)
//   name        26% missing             100% present
//   stars       not carried at all      91%
//   description not carried at all      99%
//   website     sparse                  94%
//   email       ~10 000 across Europe   0%
//   geometry    real polygons           a single point
//
// So the point stays OSM's, the amenities stay OSM's, and a name we
// already have is left alone; description and stars can only come from
// here; name and website are filled only where we have none. Nothing
// that a human or an owner supplied is ever touched — `owner_overrides`
// is not read or written by this file at all.

import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { Client } from 'pg';
import { isCampsite, parseRow } from './parse';
import type { DatatourismeRow, ParsedSpot } from './parse';
import { decide } from './match';
import type { Candidate, Decision } from './match';
import { splitCsvLine } from './report-coverage';

const SOURCE_ID = 'datatourisme';
const COUNTRY = 'FR';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/** Latin-ish slug, the same shape the OSM import produces. */
export function slugify(name: string, ref: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  // The ref is a URI; its last path segment is the stable uuid.
  return base || `spot-${ref.split('/').pop() ?? 'unknown'}`;
}

/** A slug nobody else is using. Suffixes are stable for a given order. */
export function uniqueSlug(wanted: string, used: Set<string>): string {
  if (!used.has(wanted)) {
    used.add(wanted);
    return wanted;
  }
  for (let n = 2; ; n++) {
    const candidate = `${wanted}-${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

export type Plan = {
  same: {
    spot: ParsedSpot;
    decision: Extract<Decision, { verdict: 'same' }>;
  }[];
  fresh: ParsedSpot[];
  review: {
    spot: ParsedSpot;
    decision: Extract<Decision, { verdict: 'review' }>;
  }[];
};

/**
 * Work out what to do with every parsed record.
 *
 * Pure given a candidate lookup, so the whole decision layer can be
 * driven in a test without a database.
 */
export function plan(
  spots: ParsedSpot[],
  candidatesNear: (s: ParsedSpot) => Candidate[],
): Plan {
  const out: Plan = { same: [], fresh: [], review: [] };
  for (const spot of spots) {
    const d = decide(
      { name: spot.name, lat: spot.lat, lon: spot.lon },
      candidatesNear(spot),
    );
    if (d.verdict === 'same') out.same.push({ spot, decision: d });
    else if (d.verdict === 'review') out.review.push({ spot, decision: d });
    else out.fresh.push(spot);
  }
  return out;
}

/** The source entry this import stamps on every record it touches. */
export function sourceEntry(spot: ParsedSpot, fields: string[]) {
  return {
    id: SOURCE_ID,
    ref: spot.ref,
    updatedAt: spot.updatedAt,
    fields,
  };
}

/**
 * Which fields this record is allowed to contribute to an existing spot.
 *
 * 🔴 Gap-filling only. `stars` and `description` are unconditional
 * because no other source carries them; everything else is offered only
 * where we hold nothing.
 */
export function fieldsToFill(
  spot: ParsedSpot,
  existing: { name: string | null; website: string | null },
): string[] {
  const fields: string[] = [];
  if (spot.stars !== null) fields.push('stars');
  if (spot.description) fields.push('description');
  if (spot.name && !existing.name) fields.push('name');
  if (spot.website && !existing.website) fields.push('website');
  return fields;
}

// ---------------------------------------------------------------------

async function readCampsites(path: string): Promise<ParsedSpot[]> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let header: string[] | null = null;
  let pending = '';
  const out: ParsedSpot[] = [];

  for await (const line of rl) {
    pending = pending ? `${pending}\n${line}` : line;
    if ((pending.match(/"/g) ?? []).length % 2 !== 0) continue;
    const fields = splitCsvLine(pending);
    pending = '';
    if (!header) {
      header = fields.map((f) => f.trim());
      continue;
    }
    const row: DatatourismeRow = {};
    header.forEach((h, i) => (row[h] = fields[i]));
    if (!isCampsite(row)) continue;
    const spot = parseRow(row);
    if (spot) out.push(spot);
  }
  return out;
}

async function main() {
  const path = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!path) {
    console.error('usage: import.ts <file.csv> [--apply]');
    process.exit(1);
  }

  const spots = await readCampsites(path);
  console.log(`${spots.length} campsites parsed from ${path}`);
  if (spots.length === 0) {
    console.error('✗ nothing parsed — refusing to continue');
    process.exit(1);
  }

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    // Candidates for every record in one query rather than 2000 of them.
    // 400 m is the matcher's outer radius; anything further can never be
    // the same campsite whatever it is called.
    const near = await db.query<{
      ref: string;
      id: string;
      name: string | null;
      lat: number;
      lon: number;
    }>(
      `
      WITH incoming AS (
        SELECT * FROM unnest($1::text[], $2::float8[], $3::float8[])
          AS t(ref, lat, lon)
      )
      SELECT i.ref,
             s.id::text AS id,
             s.name,
             ST_Y(s.location::geometry) AS lat,
             ST_X(s.location::geometry) AS lon
        FROM incoming i
        JOIN camping_spots s
          ON ST_DWithin(
               s.location::geography,
               ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)::geography,
               400)
      `,
      [
        spots.map((s) => s.ref),
        spots.map((s) => s.lat),
        spots.map((s) => s.lon),
      ],
    );

    const byRef = new Map<string, Candidate[]>();
    for (const r of near.rows) {
      const list = byRef.get(r.ref) ?? [];
      list.push({
        id: r.id,
        name: r.name,
        lat: Number(r.lat),
        lon: Number(r.lon),
      });
      byRef.set(r.ref, list);
    }

    const p = plan(spots, (s) => byRef.get(s.ref) ?? []);

    console.log('');
    console.log(`  merge into an existing campsite   ${p.same.length}`);
    console.log(`  new campsites                     ${p.fresh.length}`);
    console.log(`  left for a human to look at       ${p.review.length}`);

    if (p.review.length > 0) {
      console.log('\n  needs a look:');
      for (const { spot, decision } of p.review.slice(0, 15)) {
        console.log(
          `    ${spot.name.padEnd(42).slice(0, 42)} ${String(decision.metres).padStart(4)} m  sim ${decision.similarity}  ${decision.why}`,
        );
      }
      if (p.review.length > 15)
        console.log(`    … and ${p.review.length - 15} more`);
    }

    if (!apply) {
      console.log('\n(dry run — nothing was written. Add --apply to write.)');
      return;
    }

    const used = new Set(
      (
        await db.query<{ slug: string }>('SELECT slug FROM camping_spots')
      ).rows.map((r) => r.slug),
    );

    await db.query('BEGIN');
    let merged = 0;
    let inserted = 0;

    for (const { spot, decision } of p.same) {
      const existing = await db.query<{
        name: string | null;
        website: string | null;
      }>(
        `SELECT name, NULL::text AS website FROM camping_spots WHERE id = $1`,
        [decision.id],
      );
      const fields = fieldsToFill(
        spot,
        existing.rows[0] ?? { name: null, website: null },
      );
      if (fields.length === 0) continue;

      await db.query(
        `
        UPDATE camping_spots SET
          name             = COALESCE(name, $2),
          description      = COALESCE($3, description),
          description_lang = CASE WHEN $3 IS NULL THEN description_lang ELSE 'fr' END,
          stars            = COALESCE($4, stars),
          sources          = (
            SELECT COALESCE(jsonb_agg(e), '[]'::jsonb) || $5::jsonb
              FROM jsonb_array_elements(sources) e
             WHERE e->>'id' <> $6
          ),
          content_changed_at = now()
        WHERE id = $1
        `,
        [
          decision.id,
          spot.name,
          spot.description,
          spot.stars,
          JSON.stringify([sourceEntry(spot, fields)]),
          SOURCE_ID,
        ],
      );
      merged++;
    }

    for (const spot of p.fresh) {
      const slug = uniqueSlug(slugify(spot.name, spot.ref), used);
      const fields = fieldsToFill(spot, { name: null, website: null });
      fields.push('location');
      await db.query(
        `
        INSERT INTO camping_spots
          (name, country, region, slug, type, amenities, location,
           description, description_lang, stars, sources, last_seen_at)
        SELECT $1, $2,
               (SELECT lower(regexp_replace(a.name, '[^a-zA-Z0-9]+', '-', 'g'))
                  FROM ne_admin1 a
                 WHERE ST_Contains(a.geom, ST_SetSRID(ST_MakePoint($4, $3), 4326))
                 LIMIT 1),
               $5, 'paid', '{}'::jsonb,
               ST_SetSRID(ST_MakePoint($4, $3), 4326),
               $6, CASE WHEN $6 IS NULL THEN NULL ELSE 'fr' END, $7, $8::jsonb, now()
        `,
        [
          spot.name,
          COUNTRY,
          spot.lat,
          spot.lon,
          slug,
          spot.description,
          spot.stars,
          JSON.stringify([sourceEntry(spot, fields)]),
        ],
      );
      inserted++;
    }

    await db.query('COMMIT');
    console.log(`\n✓ merged ${merged}, inserted ${inserted}`);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw err;
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
