// CAMP-281: the campsites that are three rows, folded into one page.
//
//   npx ts-node src/spots/fold-three-row-campsites.ts            (dry run)
//   npx ts-node src/spots/fold-three-row-campsites.ts --apply
//   npx ts-node src/spots/fold-three-row-campsites.ts --self-test
//
// 🔴 ONE PHENOMENON, TWO SHAPES.
//
// OpenStreetMap exports the same campsite as an area `a…` and as the way
// `w…` it was built from. A DATAtourisme record describes it a third
// time. Which of the two OSM rows that record was matched to decides
// which shape the campsite is in today:
//
//   matched to the AREA  → the way could not be folded, because a
//                          primary was allowed only one secondary.
//                          16 campsites, 16 duplicate pages.
//   matched to the WAY   → the area folded the way on top, and the
//                          DATAtourisme row ended up two levels down,
//                          where the merge cannot see it. 7 campsites,
//                          each missing its official star rating, its
//                          website, and in three cases its prices.
//
// Both become the same thing: the area is the primary, and the way and
// the DATAtourisme record are its two secondaries.
//
// 🔴 Nothing is deleted and no row is rewritten. Shape one inserts a
// link; shape two moves an existing link's primary. The DATAtourisme
// row keeps its id, its slug and its history either way.

import 'dotenv/config';
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { sourceOfArea } from './reconcile-osm-areas';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

export type Fold =
  | { kind: 'link'; primary: string; secondary: string; name: string }
  | { kind: 'repoint'; link: string; from: string; to: string; name: string }
  | { kind: 'unmark'; row: string; ref: string; name: string };

/** A stable line per fold, so a prediction can be compared element-wise. */
export function foldKey(f: Fold): string {
  if (f.kind === 'link') return `link|${f.primary}|${f.secondary}`;
  if (f.kind === 'repoint') return `repoint|${f.link}|${f.from}|${f.to}`;
  return `unmark|${f.row}`;
}

/**
 * 🔴 The twin is recomputed here from the AREA's own ref rather than
 * trusted from the join, so a row whose `osm_ref` does not actually pair
 * with the area cannot be folded by a query mistake.
 */
export function isTwinOf(areaRef: string, otherRef: string | null): boolean {
  return otherRef !== null && sourceOfArea(areaRef) === otherRef;
}

/**
 * Why a record sitting under a twin cannot be moved up onto the area.
 *
 * 🔴 ONE definition, because two places must agree about it.
 *
 * The flattening step refuses for these reasons, and the folding step
 * must refuse to CREATE a chain for exactly the same ones — otherwise
 * it builds a chain nobody can then undo and the run reports success
 * over a red invariant.
 *
 * That asymmetry has now happened twice, each time because a new reason
 * was added to one list and not the other. A reviewer found both. So the
 * reasons live here, in one fragment that both queries embed, and
 * `skipped()` names whichever of them fired.
 */
function cannotMoveUpSql(top: string, below: string): string {
  return `(
      -- The pair already carries a judgement: a live link would be a
      -- duplicate, an undone one is a decision somebody made by hand.
      EXISTS (SELECT 1 FROM spot_links q
               WHERE q.primary_id = ${top}.id
                 AND q.secondary_id = ${below}.secondary_id)
      -- Or this campsite already has an outside record of its own, and
      -- a second one is a question for a person, not for a script.
      OR EXISTS (SELECT 1 FROM spot_links own
                  JOIN camping_spots mine ON mine.id = own.secondary_id
                 WHERE own.primary_id = ${top}.id
                   AND own.unlinked_at IS NULL
                   AND mine.osm_ref IS NULL))`;
}

/** Which of those reasons fired, as text, for the report. */
function whyCannotMoveUpSql(top: string, below: string): string {
  return `CASE
      WHEN EXISTS (SELECT 1 FROM spot_links q
                    WHERE q.primary_id = ${top}.id
                      AND q.secondary_id = ${below}.secondary_id)
      THEN 'the pair (campsite, outside record) already carries a decision'
      ELSE 'this campsite already carries an outside record of its own'
    END`;
}

