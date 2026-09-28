// CAMP-144: join the rows that two sources wrote about one campsite.
//
//   npx ts-node src/spots/reconcile-sources.ts            # dry run
//   npx ts-node src/spots/reconcile-sources.ts --apply
//   npx ts-node src/spots/reconcile-sources.ts --sample 40 # for hand-checking
//
// 🔴 WHY THIS EXISTS, AND IT IS NOT "WE NEVER RECONCILE".
//
// We do. CAMP-101 built a matcher — `decide()` in datatourisme/match.ts —
// measured against 2 068 French records and deliberately biased towards
// leaving rows apart. It works. It was simply never asked about the rows
// that were already in the table.
//
// The DATAtourisme importer matches an incoming record against what the
// database holds AT THAT MOMENT. Measured 28.09.2026 against the live
// table:
//
//     all 8 752 DATAtourisme rows created  2026-09-24 12:00
//     all 14 900 French OSM rows created   2026-09-24 20:00
//     rows carrying both sources                        0
//
// France was imported from DATAtourisme into a table that held no French
// OSM rows yet, and OSM landed on top eight hours later. The matcher had
// nothing to match against, and nothing has asked it since. The import
// order defeated it, not the rule.
//
// So the missing piece is not a matcher. It is a pass that applies the
// existing matcher to rows ALREADY in the table, and that can be run
// again after every import instead of once.
//
// 🔴 THE SAME RULE, NOT A SECOND ONE.
//
// This imports `decide` and `RULES` from datatourisme/match.ts unchanged.
// Inventing a looser rule here — the card's "identical name within
// 100 m" is looser, it has no similarity floor and no guard against a
// name made only of generic words — would mean two parts of the codebase
// disagreeing about what "the same campsite" means, and the wrong one
// winning depending on which ran last.
//
// 🔴 IT WRITES ONLY TO spot_links. It never UPDATEs or DELETEs a
// campsite. Both rows survive intact, each source keeps writing to its
// own row, and the reader-side join in spots.service.ts is what makes
// them one page. That is why no import has to know this exists.

import 'dotenv/config';
import { Client } from 'pg';
import { decide, RULES } from '../datatourisme/match';
import type { Candidate } from '../datatourisme/match';
import {
  identityDomains,
  judgeByIdentity,
  upperBoundPercent,
} from './link-evidence';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/** How this run's rule is recorded on every link it writes. */
export const RULE_ID = `decide@${RULES.sameSpotMetres}m/${RULES.confidentSimilarity}`;

/**
 * The degrees to pre-filter by before the exact metric test.
 *
 * 🔴 Wider than it looks like it needs to be, on purpose. A degree of
 * longitude shrinks with the cosine of the latitude: 400 m east-west is
 * 0.0054° at 48°N but 0.0110° at 71°N, the top of Finland. A 0.01° box
 * would quietly become the real radius in Lapland and this pass would
 * report "nothing to link there" — the same shape of bug as the 0.1°
 * bounding box in the DATAtourisme importer, which measured 7.4 km where
 * it read as 11 km. 0.02° is wider than 400 m everywhere in the EU-27.
 */
const BOX_DEGREES = 0.02;

export type SpotRow = {
  id: string;
  osm_ref: string | null;
  name: string | null;
  lat: number;
  lon: number;
  slug: string;
  country: string;
  stars: number | null;
  has_contact: boolean;
  /**
   * The best website this row publishes, from either place it can live.
   *
   * 🔴 Both places, because the two sources use different ones: OSM's
   * lands in `contact.website` (CAMP-141) and DATAtourisme's in the
   * `website` column (CAMP-101), deliberately kept apart. Reading only
   * one column would find a website on one side of every pair and none
   * on the other, and the error check would have nothing to judge — it
   * would print "0 pairs disagree" and mean "I looked in the wrong
   * column".
   */
  website: string | null;
  /** OSM's `contact:email`. A second, independent way a row names itself. */
  email: string | null;
  has_description: boolean;
};

export type PairRow = { a: SpotRow; b: SpotRow; metres: number };

/**
 * Candidate pairs: one OSM row, one row from another source, close enough
 * that the matcher could conceivably say yes.
 *
 * 🔴 `osm_ref IS NULL` on exactly one side, which defers the 24 OSM↔OSM
 * pairs on purpose — see the header of `deferredSameSourcePairs`.
 *
 * The distance test is ST_DistanceSphere on the geometry rather than a
 * cast to geography, because the only spatial index on the table is on
 * the geometry; a geography cast would drop it and turn 0.3 s into a
 * sequential self-join over 61 558 rows.
 */
