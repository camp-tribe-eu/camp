// CAMP-144: prove the links are right, and prove they survive Monday.
//
//   npx ts-node src/spots/verify-links.ts
//
// 🔴 THREE QUESTIONS, AND NONE OF THEM IS "DID THE CODE RUN".
//
//   1. How many of these links are wrong? Measured against evidence the
//      matching rule never looks at.
//   2. Can the table hold a shape the reader side cannot render?
//   3. Does a link actually survive the weekly OSM import? Not "the
//      column is not in the DO UPDATE list" — the import is REHEARSED
//      against the live row and rolled back.
//
// Exits non-zero on any failure, so CI can run it.

import 'dotenv/config';
import { Client } from 'pg';
import { UPSERT_SPOT_SQL } from '../osm/import-spots';
import { judgeByIdentity, upperBoundPercent } from './link-evidence';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

const INVARIANTS: { name: string; sql: string }[] = [
  {
    name: 'a live link never points at a row that is itself a live secondary',
    sql: `SELECT count(*)::int AS n
            FROM spot_links l
            JOIN spot_links p ON p.secondary_id = l.primary_id
                             AND p.unlinked_at IS NULL
           WHERE l.unlinked_at IS NULL`,
  },
  {
    // 🔴 The invariant that was missing while the comment on
    // LINKED_SECONDARY_JOIN claimed it was checked here. Two records
    // pointing at one campsite makes the star rating on that page depend
    // on the query planner. The unique index prevents it; this proves
    // the index is doing what it was added for.
    name: 'a live primary carries at most one secondary',
    sql: `SELECT count(*)::int AS n FROM (
            SELECT primary_id FROM spot_links WHERE unlinked_at IS NULL
             GROUP BY primary_id HAVING count(*) > 1) x`,
  },
  {
    name: 'a live secondary belongs to exactly one primary',
    sql: `SELECT count(*)::int AS n FROM (
            SELECT secondary_id FROM spot_links WHERE unlinked_at IS NULL
             GROUP BY secondary_id HAVING count(*) > 1) x`,
  },
  {
    name: 'every link joins one OSM row to one non-OSM row',
    sql: `SELECT count(*)::int AS n
            FROM spot_links l
            JOIN camping_spots p ON p.id = l.primary_id
            JOIN camping_spots s ON s.id = l.secondary_id
           WHERE l.unlinked_at IS NULL
             AND NOT (p.osm_ref IS NOT NULL AND s.osm_ref IS NULL)`,
  },
  {
    name: 'no link joins a row to itself',
    sql: `SELECT count(*)::int AS n FROM spot_links
           WHERE primary_id = secondary_id`,
  },
  {
    // 🔴 A → B and B → A are both legal under the two partial unique
    // indexes, and together they are a redirect loop with both rows
    // hidden from the site. The reconciler cannot build one (the primary
    // is always the OSM side and an OSM row is never a secondary), so
    // this is about what a hand-written link can do.
    name: 'no two rows are linked to each other in both directions',
    sql: `SELECT count(*)::int AS n
            FROM spot_links a
            JOIN spot_links b ON b.primary_id = a.secondary_id
                             AND b.secondary_id = a.primary_id
                             AND b.unlinked_at IS NULL
           WHERE a.unlinked_at IS NULL`,
  },
];

/**
 * Things worth saying out loud that are NOT failures.
 *
 * 🔴 "The primary has no region" used to be invariant 5, and it was
 * wrong to fail on it. `isSecondarySql` now deliberately TOLERATES a
 * primary that has become unpublishable — the secondary un-hides and
 * becomes its own page again, which is the correct outcome and the whole
 * point of the second commit on this branch. Failing here would have
 * turned that correct state into a red build.
 *
 * The reconciler no longer CREATES such a link (its candidate query
 * requires the primary to be publishable), so a count above zero means
 * the world moved under an existing link, which is ordinary. It is
 * reported because it is worth seeing, not because it is broken.
 */