const UNFOLDED_TWINS_SQL = `
  SELECT a.id AS area_id, a.osm_ref AS area_ref,
         coalesce(a.name, '(unnamed)') AS name,
         t.id AS twin_id, t.osm_ref AS twin_ref
    FROM camping_spots a
    JOIN camping_spots t ON t.osm_ref = CASE
           WHEN (substring(a.osm_ref from 2))::bigint % 2 = 0
           THEN 'w' || ((substring(a.osm_ref from 2))::bigint / 2)
           ELSE 'r' || (((substring(a.osm_ref from 2))::bigint - 1) / 2) END
   WHERE a.osm_ref ~ '^a[0-9]+$'
     -- 🔴 ANY row, live or undone. A live-only test here would have
     -- re-proposed a link a person had deliberately taken apart — and
     -- idx_spot_links_pair is unique unconditionally, so the apply would
     -- not merely re-link it, it would die on the insert and take the
     -- rest of the run with it. reconcile-sources states the same rule
     -- for the same table: a judgement already recorded is left alone.
     AND NOT EXISTS (SELECT 1 FROM spot_links l
                      WHERE l.primary_id = a.id AND l.secondary_id = t.id)
     -- A row already folded into somebody else must not be folded again:
     -- the live unique index on secondary_id would refuse it, and the
     -- refusal would be right.
     AND NOT EXISTS (SELECT 1 FROM spot_links l
                      WHERE l.unlinked_at IS NULL AND l.secondary_id = t.id)
     -- 🔴 And never make a chain this run cannot then flatten.
     --
     -- If the twin carries an outside record, folding the twin creates
     -- area → twin → record, and the flattening step moves that record
     -- up. But it refuses to move it when the pair (area, record)
     -- already carries a decision somebody made by hand — so the chain
     -- would be made and left, breaking an invariant for good while the
     -- script printed "0 outstanding". A review built exactly that row.
     AND NOT EXISTS (
           SELECT 1 FROM spot_links below
            WHERE below.primary_id = t.id AND below.unlinked_at IS NULL
              AND ${cannotMoveUpSql('a', 'below')})
   ORDER BY a.osm_ref`;

const CHAINS_SQL = `
  SELECT below.id AS link_id, mid.id AS from_id, top.id AS to_id,
         coalesce(top.name, '(unnamed)') AS name,
         top.osm_ref AS top_ref, mid.osm_ref AS mid_ref
    FROM camping_spots top
    JOIN camping_spots mid ON mid.osm_ref = CASE
           WHEN (substring(top.osm_ref from 2))::bigint % 2 = 0
           THEN 'w' || ((substring(top.osm_ref from 2))::bigint / 2)
           ELSE 'r' || (((substring(top.osm_ref from 2))::bigint - 1) / 2) END
    JOIN spot_links below ON below.primary_id = mid.id
                         AND below.unlinked_at IS NULL
   WHERE top.osm_ref ~ '^a[0-9]+$'
     -- 🔴 The chain is found from the TWIN, not from the link above it.
     --
     -- The first fix moved this bug rather than removing it: the stamp
     -- query stopped depending on the link, and this one still started
     -- FROM spot_links above, so a chain was invisible until the link
     -- step of the SAME run created that row. One dry run still could
     -- not describe the whole change, and a second apply still printed
     -- "7 outstanding". It hid on 12.10 only because those 7 links had
     -- been made the night before by another card.
     --
     -- The twin is arithmetic, so it is there whether or not anything
     -- has been written yet.
     AND NOT EXISTS (SELECT 1 FROM spot_links o
                      WHERE o.unlinked_at IS NULL
                        AND o.secondary_id = mid.id
                        AND o.primary_id <> top.id)
     -- 🔴 The same definition the folding step uses, so the two cannot
     -- drift: everything this refuses, that one refuses to create.
     AND NOT ${cannotMoveUpSql('top', 'below')}
     -- 🔴 And it must honour the same human decision the other two
     -- queries honour. This one did not: with the area↔twin link taken
     -- apart by hand, the outside record was still moved onto the area
     -- the person had just separated it from. Three queries, one rule,
     -- and it was written in two of them.
     AND NOT EXISTS (SELECT 1 FROM spot_links h
                      WHERE h.primary_id = top.id
                        AND h.secondary_id = mid.id
                        AND h.unlinked_at IS NOT NULL)
   ORDER BY top.osm_ref`;