export const CANDIDATE_SQL = `
  SELECT a.id            AS a_id,
         a.osm_ref       AS a_osm_ref,
         a.name          AS a_name,
         ST_Y(a.location) AS a_lat,
         ST_X(a.location) AS a_lon,
         a.slug          AS a_slug,
         a.country       AS a_country,
         a.stars         AS a_stars,
         (a.contact <> '{}'::jsonb) AS a_has_contact,
         coalesce(a.contact->>'website', a.website) AS a_website,
         a.contact->>'email' AS a_email,
         (a.description IS NOT NULL) AS a_has_description,
         b.id            AS b_id,
         b.osm_ref       AS b_osm_ref,
         b.name          AS b_name,
         ST_Y(b.location) AS b_lat,
         ST_X(b.location) AS b_lon,
         b.slug          AS b_slug,
         b.country       AS b_country,
         b.stars         AS b_stars,
         (b.contact <> '{}'::jsonb) AS b_has_contact,
         coalesce(b.contact->>'website', b.website) AS b_website,
         b.contact->>'email' AS b_email,
         (b.description IS NOT NULL) AS b_has_description,
         round(ST_DistanceSphere(a.location, b.location))::int AS metres
    FROM camping_spots a
    JOIN camping_spots b
      ON a.id < b.id
     AND ST_DWithin(a.location, b.location, $1::float8)
     AND ST_DistanceSphere(a.location, b.location) <= $2::float8
   WHERE (a.osm_ref IS NULL) <> (b.osm_ref IS NULL)
     -- 🔴 A link to a row that is not on the site is not worth making,
     -- and worse than useless: it would hide a perfectly good record
     -- behind a page that does not exist. The OSM side must have a URL
     -- (a region) and must still be in OSM. Measured 24.09.2026: 135
     -- rows carry no region at all.
     --
     -- The read side tolerates a primary that becomes unpublishable
     -- LATER — the secondary simply un-hides. This stops us creating
     -- that state on purpose.
     AND (a.osm_ref IS NULL OR (a.region IS NOT NULL AND a.missing_since IS NULL))
     AND (b.osm_ref IS NULL OR (b.region IS NOT NULL AND b.missing_since IS NULL))
   -- 🔴 Ordered, because the review pile is printed and worked through
   -- by a person. The chosen LINKS were already stable — the tie-break
   -- in proposeLinks is a total order, and a pairwise maximum over one
   -- does not depend on visiting order — but the losers are appended in
   -- whatever sequence the rows arrived, so "left for a human (first
   -- 15)" showed a different fifteen on every run over identical data.
   ORDER BY a.id, b.id`;

type RawPair = Record<string, unknown>;

function side(r: RawPair, p: 'a' | 'b'): SpotRow {
  return {
    id: String(r[`${p}_id`]),
    osm_ref: (r[`${p}_osm_ref`] as string | null) ?? null,
    name: (r[`${p}_name`] as string | null) ?? null,
    lat: Number(r[`${p}_lat`]),
    lon: Number(r[`${p}_lon`]),
    slug: String(r[`${p}_slug`]),
    country: String(r[`${p}_country`]),
    stars: r[`${p}_stars`] === null ? null : Number(r[`${p}_stars`]),
    has_contact: r[`${p}_has_contact`] === true,
    website: (r[`${p}_website`] as string | null) ?? null,
    email: (r[`${p}_email`] as string | null) ?? null,
    has_description: r[`${p}_has_description`] === true,
  };
}

export type Proposal = {
  primary: SpotRow;
  secondary: SpotRow;
  metres: number;
  similarity: number;
  why: string;
};

export type Outcome = {
  link: Proposal[];
  review: (Proposal & { why: string })[];
  apart: number;
  /** Pairs skipped because spot_links already holds a verdict for them. */
  alreadyJudged: number;
};

/**
 * Apply the matcher to every candidate, grouped the way the importer
 * groups it: one non-OSM row against all the OSM rows near it.
 *
 * 🔴 Grouped, not pair-by-pair. `decide` exists to choose BETWEEN
 * candidates; asked about each pair separately it would happily call two
 * different OSM rows "the same campsite" as this one, and we would link
 * a row to two primaries. The unique index on `secondary_id` would then
 * reject the second write at 3 a.m. in the middle of a run, which is a
 * worse way to find out.
 */