const NOTICES: { name: string; sql: string }[] = [
  {
    name: 'links whose primary has since gone missing or lost its region',
    sql: `SELECT count(*)::int AS n
            FROM spot_links l
            JOIN camping_spots p ON p.id = l.primary_id
           WHERE l.unlinked_at IS NULL
             AND (p.region IS NULL OR p.missing_since IS NOT NULL)`,
  },
];

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  let failed = 0;
  try {
    const live = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spot_links WHERE unlinked_at IS NULL`,
    );
    const undone = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM spot_links WHERE unlinked_at IS NOT NULL`,
    );
    console.log(
      `${live.rows[0].n} live links, ${undone.rows[0].n} undone by hand\n`,
    );

    // 🔴 docs/data-durability.md argues that `spot_links` need not be
    // backed up, and the argument rests on one number: nobody has undone
    // a link yet. The links themselves rebuild in a second; a person's
    // "this match is wrong" does not, and losing it means the reconciler
    // silently recreates the link they removed.
    //
    // A dated comment cannot notice when its own premise expires. This
    // can, and it runs in CI already.
    if (undone.rows[0].n > 0) {
      console.log(
        `⚠ ${undone.rows[0].n} link(s) carry a human decision that no ` +
          'backup holds.\n' +
          '  docs/data-durability.md assumed this count was 0. It is not ' +
          'any more:\n' +
          '  spot_links needs an export keyed on osm_ref and the source ' +
          'URI, with a restore path and a self-test.\n',
      );
    }

    console.log('--- invariants ---');
    for (const inv of INVARIANTS) {
      const r = await db.query<{ n: number }>(inv.sql);
      const n = r.rows[0]?.n ?? 0;
      console.log(`  ${n === 0 ? '✓' : '✗'} ${inv.name}${n ? ` (${n})` : ''}`);
      if (n !== 0) failed++;
    }

    for (const notice of NOTICES) {
      const r = await db.query<{ n: number }>(notice.sql);
      const n = r.rows[0]?.n ?? 0;
      console.log(`  · ${notice.name}: ${n} (their rows are visible again)`);
    }

    // ------------------------------------------------------------------
    console.log(
      '\n--- error rate, measured on a field the rule never reads ---',
    );
    const ev = await db.query<{
      a_url: string | null;
      a_email: string | null;
      b_url: string | null;
      b_email: string | null;
    }>(
      `SELECT coalesce(p.contact->>'website', p.website) AS a_url,
              p.contact->>'email' AS a_email,
              coalesce(s.website, s.contact->>'website') AS b_url,
              s.contact->>'email' AS b_email
         FROM spot_links l
         JOIN camping_spots p ON p.id = l.primary_id
         JOIN camping_spots s ON s.id = l.secondary_id
        WHERE l.unlinked_at IS NULL`,
    );
    const j = judgeByIdentity(
      ev.rows.map((r) => ({
        aWebsite: r.a_url,
        aEmail: r.a_email,
        bWebsite: r.b_url,
        bEmail: r.b_email,
      })),
    );
    const judged = j.agree + j.disagree;
    console.log(`  both sides name themselves          ${judged}`);
    console.log(`  same domain  (independent yes)      ${j.agree}`);
    console.log(`  different domain (needs a look)     ${j.disagree}`);
    console.log(`  one side names nobody               ${j.noEvidence}`);
    const bound = upperBoundPercent(j);
    console.log(
      bound === null
        ? '  → nothing could be judged: no upper bound can be stated'
        : `  → upper bound on the wrong-link rate ${bound.toFixed(1)}%`,
    );

    // ------------------------------------------------------------------
    // 🔴 THE PROOF THAT MATTERS: rehearse the weekly import.
    //
    // A backup nobody has restored from does not exist, and a link
    // nobody has run the import over is not known to survive it. This
    // replays the REAL statement — UPSERT_SPOT_SQL, imported, not a
    // paraphrase — against a real linked row with its own current
    // values, then rolls back. If somebody ever adds a link column to
    // that DO UPDATE list, or the upsert starts re-inserting rows
    // instead of updating them, this fails here rather than silently on
    // a Monday.
    console.log(
      '\n--- rehearsal: the weekly OSM import, run and rolled back ---',
    );
    const victim = await db.query<{
      id: string;
      name: string | null;
      country: string;
      region: string | null;
      slug: string;
      type: string;
      amenities: unknown;
      wkt: string;
      osm_ref: string;
      contact: unknown;
      link_id: string;
    }>(
      `SELECT p.id, p.name, p.country, p.region, p.slug, p.type::text AS type,
              p.amenities, ST_AsText(p.location) AS wkt, p.osm_ref, p.contact,
              l.id AS link_id
         FROM spot_links l
         JOIN camping_spots p ON p.id = l.primary_id
        WHERE l.unlinked_at IS NULL
        ORDER BY l.created_at
        LIMIT 1`,
    );
    // 🔴 When there is no link yet, one is INVENTED inside the
    // transaction rather than the rehearsal being skipped.
    //
    // A check that quietly passes because it found nothing to check is
    // the blind alarm this project keeps meeting. On a fresh database —
    // which is exactly where CI runs — `spot_links` is empty, so
    // "no live link to rehearse against" would be printed and the build
    // would go green having proved nothing. The synthetic link is rolled
    // back with everything else.
    let synthetic = false;
    if (victim.rowCount === 0) {
      const pair = await db.query<{
        id: string;
        name: string | null;
        country: string;
        region: string | null;
        slug: string;
        type: string;
        amenities: unknown;
        wkt: string;
        osm_ref: string;
        contact: unknown;
        other_id: string;
      }>(
        `SELECT p.id, p.name, p.country, p.region, p.slug,
                p.type::text AS type, p.amenities,
                ST_AsText(p.location) AS wkt, p.osm_ref, p.contact,
                o.id AS other_id
           FROM camping_spots p
           JOIN camping_spots o ON o.id <> p.id
          WHERE p.osm_ref IS NOT NULL
            -- 🔴 The partner must be a row that COULD be a secondary,
            -- and must not already be one. Picking the first row by id
            -- collided with the live unique index on a database that
            -- already had links: the INSERT threw, the error escaped
            -- past the rollback, and the script died with a Postgres
            -- message instead of reporting a check.
            AND o.osm_ref IS NULL
            AND NOT EXISTS (SELECT 1 FROM spot_links x
                             WHERE x.unlinked_at IS NULL
                               AND (x.secondary_id = o.id
                                 OR x.primary_id = p.id))
          ORDER BY p.id, o.id
          LIMIT 1`,
      );
      if (pair.rowCount === 0) {
        console.error('  ✗ no campsite with an osm_ref — cannot rehearse');
        failed++;
      } else {
        victim.rows[0] = { ...pair.rows[0], link_id: 'synthetic' };
        victim.rowCount = 1;
        synthetic = true;
      }
    }

    if (victim.rowCount === 0) {
      console.log('  — nothing to rehearse against');
    } else {
      const v = victim.rows[0];
      await db.query('BEGIN');
      try {
        if (synthetic) {
          const other = (victim.rows[0] as unknown as { other_id: string })
            .other_id;
          await db.query(
            `INSERT INTO spot_links
               (primary_id, secondary_id, metres, name_similarity, rule)
             VALUES ($1, $2, 0, 1, 'rehearsal')`,
            [v.id, other],
          );
          console.log(
            '  (no real link yet — rehearsing against a temporary one)',
          );
        }
        const res = await db.query<{ was_insert: boolean }>(UPSERT_SPOT_SQL, [
          v.name,
          v.country,
          v.region,
          v.slug,
          v.type,
          JSON.stringify(v.amenities),
          v.wkt,
          v.osm_ref,
          new Date().toISOString(),
          JSON.stringify(v.contact),
        ]);
        const wasInsert = res.rows[0]?.was_insert === true;

        const after = await db.query<{ id: string; n: number }>(
          `SELECT s.id, count(l.id)::int AS n
             FROM camping_spots s
             LEFT JOIN spot_links l ON l.primary_id = s.id
                                   AND l.unlinked_at IS NULL
            WHERE s.osm_ref = $1
            GROUP BY s.id`,
          [v.osm_ref],
        );
        const sameRow = after.rows[0]?.id === v.id;
        const stillLinked = (after.rows[0]?.n ?? 0) > 0;

        console.log(
          `  ${!wasInsert ? '✓' : '✗'} the import UPDATED the row, it did not insert a new one`,
        );
        console.log(
          `  ${sameRow ? '✓' : '✗'} the row kept its id (${v.osm_ref})`,
        );
        console.log(
          `  ${stillLinked ? '✓' : '✗'} the link is still live after the import`,
        );
        if (wasInsert || !sameRow || !stillLinked) failed++;
      } finally {
        await db.query('ROLLBACK');
      }
      console.log('  (rolled back — the database is exactly as it was)');
    }
  } finally {
    await db.end();
  }
  if (failed > 0) {
    console.error(`\n✗ ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ all checks passed');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