/**
 * 🔴 A twin stamped missing ONLY because it had not been folded yet.
 *
 * `MARK_GONE_SQL` deliberately refuses to stamp a row that is the live
 * secondary of a live primary: a way OpenStreetMap now exports as an
 * area has not gone anywhere, it is represented by the other row. All
 * 828 folded twins are protected by that clause.
 *
 * The 16 that could not be folded were not protected, so the import of
 * 12.10.2026 01:16 stamped every one of them — and the stamp never
 * clears itself, because MARK_GONE_SQL only ever sets it.
 *
 * It changes nothing today: a stamped secondary of a live primary still
 * redirects and is still kept out of the gone list. It changes
 * everything the day the area disappears — the 828 would un-hide and
 * keep a page, these 16 would be missing too and the campsite would
 * have none.
 */
const STAMPED_FOR_WANT_OF_A_LINK_SQL = `
  SELECT t.id AS row_id, t.osm_ref AS ref, a.osm_ref AS area_ref,
         coalesce(t.name, '(unnamed)') AS name
    FROM camping_spots a
    JOIN camping_spots t ON t.osm_ref = CASE
           WHEN (substring(a.osm_ref from 2))::bigint % 2 = 0
           THEN 'w' || ((substring(a.osm_ref from 2))::bigint / 2)
           ELSE 'r' || (((substring(a.osm_ref from 2))::bigint - 1) / 2) END
   WHERE a.osm_ref ~ '^a[0-9]+$'
     AND t.missing_since IS NOT NULL
     AND a.missing_since IS NULL
     -- 🔴 The twin is taken whether or not the link exists YET.
     --
     -- The first version joined through spot_links, so a stamp could
     -- only be seen once its link was already there. But the link is
     -- made by this same run: the dry run then showed 23 operations, the
     -- apply made them, and 16 more appeared out of nowhere afterwards —
     -- a plan that is not a fixed point, so no dry run ever predicted
     -- the whole change and the prediction file had to be generated from
     -- the already-changed database to agree with it. Self-confirming,
     -- which is exactly what the comment further down forbids.
     --
     -- Asking the question about the TWIN rather than about the link
     -- makes the three kinds of work independent, and one dry run
     -- describes the whole run.
     AND NOT EXISTS (SELECT 1 FROM spot_links o
                      WHERE o.unlinked_at IS NULL
                        AND o.secondary_id = t.id
                        AND o.primary_id <> a.id)
     -- 🔴 And not a twin somebody deliberately UNLINKED from this area.
     -- Clearing its stamp would quietly undo half of that decision: the
     -- row would stop being "gone" while still not being folded.
     AND NOT EXISTS (SELECT 1 FROM spot_links u
                      WHERE u.primary_id = a.id AND u.secondary_id = t.id
                        AND u.unlinked_at IS NOT NULL)
   ORDER BY t.osm_ref`;

/**
 * Work this run deliberately will NOT do, and why.
 *
 * 🔴 Silence here is the failure mode. The script refuses a fold that
 * would leave a chain nobody can flatten — the right call — but the
 * first version refused it without a word, printed "0 outstanding", and
 * the next person would have had to rediscover the reasoning from an
 * empty output.
 */
export async function skipped(
  db: Client,
): Promise<{ name: string; why: string }[]> {
  // 🔴 Three states, one set of reasons.
  //
  // A review found the report saying "its chain stays" about a campsite
  // whose chain did not exist yet — the run was about to create it and
  // then refuse to undo it. The state and the reason are therefore
  // separate: the state comes from whether the area and its twin are
  // linked, undone, or neither, and the reason comes from the same
  // fragment the queries refuse by.
  const TWIN_JOIN = `
      JOIN camping_spots t ON t.osm_ref = CASE
             WHEN (substring(a.osm_ref from 2))::bigint % 2 = 0
             THEN 'w' || ((substring(a.osm_ref from 2))::bigint / 2)
             ELSE 'r' || (((substring(a.osm_ref from 2))::bigint - 1) / 2) END`;
  const r = await db.query<{ name: string; why: string }>(`
    SELECT DISTINCT coalesce(a.name, '(unnamed)') AS name,
           'its twin is left unfolded: folding it would make a chain ' ||
           'this run may not undo, because ' ||
           ${whyCannotMoveUpSql('a', 'below')} AS why
      FROM camping_spots a${TWIN_JOIN}
      JOIN spot_links below ON below.primary_id = t.id
                           AND below.unlinked_at IS NULL
     WHERE a.osm_ref ~ '^a[0-9]+$'
       AND NOT EXISTS (SELECT 1 FROM spot_links l
                        WHERE l.primary_id = a.id AND l.secondary_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM spot_links o
                        WHERE o.unlinked_at IS NULL AND o.secondary_id = t.id)
       AND ${cannotMoveUpSql('a', 'below')}
     UNION
    SELECT DISTINCT coalesce(a.name, '(unnamed)') AS name,
           'left alone: somebody took this campsite and its twin apart ' ||
           'by hand' AS why
      FROM camping_spots a${TWIN_JOIN}
     WHERE a.osm_ref ~ '^a[0-9]+$'
       AND EXISTS (SELECT 1 FROM spot_links h
                    WHERE h.primary_id = a.id AND h.secondary_id = t.id
                      AND h.unlinked_at IS NOT NULL)
     UNION
    SELECT DISTINCT coalesce(a.name, '(unnamed)') AS name,
           'its chain stays: the record under its twin cannot be moved ' ||
           'up, because ' || ${whyCannotMoveUpSql('a', 'below')} AS why
      FROM camping_spots a${TWIN_JOIN}
      JOIN spot_links above ON above.primary_id = a.id
                           AND above.secondary_id = t.id
                           AND above.unlinked_at IS NULL
      JOIN spot_links below ON below.primary_id = t.id
                           AND below.unlinked_at IS NULL
     WHERE a.osm_ref ~ '^a[0-9]+$'
       AND ${cannotMoveUpSql('a', 'below')}`);
  return r.rows;
}