export function proposeLinks(
  pairs: PairRow[],
  judged: Set<string>,
  /**
   * Primaries that a LIVE link already claims, from the table.
   *
   * 🔴 Without this the collision rule is blind after the first
   * `--apply`. A pair already in `judged` is skipped before it can claim
   * its primary, so a second record matching that same campsite finds no
   * rival, is proposed, and the INSERT hits the unique index. The
   * savepoint stops the crash, but the record is then reported as
   * "refused by the database" — an error-shaped line — instead of going
   * to the review pile the new rule says it belongs in, and it does so
   * again on every run for ever.
   */
  claimedAlready: Set<string> = new Set(),
): Outcome {
  const byNonOsm = new Map<string, { row: SpotRow; cands: SpotRow[] }>();
  for (const p of pairs) {
    const osm = p.a.osm_ref ? p.a : p.b;
    const other = p.a.osm_ref ? p.b : p.a;
    const e = byNonOsm.get(other.id) ?? { row: other, cands: [] };
    e.cands.push(osm);
    byNonOsm.set(other.id, e);
  }

  const out: Outcome = { link: [], review: [], apart: 0, alreadyJudged: 0 };
  /**
   * Which OSM row each proposed link has claimed.
   *
   * 🔴 Grouping by the non-OSM row answers "which campsite is this
   * record?", and answers it once per record — so two DATAtourisme rows
   * beside one OSM campsite can each name that campsite and BOTH links
   * get proposed. `idx_spot_links_primary_live` now refuses the second,
   * which turns a silent wrong answer into a crash mid-run; refusing it
   * here instead turns it into the review pile, where it belongs.
   *
   * DATAtourisme listing a campsite and its motorhome pitch separately
   * is the ordinary way in — the importer already met that pair 21 m
   * apart. Only a person can say which of the two is the campsite.
   */
  const claimed = new Map<string, Proposal>();

  for (const { row, cands } of byNonOsm.values()) {
    const candidates: Candidate[] = cands.map((c) => ({
      id: c.id,
      name: c.name,
      lat: c.lat,
      lon: c.lon,
    }));
    const d = decide(
      { name: row.name ?? '', lat: row.lat, lon: row.lon },
      candidates,
    );
    if (d.verdict === 'new') {
      out.apart++;
      continue;
    }
    const primary = cands.find((c) => c.id === d.id);
    if (!primary) {
      out.apart++;
      continue;
    }
    // 🔴 A pair this table has already judged is left alone, INCLUDING a
    // link a person has undone. Re-proposing it would mean the reconciler
    // quietly overrules the human every time it runs, which makes the
    // undo useless — the "reversible" in the card's requirements means
    // reversible for good, not until Monday.
    if (judged.has(`${primary.id}|${row.id}`)) {
      out.alreadyJudged++;
      continue;
    }
    const proposal: Proposal = {
      primary,
      secondary: row,
      metres: d.metres,
      similarity: d.similarity,
      why: d.why,
    };
    if (d.verdict !== 'same') {
      out.review.push(proposal);
      continue;
    }

    // A campsite the table already links to somebody else. Not an error
    // and not a link — a question for a person.
    if (claimedAlready.has(primary.id)) {
      out.review.push({
        ...proposal,
        why: 'this campsite is already linked to another record',
      });
      continue;
    }

    const rival = claimed.get(primary.id);
    if (!rival) {
      claimed.set(primary.id, proposal);
      out.link.push(proposal);
      continue;
    }
    // Two records want the same campsite. Keep the closer one — and if
    // the distance ties, the more similar name, and if that ties too the
    // lower id, so the same input always gives the same answer.
    const better =
      proposal.metres !== rival.metres
        ? proposal.metres < rival.metres
        : proposal.similarity !== rival.similarity
          ? proposal.similarity > rival.similarity
          : proposal.secondary.id < rival.secondary.id;
    const winner = better ? proposal : rival;
    const loser = better ? rival : proposal;
    claimed.set(primary.id, winner);
    out.link[out.link.indexOf(rival)] = winner;
    out.review.push({
      ...loser,
      why: `another record ${loser.metres} m away also matched this campsite`,
    });
  }
  return out;
}

