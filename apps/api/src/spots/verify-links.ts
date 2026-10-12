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
import { canonicalPath } from './canonical';
import { judgeByIdentity, upperBoundPercent } from './link-evidence';
import { SPOT_DETAIL_SQL } from './detail-query';
import {
  GONE_LIST_SQL,
  isSecondarySql,
  mergeAllLinked,
  mergedFieldSql,
  mergedStarsSql,
  REDIRECT_PAIRS_SQL,
  REDIRECT_LIST_SQL,
  RESOLVED_REDIRECTS_SQL,
} from './links';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * The OSM ref of the primary's own twin, or NULL when it is not an area.
 *
 * 🔴 libosmium numbers an area as `way × 2` and a relation as
 * `relation × 2 + 1`, which is why the parity of the number decides
 * which prefix comes back. Same arithmetic as `sourceOfArea`, written in
 * SQL because an invariant that has to pull every row into Node to check
 * it is an invariant nobody will run.
 */
const OWN_TWIN_REF_SQL = `CASE WHEN p.osm_ref ~ '^a[0-9]+$' THEN
             CASE WHEN (substring(p.osm_ref from 2))::bigint % 2 = 0
                  THEN 'w' || ((substring(p.osm_ref from 2))::bigint / 2)
                  ELSE 'r' || (((substring(p.osm_ref from 2))::bigint - 1) / 2)
             END END`;

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
    // 🔴 THIS REPLACED 'a live primary carries at most one secondary',
    // and the replacement is the point.
    //
    // That invariant existed because two secondaries made the star
    // rating depend on the query planner. CAMP-280 fixed the planner
    // dependence a different way — a total order plus a fold proven by
    // rehearsal — and CAMP-281 then allowed the second secondary,
    // because a campsite really can be three rows: an OSM area, the way
    // it was exported from, and a DATAtourisme record. 23 are.
    //
    // What is NOT allowed is a primary accumulating rows of the same
    // kind. One OSM twin and one outside record is the model; two
    // outside records on one campsite would mean the matcher merged two
    // different businesses, which is the failure this whole area exists
    // to prevent. So the ceiling moved from "one" to "one of each",
    // which is a sentence about the model rather than a number.
    name: 'a primary carries at most one OSM twin and one non-OSM secondary',
    sql: `SELECT count(*)::int AS n FROM (
            SELECT l.primary_id
              FROM spot_links l
              JOIN camping_spots s ON s.id = l.secondary_id
             WHERE l.unlinked_at IS NULL
             GROUP BY l.primary_id
            HAVING count(*) FILTER (WHERE s.osm_ref IS NULL) > 1
                OR count(*) FILTER (WHERE s.osm_ref IS NOT NULL) > 1) x`,
  },
  {
    name: 'a live secondary belongs to exactly one primary',
    sql: `SELECT count(*)::int AS n FROM (
            SELECT secondary_id FROM spot_links WHERE unlinked_at IS NULL
             GROUP BY secondary_id HAVING count(*) > 1) x`,
  },
  {
    // 🔴 REWORDED BY CAMP-281, AND NARROWED RATHER THAN LOOSENED.
    //
    // It used to say "one OSM row to one non-OSM row", and 828 links
    // broke it the day CAMP-274 folded each OSM area into the way it
    // was exported from. Those two rows ARE one campsite, so the data
    // was right and the sentence had expired.
    //
    // The temptation was to allow any OSM-to-OSM link. That would have
    // been the loosening that deletes the guard: it would permit
    // merging two genuinely different campsites, which is the one
    // mistake this whole area exists to prevent. So the second case is
    // stated exactly — the secondary must be the primary's OWN twin,
    // computed from the primary's ref by libosmium's rule
    // (area = way × 2, area = relation × 2 + 1), the same arithmetic as
    // `sourceOfArea`.
    name: "every secondary is a non-OSM row or the primary's own OSM twin",
    sql: `SELECT count(*)::int AS n
            FROM spot_links l
            JOIN camping_spots p ON p.id = l.primary_id
            JOIN camping_spots s ON s.id = l.secondary_id
           WHERE l.unlinked_at IS NULL
             AND p.osm_ref IS NOT NULL
             AND s.osm_ref IS NOT NULL
             AND s.osm_ref IS DISTINCT FROM (${OWN_TWIN_REF_SQL})`,
  },
  {
    // The other half of the sentence above, kept separate so a failure
    // names which half broke.
    name: 'every primary is an OSM row',
    sql: `SELECT count(*)::int AS n
            FROM spot_links l
            JOIN camping_spots p ON p.id = l.primary_id
           WHERE l.unlinked_at IS NULL AND p.osm_ref IS NULL`,
  },
  {
    // 🔴 CAMP-279. A redirect is a statement about two pages: this one
    // has none, that one carries it. Both halves have to be true, and
    // the failure modes are opposite — a redirect away from a page that
    // still exists deletes it from the site, a redirect towards a page
    // that does not exist sends readers and crawlers into a 404.
    name: 'every redirect leaves a row with no page and lands on one with a page',
    sql: `SELECT count(*)::int AS n
            FROM (${RESOLVED_REDIRECTS_SQL}) rp
            JOIN camping_spots f ON f.id = rp.from_id
            JOIN camping_spots t ON t.id = rp.to_id
           WHERE NOT (f.missing_since IS NOT NULL
                      OR f.region IS NULL
                      OR ${isSecondarySql('f')})
              OR t.missing_since IS NOT NULL
              OR t.region IS NULL
              OR ${isSecondarySql('t')}`,
  },
  {
    // 🔴 The guard a review had to find by hand. Being half of a pair
    // is not the same as having a destination: when the walk cannot
    // reach a terminal, nothing is published for that row — and
    // `gone()` has already subtracted it, so its URL is in neither
    // list and answers 404 in silence. Nothing asked the question
    // until a chain of ten was planted and row ten disappeared.
    //
    // A cycle makes this count rise, and it should: those URLs really
    // do answer nothing, and that is a fault to see rather than a
    // state to tolerate.
    name: 'every row that is half of a pair, and has a URL, gets a destination',
    sql: `SELECT count(*)::int AS n
            FROM (${REDIRECT_PAIRS_SQL}) rp
            JOIN camping_spots f ON f.id = rp.from_id
            LEFT JOIN (${RESOLVED_REDIRECTS_SQL}) rr
                   ON rr.from_id = rp.from_id
           WHERE f.region IS NOT NULL
             AND rr.from_id IS NULL`,
  },
  {
    // 🔴 Two redirects in a row lose the first one: a crawler follows
    // A → B, finds B redirecting to C, and the shortest path it records
    // is not the one we published. The existing invariants make a chain
    // impossible one link at a time; this says it about the answer.
    name: 'no redirect points at a row that is itself redirected',
    sql: `SELECT count(*)::int AS n
            FROM (${RESOLVED_REDIRECTS_SQL}) a
            JOIN (${RESOLVED_REDIRECTS_SQL}) b ON b.from_id = a.to_id`,
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
    // 🔴 CAMP-281: PROVE EACH INVARIANT CAN FAIL.
    //
    // This is the fault that let two of them sit broken for days. CI
    // runs this script against the fixture database, where `spot_links`
    // is EMPTY — so every invariant about links is trivially zero there,
    // and the build goes green having asked nothing. The 828 links that
    // broke one of them and the 7 chains that broke the other lived only
    // in the database nobody ran this against.
    //
    // So each invariant now gets its violation PLANTED, in a transaction
    // that is rolled back, and is required to catch it. An invariant
    // that cannot be made to fail here is not a check; it is a sentence.
    console.log('\n--- each invariant, shown failing on a planted row ---');
    const spares = await db.query<{
      osm_a: string;
      osm_b: string;
      plain_c: string;
      plain_d: string;
    }>(
      `WITH free AS (
         SELECT s.id, s.osm_ref
           FROM camping_spots s
          WHERE NOT EXISTS (SELECT 1 FROM spot_links l
                             WHERE l.unlinked_at IS NULL
                               AND (l.primary_id = s.id OR l.secondary_id = s.id)))
       SELECT (SELECT id FROM free WHERE osm_ref ~ '^a[0-9]+$' ORDER BY id LIMIT 1) AS osm_a,
              (SELECT id FROM free WHERE osm_ref ~ '^n[0-9]+$' ORDER BY id LIMIT 1) AS osm_b,
              (SELECT id FROM free WHERE osm_ref IS NULL ORDER BY id LIMIT 1) AS plain_c,
              (SELECT id FROM free WHERE osm_ref IS NULL ORDER BY id DESC LIMIT 1) AS plain_d`,
    );
    const sp = spares.rows[0];
    if (!sp || !sp.osm_a || !sp.osm_b || !sp.plain_c || !sp.plain_d) {
      console.error('  ✗ not enough unlinked rows to plant the violations');
      failed++;
    } else {
      const link = (pri: string, sec: string) =>
        db.query(
          `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                   name_similarity, rule)
           VALUES ($1, $2, 0, 1, 'trap')`,
          [pri, sec],
        );
      // 🔴 `osm_b` is an `n…` node, so it can never be the twin of an
      // `a…` area: libosmium's numbering only ever produces `w…` or
      // `r…`. The violation is therefore guaranteed by arithmetic rather
      // than by hoping two refs do not happen to pair up.
      const traps: { invariant: string; plant: () => Promise<unknown> }[] = [
        {
          invariant:
            "every secondary is a non-OSM row or the primary's own OSM twin",
          plant: () => link(sp.osm_a, sp.osm_b),
        },
        {
          invariant:
            'a primary carries at most one OSM twin and one non-OSM secondary',
          plant: async () => {
            await link(sp.osm_a, sp.plain_c);
            await link(sp.osm_a, sp.plain_d);
          },
        },
        {
          invariant: 'every primary is an OSM row',
          plant: () => link(sp.plain_c, sp.plain_d),
        },
        {
          invariant:
            'a live link never points at a row that is itself a live secondary',
          plant: async () => {
            await link(sp.osm_a, sp.plain_c);
            await link(sp.plain_c, sp.plain_d);
          },
        },
      ];

      for (const trap of traps) {
        const inv = INVARIANTS.find((i) => i.name === trap.invariant);
        if (!inv) {
          console.error(`  ✗ no invariant named "${trap.invariant}"`);
          failed++;
          continue;
        }
        await db.query('BEGIN');
        try {
          const before = await db.query<{ n: number }>(inv.sql);
          await trap.plant();
          const after = await db.query<{ n: number }>(inv.sql);
          const caught = (after.rows[0]?.n ?? 0) > (before.rows[0]?.n ?? 0);
          console.log(`  ${caught ? '✓' : '✗'} ${trap.invariant}`);
          if (!caught) failed++;
        } catch (err) {
          console.error(`  ✗ ${trap.invariant}: ${String(err)}`);
          failed++;
        } finally {
          await db.query('ROLLBACK');
        }
      }
      console.log('  (every one rolled back)');
    }

    // ------------------------------------------------------------------
    // CAMP-279: the two generated lists, read from the queries the API
    // actually serves.
    //
    // 🔴 One URL must never be in both. `middleware.ts` reads a redirect
    // map and a gone map built from these two endpoints; a path in both
    // means the site answers 301 or 410 depending on which file the
    // middleware consults first, and the prerendered /gone page names a
    // campsite that is open on another page.
    console.log('\n--- the two lists the site is built from ---');
    const bothLists = async (): Promise<{
      redirects: Map<string, string>;
      gone: Set<string>;
      overlap: string[];
      dropped: number;
    }> => {
      const r = await db.query<{
        from_country: string;
        from_region: string | null;
        from_slug: string;
        to_country: string;
        to_region: string | null;
        to_slug: string;
      }>(REDIRECT_LIST_SQL);
      const g = await db.query<{
        country: string;
        region: string | null;
        slug: string;
      }>(GONE_LIST_SQL);
      const redirects = new Map<string, string>();
      for (const row of r.rows) {
        const from = canonicalPath(
          row.from_country,
          row.from_region,
          row.from_slug,
        );
        const to = canonicalPath(row.to_country, row.to_region, row.to_slug);
        if (from && to && from !== to) redirects.set(from, to);
      }
      const gone = new Set<string>();
      for (const row of g.rows) {
        const p = canonicalPath(row.country, row.region, row.slug);
        if (p) gone.add(p);
      }
      return {
        redirects,
        gone,
        overlap: [...redirects.keys()].filter((p) => gone.has(p)),
        dropped: r.rows.length - redirects.size,
      };
    };

    const lists = await bothLists();
    console.log(
      `  ${lists.redirects.size} redirected, ${lists.gone.size} announced gone`,
    );
    // 🔴 The SQL says `region IS NOT NULL`; canonicalPath says the region
    // must SLUGIFY to something. They are not the same sentence, and a
    // row that satisfies one but not the other is dropped by the mapper
    // while `gone()` has already subtracted it — in neither list, again.
    // 0 of 809 (country, region) pairs slugify to empty today, so this
    // is a guard against a future row, which is exactly when nobody
    // would be looking.
    console.log(
      `  ${lists.dropped === 0 ? '✓' : '✗'} every redirect the query returns survives the path builder${
        lists.dropped ? ` (${lists.dropped} dropped)` : ''
      }`,
    );
    if (lists.dropped !== 0) failed++;
    console.log(
      `  ${lists.overlap.length === 0 ? '✓' : '✗'} no path is in both lists`,
    );
    if (lists.overlap.length > 0) {
      failed++;
      for (const p of lists.overlap.slice(0, 5)) console.error(`      ${p}`);
    }

    // ------------------------------------------------------------------
    // 🔴 CAMP-279 REHEARSAL, AND THE REASON IT EXISTS.
    //
    // Everything above this line was zero before the fix as well — not
    // because the fault was absent, but because it takes 28 days to
    // become visible. Six pairs entered the state on 12.10.2026, when
    // the import dropped their OSM primary while the secondary carried
    // on holding the campsite's page. On 09.11 `gone()` would have
    // answered 410 at the address that had been the canonical one,
    // about six campsites that are open.
    //
    // A check that cannot see the fault it was written for is the blind
    // alarm this file argues against two hundred lines up. So the state
    // is PLANTED here and the shipped queries are read back — and then
    // the link is undone and the same query is read again, because a
    // check that only ever passes has not been shown to be a check.
    console.log('\n--- rehearsal: OSM drops the primary, 29 days pass ---');
    const pairRow = await db.query<{
      link_id: string | null;
      pid: string;
      sid: string;
    }>(
      // 🔴 EXACTLY ONE live secondary, and a TOTAL order on the pick.
      //
      // Both halves of that sentence were learned the hard way on
      // 12.10.2026. `ORDER BY l.created_at` alone ties — thousands of
      // links are written in one batch and share the timestamp — so this
      // query returned a different pair on every run, and the rehearsal
      // was testing whichever campsite the planner felt like. The id
      // breaks the tie, the same way the merge's own order does.
      //
      // And since CAMP-281 a primary may carry TWO secondaries. Stamping
      // such a primary missing makes two redirect candidates out of one
      // row, and undoing one link leaves the other live — so both of
      // this rehearsal's assertions would be about a shape it was not
      // written for. That shape is real and deliberate; it is simply a
      // different rehearsal.
      `SELECT l.id AS link_id, l.primary_id AS pid, l.secondary_id AS sid
         FROM spot_links l
        WHERE l.unlinked_at IS NULL
          AND (SELECT count(*) FROM spot_links o
                WHERE o.primary_id = l.primary_id
                  AND o.unlinked_at IS NULL) = 1
        ORDER BY l.created_at, l.id
        LIMIT 1`,
    );
    let plantLink = false;
    if (pairRow.rowCount === 0) {
      // Same shape as the import rehearsal below: on a fresh database
      // `spot_links` is empty, and skipping would prove nothing.
      const made = await db.query<{ pid: string; sid: string }>(
        `SELECT p.id AS pid, o.id AS sid
           FROM camping_spots p
           JOIN camping_spots o ON o.id <> p.id
          WHERE p.osm_ref IS NOT NULL
            AND o.osm_ref IS NULL
            AND NOT EXISTS (SELECT 1 FROM spot_links x
                             WHERE x.unlinked_at IS NULL
                               AND (x.secondary_id = o.id
                                 OR x.primary_id = p.id))
          ORDER BY p.id, o.id
          LIMIT 1`,
      );
      if (made.rowCount === 0) {
        console.error(
          '  ✗ no OSM row with an unlinked non-OSM row beside it — cannot ' +
            'rehearse the redirect.',
        );
        failed++;
      } else {
        pairRow.rows[0] = { link_id: null, ...made.rows[0] };
        pairRow.rowCount = 1;
        plantLink = true;
      }
    }

    if (pairRow.rowCount === 1) {
      const { pid, sid } = pairRow.rows[0];
      await db.query('BEGIN');
      try {
        if (plantLink) {
          await db.query(
            `INSERT INTO spot_links
               (primary_id, secondary_id, metres, name_similarity, rule)
             VALUES ($1, $2, 0, 1, 'rehearsal')`,
            [pid, sid],
          );
        }
        // 🔴 Both rows are given a region inside the transaction rather
        // than being looked for among rows that already have one. A URL
        // needs a region, and a fixture that happened to have none would
        // turn this proof into a silent skip.
        await db.query(
          `UPDATE camping_spots SET region = coalesce(region, 'Rehearsal')
            WHERE id = ANY($1::uuid[])`,
          [[pid, sid]],
        );
        // The week OSM drops the primary, plus the four imports that
        // `gone()` waits for.
        await db.query(
          `UPDATE camping_spots SET missing_since = now() - interval '29 days'
            WHERE id = $1`,
          [pid],
        );
        const path = async (id: string): Promise<string | null> => {
          const r = await db.query<{
            country: string;
            region: string | null;
            slug: string;
          }>(`SELECT country, region, slug FROM camping_spots WHERE id = $1`, [
            id,
          ]);
          const row = r.rows[0];
          return row ? canonicalPath(row.country, row.region, row.slug) : null;
        };
        const pPath = await path(pid);
        const sPath = await path(sid);
        const after = await bothLists();

        const redirected =
          pPath !== null && after.redirects.get(pPath) === sPath;
        const notBuried = pPath !== null && !after.gone.has(pPath);
        console.log(
          `  ${redirected ? '✓' : '✗'} the dropped row redirects to the one holding the campsite`,
        );
        console.log(
          `  ${notBuried ? '✓' : '✗'} and is NOT announced gone, 29 days or not`,
        );
        // (A third line here asserted that the row which KEPT the
        // campsite is not announced gone. It never could be: `gone()`
        // only looks at rows with `missing_since`, and that row is alive
        // by construction. It never flipped under any mutation, which is
        // how it was found. Decoration, removed.)
        console.log(
          `  ${after.overlap.length === 0 ? '✓' : '✗'} the two lists still do not overlap`,
        );
        if (!redirected || !notBuried || after.overlap.length) failed++;

        // 🔴 Now prove the exclusion was caused by the link and not by
        // something else about this row. Undo the link and the same
        // query must bury it.
        await db.query(
          `UPDATE spot_links SET unlinked_at = now(), unlinked_reason = 'rehearsal'
            WHERE unlinked_at IS NULL AND primary_id = $1 AND secondary_id = $2`,
          [pid, sid],
        );
        const undone = await bothLists();
        const buriedOnceUnlinked = pPath !== null && undone.gone.has(pPath);
        console.log(
          `  ${buriedOnceUnlinked ? '✓' : '✗'} with the link undone the same query DOES announce it gone`,
        );
        if (!buriedOnceUnlinked) failed++;
      } finally {
        await db.query('ROLLBACK');
      }
      console.log('  (rolled back — the database is exactly as it was)');
    }

    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // 🔴 CAMP-279 REHEARSAL II: a chain, long enough to break a cap.
    //
    // Seven chains existed on 12.10.2026 and none of them was planned:
    // CAMP-274 folded an OSM area into the way it came from, and that
    // way was already carrying a DATAtourisme record. Nothing forbids
    // the shape, so the redirect list has to answer it.
    //
    // 🔴 TWELVE rows, not three, and the number is the point. The first
    // version of this walk stopped at `depth < 8`; a review planted a
    // chain of ten and found row ten with NO redirect — and `gone()`
    // had already subtracted it for being half of a pair, so its URL
    // was in neither list and answered 404 without a word. Three rows
    // could never have shown that.
    console.log(
      '\n--- rehearsal: a chain of twelve, and nobody may be dropped ---',
    );
    const chain = await db.query<{ id: string }>(
      `SELECT s.id
         FROM camping_spots s
        WHERE NOT EXISTS (SELECT 1 FROM spot_links l
                           WHERE l.unlinked_at IS NULL
                             AND (l.primary_id = s.id OR l.secondary_id = s.id))
        ORDER BY s.id
        LIMIT 12`,
    );
    const pathById = async (id: string): Promise<string | null> => {
      const r = await db.query<{
        country: string;
        region: string | null;
        slug: string;
      }>(`SELECT country, region, slug FROM camping_spots WHERE id = $1`, [id]);
      const row = r.rows[0];
      return row ? canonicalPath(row.country, row.region, row.slug) : null;
    };
    if (chain.rowCount !== 12) {
      console.error(
        `  ✗ only ${chain.rowCount} unlinked rows available — cannot build a chain`,
      );
      failed++;
    } else {
      // 🔴 The chain runs DOWN the id order on purpose: the top is the
      // largest id, so the correct destination is the one the fallback
      // tiebreak (lowest to_id) would never choose. Built the other way
      // round, this test passed with the resolution deleted — the right
      // answer and the accidental answer were the same row.
      const ascending = chain.rows.map((r) => r.id);
      const order = [...ascending].reverse();
      await db.query('BEGIN');
      try {
        await db.query(
          `UPDATE camping_spots SET region = coalesce(region, 'Rehearsal'),
                                    missing_since = NULL
            WHERE id = ANY($1::uuid[])`,
          [order],
        );
        // 🔴 The bottom of the chain is made OLD ENOUGH TO BURY. Without
        // this the fourth check below was green by construction: every
        // row had `missing_since = NULL`, so `gone()` never looked at
        // them, and the mutation that deletes the subtraction left it
        // ✓. A check that cannot fail is not a check.
        await db.query(
          `UPDATE camping_spots SET missing_since = now() - interval '29 days'
            WHERE id = $1`,
          [order[order.length - 1]],
        );
        for (let i = 0; i + 1 < order.length; i++) {
          await db.query(
            `INSERT INTO spot_links
               (primary_id, secondary_id, metres, name_similarity, rule)
             VALUES ($1, $2, 0, 1, 'rehearsal-chain')`,
            [order[i], order[i + 1]],
          );
        }
        const paths: (string | null)[] = [];
        for (const id of order) paths.push(await pathById(id));
        const topPath = paths[0];
        const below = paths.slice(1);
        const chained = await bothLists();

        const allResolved = below.every(
          (p) => p !== null && chained.redirects.has(p),
        );
        const allToTop = below.every(
          (p) => p !== null && chained.redirects.get(p) === topPath,
        );
        const middles = new Set(
          below.slice(0, -1).filter((p): p is string => p !== null),
        );
        const noneLandMidway = ![...chained.redirects.values()].some((t) =>
          middles.has(t),
        );
        const noneBuried = below.every(
          (p) => p !== null && !chained.gone.has(p),
        );

        console.log(
          `  ${allResolved ? '✓' : '✗'} every one of the eleven rows below the top has a destination`,
        );
        console.log(
          `  ${allToTop ? '✓' : '✗'} and that destination is the top, not the next step`,
        );
        console.log(
          `  ${noneLandMidway ? '✓' : '✗'} nothing is sent to a row that redirects onwards`,
        );
        console.log(
          `  ${noneBuried ? '✓' : '✗'} none of them is announced gone instead`,
        );
        if (!allResolved || !allToTop || !noneLandMidway || !noneBuried)
          failed++;

        // 🔴 And now make the mapper check FIRE, because a guard that has
        // never fired is a guess.
        //
        // `slugifyRegion` keeps `[a-z0-9]` and nothing else, so a region
        // written in its own alphabet slugifies to the empty string and
        // `canonicalPath` returns null. The SQL does not know that: it
        // asks only `region IS NOT NULL`, keeps the row, and `gone()`
        // subtracts it — so that URL would be in neither list. Greece,
        // Bulgaria and Cyprus are in the EU-27 and OSM holds their region
        // names in Greek and Cyrillic, so this is a row we have not
        // imported yet, not a row that cannot exist.
        await db.query(
          `UPDATE camping_spots SET region = 'Αττική' WHERE id = $1`,
          [order[order.length - 1]],
        );
        const greek = await bothLists();
        console.log(
          `  ${greek.dropped > 0 ? '✓' : '✗'} a region in its own alphabet is caught, not silently dropped`,
        );
        if (greek.dropped === 0) failed++;
      } finally {
        await db.query('ROLLBACK');
      }
      console.log('  (rolled back — the database is exactly as it was)');
    }
    // 🔴 CAMP-279 REHEARSAL III: a cycle, and a row that is both.
    //
    // Two clauses in RESOLVED_REDIRECTS_SQL exist for shapes the data
    // does not currently hold, and an untested guard is a guess. A
    // mutation run proved the point: deleting either the NOT EXISTS or
    // the ORDER BY left every check green, because each was covering
    // for the other on the only shape being rehearsed.
    console.log(
      '\n--- rehearsal: a cycle, and a row that redirects two ways ---',
    );
    // 🔴 None of the three may already be in a live link, in EITHER
    // role. The first version let `x` be a live primary — the partial
    // unique index then threw on the first INSERT, and the exception
    // walked straight past `failed++` and out of the process. A
    // rehearsal that dies is not a rehearsal that failed; it is one
    // that was never read. The import rehearsal below already states
    // the condition in full, and this was the asymmetry.
    const trio = await db.query<{ a: string; b: string; c: string }>(
      `SELECT x.id AS a, y.id AS b, z.id AS c
         FROM camping_spots x, camping_spots y, camping_spots z
        WHERE x.id < y.id AND y.id < z.id
          AND NOT EXISTS (SELECT 1 FROM spot_links l
                           WHERE l.unlinked_at IS NULL
                             AND (l.primary_id   IN (x.id, y.id, z.id)
                               OR l.secondary_id IN (x.id, y.id, z.id)))
        ORDER BY x.id, y.id, z.id
        LIMIT 1`,
    );
    if (trio.rowCount !== 1) {
      console.error('  ✗ no three unlinked rows to build these shapes from');
      failed++;
    }
    if (trio.rowCount === 1) {
      const { a, b, c } = trio.rows[0];
      const pathOf = pathById;
      const link = (pri: string, sec: string) =>
        db.query(
          `INSERT INTO spot_links
             (primary_id, secondary_id, metres, name_similarity, rule)
           VALUES ($1, $2, 0, 1, 'rehearsal-shape')`,
          [pri, sec],
        );
      const givePages = () =>
        db.query(
          `UPDATE camping_spots SET region = coalesce(region, 'Rehearsal'),
                                    missing_since = NULL
            WHERE id = ANY($1::uuid[])`,
          [[a, b, c]],
        );

      // --- a → b → c → a: three rows, each one hidden behind the next.
      await db.query('BEGIN');
      try {
        await givePages();
        await link(a, b);
        await link(b, c);
        await link(c, a);
        const paths = [await pathOf(a), await pathOf(b), await pathOf(c)];
        const cyc = await bothLists();
        const silent = paths.every((p) => p === null || !cyc.redirects.has(p));
        console.log(
          `  ${silent ? '✓' : '✗'} a cycle publishes no redirect at all, rather than a loop`,
        );
        if (!silent) failed++;
      } finally {
        await db.query('ROLLBACK');
      }

      // --- A row that is a secondary of a live primary AND the primary
      // of a live secondary, and has itself gone missing. Both halves
      // claim it. Its content is on the primary, so that is where it
      // must point.
      //
      // 🔴 The roles are assigned AGAINST the id order on purpose. The
      // trio comes back sorted, and with `top` = a the fallback
      // tiebreak (lowest to_id) would have chosen the right answer by
      // accident: the mutation that deletes `rank` survived, and the
      // test said nothing. `top` is the LAST id, so the wrong answer is
      // the one that sorts first.
      const top = c;
      const claimed = b;
      const low = a;
      await db.query('BEGIN');
      try {
        await givePages();
        await link(top, claimed);
        await link(claimed, low);
        await db.query(
          `UPDATE camping_spots SET missing_since = now() - interval '29 days'
            WHERE id = $1`,
          [claimed],
        );
        const pTop = await pathOf(top);
        const pClaimed = await pathOf(claimed);
        const both = await bothLists();
        const toPrimary =
          pClaimed !== null && both.redirects.get(pClaimed) === pTop;
        console.log(
          `  ${toPrimary ? '✓' : '✗'} a row both halves claim goes to the one carrying its content`,
        );
        if (!toPrimary) failed++;
      } finally {
        await db.query('ROLLBACK');
      }
      console.log('  (rolled back — the database is exactly as it was)');
    }

    // ------------------------------------------------------------------
    // 🔴 CAMP-280 REHEARSAL: two secondaries on one primary.
    //
    // The shape the unique index forbids today, rehearsed before the
    // index is dropped rather than after. A campsite can be three rows —
    // an OSM area, the way it was exported from, and a DATAtourisme
    // record — and 23 were on 12.10.2026, seven of them with their star
    // rating a level below where the merge could reach it.
    //
    // DROP INDEX is transactional in Postgres, so the forbidden shape
    // can be planted and rolled back like any other. That is the only
    // honest way to answer "will the read path hold" before committing
    // to it.
    console.log('\n--- rehearsal: one primary, two secondaries ---');
    const spare = await db.query<{ id: string }>(
      `SELECT s.id
         FROM camping_spots s
        WHERE NOT EXISTS (SELECT 1 FROM spot_links l
                           WHERE l.unlinked_at IS NULL
                             AND (l.primary_id = s.id OR l.secondary_id = s.id))
        ORDER BY s.id
        LIMIT 3`,
    );
    if (spare.rowCount !== 3) {
      console.error('  ✗ need three unlinked rows to rehearse two secondaries');
      failed++;
    } else {
      const [primary, first, second] = spare.rows.map((r) => r.id);

      // 🔴 THE SHIPPED QUERY, and the word is load-bearing.
      //
      // The first version of this rehearsal wrote its own SELECT over
      // the new lateral. It printed seven ticks while nine columns in
      // the real page query still named linked.id and friends, which the
      // lateral no longer has — every campsite page was a 500, and
      // nothing here could see it, because nothing here touched those
      // columns. A proof that reads a paraphrase proves the paraphrase.
      const slugRow = await db.query<{ slug: string }>(
        `SELECT slug FROM camping_spots WHERE id = $1`,
        [primary],
      );
      const slug = slugRow.rows[0]?.slug;

      // These two fragments are shipped on their own — the guide and
      // listing predicates embed them — so probing them directly is
      // reading the artefact, not a stand-in for one.
      const FRAGMENTS = `SELECT ${mergedStarsSql('s')} AS sql_stars,
                                ${mergedFieldSql('s', 'website', 'text')}
                                  AS sql_website
                           FROM camping_spots s WHERE s.id = $1`;

      // 🔴 Content belongs to the ROW; only the insert order varies.
      //
      // The first draft tied the two together — the row listed first
      // also got the French description — so "swap the order" also
      // swapped the content, and a missing tiebreak would have been
      // invisible. Here `first` always carries stars and French text and
      // `second` always carries the website and German text, whichever
      // order the links are made in.
      const dress = async (): Promise<void> => {
        await db.query(
          `UPDATE camping_spots
              SET region = coalesce(region, 'Rehearsal'), missing_since = NULL,
                  stars = NULL, website = NULL, description = NULL,
                  description_lang = NULL
            WHERE id = ANY($1::uuid[])`,
          [[primary, first, second]],
        );
        // A check constraint in the schema refuses a description without
        // a language — which is how this rehearsal learned that the
        // pairing is enforced by the database and not only by the merge.
        await db.query(
          `UPDATE camping_spots
              SET stars = 4, description = 'from first', description_lang = 'fr'
            WHERE id = $1`,
          [first],
        );
        await db.query(
          `UPDATE camping_spots
              SET website = 'https://example.test/second',
                  description = 'from second', description_lang = 'de'
            WHERE id = $1`,
          [second],
        );
        // 🔴 BOTH secondaries are made old enough to bury, or the check
        // below that neither is buried cannot fail for both of them.
        //
        // It was green by construction until a review mutated the
        // subtraction out of gone() and watched it stay green. The fix
        // then aged only `second`, so the check could fail — but only
        // ever on half its subject, while its name said "neither". A
        // review found that too.
        await db.query(
          `UPDATE camping_spots SET missing_since = now() - interval '29 days'
            WHERE id = ANY($1::uuid[])`,
          [[first, second]],
        );
      };

      const link = async (
        order: string[],
        when: 'apart' | 'tied',
      ): Promise<Record<string, unknown>> => {
        await db.query(`DELETE FROM spot_links WHERE rule = 'rehearsal-two'`);
        await dress();
        for (let i = 0; i < order.length; i++) {
          await db.query(
            `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                     name_similarity, rule, created_at)
             VALUES ($1, $2, 0, 1, 'rehearsal-two',
                     now() - ($3 || ' minutes')::interval)`,
            [primary, order[i], when === 'tied' ? 60 : 60 - i * 10],
          );
        }
        const r = await db.query(SPOT_DETAIL_SQL, [slug]);
        const merged = mergeAllLinked(r.rows[0] as Record<string, unknown>);
        const f = await db.query(FRAGMENTS, [primary]);
        return { ...merged, ...f.rows[0] };
      };

      await db.query('BEGIN');
      try {
        await db.query('DROP INDEX idx_spot_links_primary_live');

        const a = await link([first, second], 'apart');
        const bothRead =
          a.stars === 4 && a.website === 'https://example.test/second';
        const earlierWins =
          a.description === 'from first' && a.description_lang === 'fr';
        // 🔴 The SQL-side single-field merge must agree with the JS one,
        // or a campsite shows four stars on its page and none in the
        // listing that links to it.
        const sqlAgrees =
          a.sql_stars === 4 && a.sql_website === 'https://example.test/second';
        console.log(
          `  ${bothRead ? '✓' : '✗'} a field from EACH secondary reaches the page`,
        );
        console.log(
          `  ${earlierWins ? '✓' : '✗'} where both have one, the earlier link wins, with its language`,
        );
        console.log(
          `  ${sqlAgrees ? '✓' : '✗'} the SQL-side merge agrees, including past an empty secondary`,
        );
        if (!bothRead || !earlierWins || !sqlAgrees) failed++;

        // Same rows and the same content, opposite link order: the
        // answer must follow the ORDER.
        const b = await link([second, first], 'apart');
        const followsOrder =
          b.description === 'from second' && b.description_lang === 'de';
        console.log(
          `  ${followsOrder ? '✓' : '✗'} made the other way round, the other one wins`,
        );
        if (!followsOrder) failed++;

        // 🔴 And the case the index was added for: two links made in the
        // same instant. created_at ties, so only the id can decide. The
        // two runs below differ ONLY in the order the rows are inserted.
        //
        // 🔴 Said plainly: this check passes with the id tiebreak
        // DELETED. Measured — the planner currently returns these rows
        // in id order anyway, so it does the tiebreak's job by accident.
        // That the accident is real was checked separately: two rows
        // with an identical timestamp, aggregated with ORDER BY on that
        // timestamp alone, come back in INSERT order and swap when the
        // inserts swap. So the tiebreak is a contract rather than an
        // observed behaviour here, and what holds it is the text
        // assertion in links.spec.ts, which does fail when it is
        // removed. This check holds the end-to-end property; it does not
        // hold that clause.
        const t1 = await link([first, second], 'tied');
        const t2 = await link([second, first], 'tied');
        // 🔴 `!= null` is not decoration: with the fold deleted entirely
        // both sides are null, null === null, and this printed a tick
        // over a merge that did nothing.
        const stable =
          t1.description === t2.description && t1.description != null;
        console.log(
          `  ${stable ? '✓' : '✗'} with created_at tied, insert order does NOT decide`,
        );
        if (!stable) failed++;

        // 🔴 The card's other half: with two secondaries, BOTH of their
        // URLs must redirect to the primary, and neither to the other.
        // One secondary pointing at the other is a chain that only
        // exists because the model grew a second branch, and it would
        // send a reader through two hops to a page that the first hop
        // already hid.
        const pathOfRow = async (id: string): Promise<string | null> => {
          const r = await db.query<{
            country: string;
            region: string | null;
            slug: string;
          }>(`SELECT country, region, slug FROM camping_spots WHERE id = $1`, [
            id,
          ]);
          const row = r.rows[0];
          return row ? canonicalPath(row.country, row.region, row.slug) : null;
        };
        const pPrimary = await pathOfRow(primary);
        const pFirst = await pathOfRow(first);
        const pSecond = await pathOfRow(second);
        const two = await bothLists();
        const bothToPrimary =
          pFirst !== null &&
          pSecond !== null &&
          two.redirects.get(pFirst) === pPrimary &&
          two.redirects.get(pSecond) === pPrimary;
        const neitherBuried =
          !two.gone.has(pFirst ?? '') && !two.gone.has(pSecond ?? '');
        console.log(
          `  ${bothToPrimary ? '✓' : '✗'} both secondaries redirect to the primary, neither to the other`,
        );
        console.log(
          `  ${neitherBuried ? '✓' : '✗'} and neither is announced gone`,
        );
        if (!bothToPrimary || !neitherBuried) failed++;
      } catch (err) {
        // 🔴 A rehearsal that dies is not a rehearsal that failed; it is
        // one nobody read. The schema refused a row here once already.
        console.error(`  ✗ the rehearsal could not run: ${String(err)}`);
        failed++;
      } finally {
        await db.query('ROLLBACK');
      }
      console.log('  (rolled back — the index and the rows are as they were)');
    }

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
        console.error(
          '  ✗ no OSM campsite with an unlinked non-OSM row beside it — ' +
            'cannot rehearse. The partner must be a row that could legally ' +
            'be a secondary (no osm_ref, not already linked).',
        );
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