export async function plan(db: Client): Promise<Fold[]> {
  const folds: Fold[] = [];
  const twins = await db.query<{
    area_id: string;
    area_ref: string;
    name: string;
    twin_id: string;
    twin_ref: string;
  }>(UNFOLDED_TWINS_SQL);
  for (const r of twins.rows) {
    if (!isTwinOf(r.area_ref, r.twin_ref)) continue;
    folds.push({
      kind: 'link',
      primary: r.area_id,
      secondary: r.twin_id,
      name: r.name,
    });
  }
  const chains = await db.query<{
    link_id: string;
    from_id: string;
    to_id: string;
    name: string;
    top_ref: string;
    mid_ref: string;
  }>(CHAINS_SQL);
  for (const r of chains.rows) {
    // Only a chain whose middle row is the top's own OSM twin. Anything
    // else is a shape this card did not measure and must not move.
    if (!isTwinOf(r.top_ref, r.mid_ref)) continue;
    folds.push({
      kind: 'repoint',
      link: r.link_id,
      from: r.from_id,
      to: r.to_id,
      name: r.name,
    });
  }
  const stamped = await db.query<{
    row_id: string;
    ref: string;
    area_ref: string;
    name: string;
  }>(STAMPED_FOR_WANT_OF_A_LINK_SQL);
  for (const r of stamped.rows) {
    if (!isTwinOf(r.area_ref, r.ref)) continue;
    folds.push({ kind: 'unmark', row: r.row_id, ref: r.ref, name: r.name });
  }
  return folds;
}

/**
 * Write the plan. Caller owns the transaction, so a probe can apply it
 * inside one it means to roll back.
 */