/** What a reader gains from a link: does one side hold what the other lacks? */
export function complements(p: Proposal): {
  gains: boolean;
  bothContactAndStars: boolean;
} {
  const contactA = p.primary.has_contact || !!p.primary.website;
  const contactB = p.secondary.has_contact || !!p.secondary.website;
  const starsA = p.primary.stars !== null;
  const starsB = p.secondary.stars !== null;
  return {
    gains:
      contactA !== contactB ||
      starsA !== starsB ||
      p.primary.has_description !== p.secondary.has_description ||
      !p.primary.name !== !p.secondary.name,
    bothContactAndStars: (contactA || contactB) && (starsA || starsB),
  };
}

/**
 * The OSM↔OSM pairs, counted by the same rule and left alone — a
 * decision, not an oversight.
 *
 * They are a different problem with a different fix. Two OSM rows for one
 * campsite means one object is mapped twice in OpenStreetMap: both rows
 * come from the same tags through the same mapping, so neither holds a
 * fact the other lacks and joining them would gain a reader nothing —
 * it would only remove a pin. The honest repair is upstream in OSM,
 * where it also fixes the map for everybody else; a link here would
 * paper over it and make the upstream fix invisible to us.
 *
 * 🔴 Counted with `decide`, not with a bare distance test. A plain
 * "two OSM rows within 100 m" count answers a different question and
 * comes out at 10 525 — two adjacent but genuinely separate campsites
 * are common. Reporting that number as "the deferred duplicates" would
 * overstate the deferral by two orders of magnitude, which is the same
 * kind of mistake as counting every name that starts with "Camping".
 */
export const SAME_SOURCE_CANDIDATE_SQL = `
  SELECT a.id AS a_id, a.name AS a_name,
         ST_Y(a.location) AS a_lat, ST_X(a.location) AS a_lon,
         b.id AS b_id, b.name AS b_name,
         ST_Y(b.location) AS b_lat, ST_X(b.location) AS b_lon
    FROM camping_spots a
    JOIN camping_spots b
      ON a.id < b.id
     AND ST_DWithin(a.location, b.location, $1::float8)
     AND ST_DistanceSphere(a.location, b.location) <= $2::float8
   WHERE a.osm_ref IS NOT NULL AND b.osm_ref IS NOT NULL`;

/** How many same-source pairs this same rule would call one campsite. */
export function countSameSource(
  rows: {
    a_id: string;
    a_name: string | null;
    a_lat: number;
    a_lon: number;
    b_id: string;
    b_name: string | null;
    b_lat: number;
    b_lon: number;
  }[],
): number {
  const grouped = new Map<
    string,
    { name: string | null; lat: number; lon: number; cands: Candidate[] }
  >();
  for (const r of rows) {
    const e = grouped.get(r.a_id) ?? {
      name: r.a_name,
      lat: Number(r.a_lat),
      lon: Number(r.a_lon),
      cands: [],
    };
    e.cands.push({
      id: r.b_id,
      name: r.b_name,
      lat: Number(r.b_lat),
      lon: Number(r.b_lon),
    });
    grouped.set(r.a_id, e);
  }
  let n = 0;
  for (const e of grouped.values()) {
    const d = decide({ name: e.name ?? '', lat: e.lat, lon: e.lon }, e.cands);
    if (d.verdict === 'same') n++;
  }
  return n;
}