export async function applyFolds(db: Client, folds: Fold[]): Promise<void> {
  // 🔴 Refuse to write outside a transaction. The comment above says the
  // caller owns it; a comment is not a guarantee, and half of this
  // applied is a database in the state this card calls dangerous.
  //
  // 🔴 SAVEPOINT, not pg_current_xact_id_if_assigned(). The first guard
  // asked for a transaction ID — and Postgres assigns one only once the
  // transaction has WRITTEN something. The real path is plan() (all
  // reads), then BEGIN, then this: no writes yet, no id, so the guard
  // threw on every single --apply. It passed every rehearsal because
  // each of those clones rows first, which assigns the id. The one
  // shape that broke it was the one no rehearsal built.
  //
  // SAVEPOINT answers the question actually being asked: outside a
  // transaction block Postgres raises 25P01, inside one it is free.
  await db.query('SAVEPOINT fold_in_transaction');
  await db.query('RELEASE SAVEPOINT fold_in_transaction');
  for (const f of folds) {
    if (f.kind === 'link') {
      await db.query(
        `INSERT INTO spot_links (primary_id, secondary_id, metres,
                                 name_similarity, rule)
         SELECT $1, $2,
                round(ST_Distance(a.location::geography,
                                  t.location::geography)),
                1, 'osm-area-id'
           FROM camping_spots a, camping_spots t
          WHERE a.id = $1 AND t.id = $2`,
        [f.primary, f.secondary],
      );
    } else if (f.kind === 'repoint') {
      await db.query(
        `UPDATE spot_links SET primary_id = $2
          WHERE id = $1 AND unlinked_at IS NULL`,
        [f.link, f.to],
      );
    } else {
      await db.query(
        `UPDATE camping_spots SET missing_since = NULL WHERE id = $1`,
        [f.row],
      );
    }
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const predictAt = process.argv.indexOf('--predict');
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const folds = await plan(db);
    const links = folds.filter((f) => f.kind === 'link');
    const repoints = folds.filter((f) => f.kind === 'repoint');
    console.log(
      `${links.length} twin(s) to fold, ${repoints.length} chain(s) to ` +
        `flatten, ${folds.filter((f) => f.kind === 'unmark').length} ` +
        `stamp(s) to clear\n`,
    );
    for (const f of folds) {
      console.log(
        f.kind === 'link'
          ? `  fold    ${f.name}`
          : f.kind === 'repoint'
            ? `  flatten ${f.name}`
            : `  unmark  ${f.name} (${f.ref})`,
      );
    }
    // 🔴 A prediction is WRITTEN on a dry run and READ on an apply —
    // never written on an apply. The first version wrote it both times,
    // so the apply compared the plan against a file it had just produced
    // from that same plan: a check that cannot disagree with itself.
    const predictFile =
      predictAt > -1 ? (process.argv[predictAt + 1] ?? null) : null;
    const skips = await skipped(db);
    if (skips.length > 0) {
      console.log(`\n${skips.length} left alone on purpose:`);
      for (const sk of skips) console.log(`  — ${sk.name}: ${sk.why}`);
    }
    if (predictFile && !apply) {
      writeFileSync(predictFile, folds.map(foldKey).sort().join('\n') + '\n');
      console.log(`\nprediction written: ${folds.length} line(s)`);
    }
    if (!apply) {
      console.log('\n(dry run — nothing written. Pass --apply.)');
      return;
    }
    if (predictFile) {
      const predicted = readFileSync(predictFile, 'utf8')
        .split('\n')
        .filter(Boolean);
      const planned = folds.map(foldKey).sort();
      const missing = predicted.filter((k) => !planned.includes(k));
      const extra = planned.filter((k) => !predicted.includes(k));
      if (missing.length > 0 || extra.length > 0) {
        console.error(
          `\n✗ the plan no longer matches the prediction: ` +
            `${missing.length} gone, ${extra.length} new`,
        );
        for (const k of [...missing, ...extra].slice(0, 10)) {
          console.error(`    ${k}`);
        }
        process.exit(1);
      }
      console.log(
        `\nplan matches the prediction element for element: ${planned.length}`,
      );
    }

    await db.query('BEGIN');
    try {
      await applyFolds(db, folds);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    // 🔴 What the database ACCEPTED, compared element by element with
    // what was predicted — not counted. A count matching while the rows
    // differ is the failure this check exists for.
    const after = await plan(db);
    const left = after.map(foldKey).sort();
    if (left.length > 0) {
      console.error(
        `\n✗ ${left.length} fold(s) still outstanding after apply:`,
      );
      for (const k of left.slice(0, 10)) console.error(`    ${k}`);
      process.exit(1);
    }
    console.log(`\n✓ applied ${folds.length}, 0 outstanding`);
  } finally {
    await db.end();
  }
}

function selfTest(): void {
  const cases: [string, string | null, boolean][] = [
    ['a123878272', 'w61939136', true],
    ['a123878272', 'w61939137', false],
    ['a53954015', 'r26977007', true],
    ['a53954015', 'w26977007', false],
    ['a53954014', 'w26977007', true],
    ['w123', 'w61', false],
    ['a123878272', null, false],
  ];
  let bad = 0;
  for (const [area, other, want] of cases) {
    const got = isTwinOf(area, other);
    if (got !== want) {
      console.error(`  ✗ ${area} ↔ ${other}: expected ${want}, got ${got}`);
      bad++;
    }
  }
  console.log(
    bad === 0
      ? `✓ ${cases.length}/${cases.length} twin cases`
      : `✗ ${bad} of ${cases.length} twin cases failed`,
  );
  if (bad > 0) process.exit(1);
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    main().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