// ---------------------------------------------------------------------

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sampleAt = process.argv.indexOf('--sample');
  const sampleSize = sampleAt >= 0 ? Number(process.argv[sampleAt + 1]) : 0;

  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  try {
    const t0 = Date.now();
    const res = await db.query<RawPair>(CANDIDATE_SQL, [
      BOX_DEGREES,
      RULES.maxMetres,
    ]);
    const pairs: PairRow[] = res.rows.map((r) => ({
      a: side(r, 'a'),
      b: side(r, 'b'),
      metres: Number(r.metres),
    }));
    console.log(
      `${pairs.length} cross-source pairs within ${RULES.maxMetres} m ` +
        `(${Date.now() - t0} ms)`,
    );

    const judgedRows = await db.query<{ k: string }>(
      `SELECT primary_id || '|' || secondary_id AS k FROM spot_links`,
    );
    const judged = new Set<string>(judgedRows.rows.map((r) => r.k));
    const claimedRows = await db.query<{ id: string }>(
      `SELECT primary_id AS id FROM spot_links WHERE unlinked_at IS NULL`,
    );
    const claimedAlready = new Set<string>(claimedRows.rows.map((r) => r.id));
    const out = proposeLinks(pairs, judged, claimedAlready);

    let gains = 0;
    let both = 0;
    for (const p of out.link) {
      const c = complements(p);
      if (c.gains) gains++;
      if (c.bothContactAndStars) both++;
    }

    console.log('');
    console.log(`  link (same name, same place)   ${out.link.length}`);
    console.log(`  leave for a human to look at   ${out.review.length}`);
    console.log(`  different campsites            ${out.apart}`);
    console.log(`  already judged, left alone     ${out.alreadyJudged}`);
    console.log('');
    console.log(
      `  of the links: one side holds what the other lacks  ${gains}`,
    );
    console.log(`  of the links: together give contact AND stars      ${both}`);

    // 🔴 A dry run states its own expected error rate before anybody
    // decides to write 3 000 rows. Judged on the website, which the rule
    // never reads — see link-evidence.ts.
    const asPair = (p: Proposal) => ({
      aWebsite: p.primary.website,
      aEmail: p.primary.email,
      bWebsite: p.secondary.website,
      bEmail: p.secondary.email,
    });
    const ev = judgeByIdentity(out.link.map(asPair));
    const bound = upperBoundPercent(ev);
    console.log('');
    console.log(
      `  both sides name themselves          ${ev.agree + ev.disagree}`,
    );
    console.log(`  same domain (independent yes)       ${ev.agree}`);
    console.log(`  different domain (needs a look)     ${ev.disagree}`);
    console.log(`  one side names nobody               ${ev.noEvidence}`);
    console.log(
      bound === null
        ? '  → nothing judgeable: no upper bound can be stated'
        : `  → upper bound on the wrong-link rate ${bound.toFixed(1)}%`,
    );

    // 🔴 The rule's loosest corner, measured separately. If the far end
    // of the 150 m radius were where the rule breaks, the disagreement
    // rate would climb with distance. Printing it per band is what turns
    // "150 m feels right" into something that can be shown to be wrong.
    console.log("\n  disagreement by distance, the rule's loosest corner:");
    // 🔴 The last band is INCLUSIVE, and that is not a detail.
    //
    // With `< 150` the six links that round to exactly 150 m fell into no
    // band at all — the table summed to 2 980 of 2 986 — and they are the
    // loosest links in the set. The argument this table makes is "if the
    // rule broke at its far edge, disagreement would climb with
    // distance", and it was being made with the far edge deleted. The
    // assertion below is what stops that returning.
    let banded = 0;
    for (const [lo, hi] of [
      [0, 25],
      [25, 50],
      [50, 100],
      [100, RULES.sameSpotMetres],
    ] as [number, number][]) {
      const last = hi === RULES.sameSpotMetres;
      const band = out.link.filter(
        (p) => p.metres >= lo && (last ? p.metres <= hi : p.metres < hi),
      );
      banded += band.length;
      const e = judgeByIdentity(band.map(asPair));
      const b = upperBoundPercent(e);
      console.log(
        `    ${String(lo).padStart(3)}–${String(hi).padStart(3)} m  ` +
          `${String(band.length).padStart(5)} links  ` +
          `${String(e.agree + e.disagree).padStart(5)} judgeable  ` +
          `${b === null ? '   —' : b.toFixed(1).padStart(5) + '%'}`,
      );
    }
    if (banded !== out.link.length) {
      throw new Error(
        `the distance bands cover ${banded} of ${out.link.length} links — ` +
          'a band boundary is dropping exactly the links this table exists ' +
          'to defend',
      );
    }

    const evReview = judgeByIdentity(out.review.map(asPair));
    const boundReview = upperBoundPercent(evReview);
    console.log(
      `  (the same measure over the pairs we DECLINED to link: ` +
        `${boundReview === null ? 'nothing judgeable' : boundReview.toFixed(1) + '%'})`,
    );

    const sameSource = await db.query(SAME_SOURCE_CANDIDATE_SQL, [
      BOX_DEGREES,
      RULES.maxMetres,
    ]);
    console.log(
      `\n  OSM↔OSM pairs the same rule would link, deferred on purpose   ` +
        `${countSameSource(sameSource.rows as never)}`,
    );

    if (sampleSize > 0) {
      // 🔴 Deterministic, evenly spread, and it prints coordinates — the
      // point is that somebody can open these on a map and disagree.
      const step = Math.max(1, Math.floor(out.link.length / sampleSize));
      console.log(
        '\n--- sample for hand-checking (open the coordinates on a map) ---',
      );
      console.log(
        'metres\tsim\tosm_ref\tOSM name\tother name\tlat,lon (OSM)\tlat,lon (other)',
      );
      for (let i = 0; i < out.link.length && i / step < sampleSize; i += step) {
        const p = out.link[i];
        console.log(
          [
            p.metres,
            p.similarity,
            p.primary.osm_ref,
            p.primary.name,
            p.secondary.name,
            `${p.primary.lat.toFixed(6)},${p.primary.lon.toFixed(6)}`,
            `${p.secondary.lat.toFixed(6)},${p.secondary.lon.toFixed(6)}`,
          ].join('\t'),
        );
      }
    }

    // 🔴 The disagreements are printed, not counted. They are the list a
    // person actually works through: every one is either a wrong link to
    // undo or a campsite whose two sources point at different websites,
    // and only reading them tells you which.
    if (process.argv.includes('--disagreements')) {
      console.log('\n--- links whose two sources name different domains ---');
      for (const p of out.link) {
        const a = identityDomains({
          website: p.primary.website,
          email: p.primary.email,
        });
        const b = identityDomains({
          website: p.secondary.website,
          email: p.secondary.email,
        });
        if (a.size === 0 || b.size === 0) continue;
        if ([...a].some((d) => b.has(d))) continue;
        console.log(
          `  ${String(p.metres).padStart(4)} m  ${[...a].join(',').padEnd(34)} ` +
            `${[...b].join(',').padEnd(34)} | ${p.primary.name} || ${p.secondary.name}`,
        );
      }
    }

    if (out.review.length > 0) {
      console.log('\n--- left for a human (first 15) ---');
      for (const p of out.review.slice(0, 15)) {
        console.log(
          `  ${String(p.primary.name).padEnd(38).slice(0, 38)} | ` +
            `${String(p.secondary.name).padEnd(38).slice(0, 38)} | ` +
            `${String(p.metres).padStart(4)} m | sim ${p.similarity} | ${p.why}`,
        );
      }
      if (out.review.length > 15) {
        console.log(`  … and ${out.review.length - 15} more`);
      }
    }

    if (!apply) {
      console.log('\n(dry run — nothing written. Add --apply to write.)');
      return;
    }

    await db.query('BEGIN');
    let written = 0;
    const refused: string[] = [];
    for (const p of out.link) {
      // 🔴 A SAVEPOINT per row, because ON CONFLICT covers ONE index and
      // this table has three.
      //
      // `ON CONFLICT (primary_id, secondary_id)` catches a pair we have
      // already judged. It does NOT catch a row that collides with the
      // partial unique index on `secondary_id` or on `primary_id` — for
      // example a link a person made by hand between the same rows in
      // the other direction. Without a savepoint that one row aborts the
      // transaction and all ~3 000 writes roll back, AFTER the run has
      // printed a confident summary. Measured cost of the savepoint on
      // 2 986 rows: under a second.
      await db.query('SAVEPOINT one_link');
      try {
        const r = await db.query(
          `INSERT INTO spot_links
             (primary_id, secondary_id, metres, name_similarity, rule)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (primary_id, secondary_id) DO NOTHING`,
          [p.primary.id, p.secondary.id, p.metres, p.similarity, RULE_ID],
        );
        written += r.rowCount ?? 0;
        await db.query('RELEASE SAVEPOINT one_link');
      } catch (err) {
        await db.query('ROLLBACK TO SAVEPOINT one_link');
        refused.push(
          `${p.primary.osm_ref ?? p.primary.id} ↔ ${p.secondary.slug}: ` +
            `${(err as Error).message}`,
        );
      }
    }
    await db.query('COMMIT');
    console.log(`\n✓ ${written} links written. No campsite row was touched.`);
    // 🔴 Named, not counted. Every one of these is a row the database
    // already holds an opinion about, and a number would not say whose.
    if (refused.length > 0) {
      console.log(`\n⚠ ${refused.length} refused by the database:`);
      for (const r of refused.slice(0, 20)) console.log(`    ${r}`);
      if (refused.length > 20) {
        console.log(`    … and ${refused.length - 20} more`);
      }
    }
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
