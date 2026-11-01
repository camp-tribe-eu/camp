// Рішення 28.10.2026: `reconcile-sources --apply` без нагляду пише лише
// пари, де назва, відстань І домен кажуть «один кемпінг». Цей скрипт
// доводить це на рядках, які сам садить і сам відкочує.
//
//   npx ts-node src/spots/verify-reconcile-threshold.ts
//
// 🔴 ЧОМУ ЦЕ НЕ В reconcile-sources.spec.ts.
//
// Спека тримає функції: поділ за доменом і записувача на фальшивому
// клієнті. Вона не бачить половини, яку бачить лише база: що кандидатний
// SQL узагалі знаходить посаджену пару, що рядок у spot_links справді
// ховає дубль через читальний JOIN, що один UPDATE `unlinked_at` справді
// повертає його, і що camping_spots за весь цей час не змінився ні на
// байт. Це і є «оборотне злиття зі слідом» — як властивість бази, а не
// як слово в коментарі.
//
// Три групи по дві садяться в Атлантиці за 2 км одна від одної, щоб
// жоден справжній кемпінг не потрапив у 400-метрове вікно:
//
//   Alpha  — та сама назва, 71 м, ОДИН домен     → пишеться
//   Beta   — та сама назва, 71 м, РІЗНІ домени   → ні, і не позначається
//   Gamma  — та сама назва, 71 м, один бік мовчить → ні, і не позначається
//
// Усе всередині BEGIN … ROLLBACK, тож на порожній CI-фікстурі це
// доводить те саме, що на копії прода, і нічого по собі не лишає.
//
// Ненульовий код виходу на будь-якому провалі, щоб CI це бачив.

import 'dotenv/config';
import { Client } from 'pg';
import { RULES } from '../datatourisme/match';
import { notSecondarySql } from './links';
import {
  BOX_DEGREES,
  CANDIDATE_SQL,
  RULE_ID,
  proposeLinks,
  splitByIdentity,
  writeLinks,
} from './reconcile-sources';
import type { PairRow, SpotRow } from './reconcile-sources';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/** Metres east of a longitude, at this latitude. */
const LAT = 40.0;
const east = (lon: number, m: number) =>
  lon + m / (111_320 * Math.cos((LAT * Math.PI) / 180));

type Planted = {
  slug: string;
  osmRef: string | null;
  name: string;
  lon: number;
  /** OSM keeps its website in contact.website, DATAtourisme in the column. */
  website: string | null;
};

/**
 * A campsite row cloned from an existing one — so this keeps working when
 * a column is added — then given the identity this rehearsal needs.
 */
async function plant(db: Client, seed: string, p: Planted): Promise<string> {
  await db.query(`DROP TABLE IF EXISTS thr_src`);
  await db.query(
    `CREATE TEMP TABLE thr_src AS SELECT * FROM camping_spots WHERE id = $1`,
    [seed],
  );
  const isOsm = p.osmRef !== null;
  await db.query(
    `UPDATE thr_src
        SET id = uuid_generate_v4(),
            slug = $1, osm_ref = $2, name = $3,
            location = ST_SetSRID(ST_MakePoint($4, $5), 4326),
            region = coalesce(region, 'Rehearsal'),
            missing_since = NULL,
            contact = CASE WHEN $6::boolean AND $7::text IS NOT NULL
                           THEN jsonb_build_object('website', $7::text)
                           ELSE '{}'::jsonb END,
            website = CASE WHEN $6::boolean THEN NULL ELSE $7::text END,
            -- A row with no osm_ref may carry no OSM record metadata
            -- (camping_spots_osm_record_origin_check), and an outline is
            -- tied to the old location. The seed row may hold either.
            osm_record_edited_at = NULL, osm_record_version = NULL,
            osm_record_ref = NULL, outline = NULL`,
    [p.slug, p.osmRef, p.name, p.lon, LAT, isOsm, p.website],
  );
  const r = await db.query<{ id: string }>(
    `INSERT INTO camping_spots SELECT * FROM thr_src RETURNING id`,
  );
  return r.rows[0].id;
}

function side(r: Record<string, unknown>, p: 'a' | 'b'): SpotRow {
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

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  let failed = 0;
  const check = (ok: boolean, what: string) => {
    console.log(`  ${ok ? '✓' : '✗'} ${what}`);
    if (!ok) failed++;
  };

  try {
    const seedRow = await db.query<{ id: string }>(
      `SELECT id FROM camping_spots ORDER BY id LIMIT 1`,
    );
    const seed = seedRow.rows[0]?.id;
    if (!seed) {
      console.error('✗ no campsite to clone from');
      process.exit(1);
    }

    await db.query('BEGIN');
    try {
      // Three groups, 2 km apart, in the Atlantic off Portugal.
      const lon0 = -12.0;
      const km = (n: number) => east(lon0, n * 1000);
      const alphaOsm = await plant(db, seed, {
        slug: 'thr-alpha-osm',
        osmRef: 'w900000001',
        name: 'Camping Verif Alpha',
        lon: km(0),
        website: 'https://www.camping-verif-alpha.fr/',
      });
      const alphaDt = await plant(db, seed, {
        slug: 'thr-alpha-dt',
        osmRef: null,
        name: 'Verif Alpha',
        lon: east(km(0), 71),
        website: 'camping-verif-alpha.fr/tarifs',
      });
      const betaOsm = await plant(db, seed, {
        slug: 'thr-beta-osm',
        osmRef: 'w900000002',
        name: 'Camping Verif Beta',
        lon: km(2),
        website: 'https://camping-verif-beta.fr',
      });
      const betaDt = await plant(db, seed, {
        slug: 'thr-beta-dt',
        osmRef: null,
        name: 'Verif Beta',
        lon: east(km(2), 71),
        website: 'https://autre-camping-beta.fr',
      });
      const gammaOsm = await plant(db, seed, {
        slug: 'thr-gamma-osm',
        osmRef: 'w900000003',
        name: 'Camping Verif Gamma',
        lon: km(4),
        website: 'https://camping-verif-gamma.fr',
      });
      const gammaDt = await plant(db, seed, {
        slug: 'thr-gamma-dt',
        osmRef: null,
        name: 'Verif Gamma',
        lon: east(km(4), 71),
        website: null,
      });
      const planted = [alphaOsm, alphaDt, betaOsm, betaDt, gammaOsm, gammaDt];

      // 🔴 The byte-for-byte state of the six campsite rows, BEFORE.
      const snapshot = async () =>
        (
          await db.query<{ h: string }>(
            `SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) AS h
               FROM camping_spots t WHERE t.id = ANY($1::uuid[])`,
            [planted],
          )
        ).rows[0].h;
      const before = await snapshot();

      // ---- the pass, exactly as --apply runs it ----------------------
      console.log('--- the candidate query finds the planted pairs ---');
      const res = await db.query(CANDIDATE_SQL, [BOX_DEGREES, RULES.maxMetres]);
      const pairs: PairRow[] = res.rows
        .map((r: Record<string, unknown>) => ({
          a: side(r, 'a'),
          b: side(r, 'b'),
          metres: Number(r.metres),
        }))
        .filter((p) => planted.includes(p.a.id) && planted.includes(p.b.id));
      check(pairs.length === 3, `three planted pairs found (${pairs.length})`);

      const out = proposeLinks(pairs, new Set(), new Set());
      check(
        out.link.length === 3,
        `the matcher calls all three "same campsite" (${out.link.length})`,
      );
      const { auto, held } = splitByIdentity(out.link);
      console.log('\n--- the third axis decides what is written ---');
      for (const p of out.link) {
        const tier = auto.includes(p)
          ? 'AUTO'
          : `held (${held.find((h) => h.secondary.id === p.secondary.id)?.identity})`;
        console.log(
          `    ${p.secondary.slug.padEnd(14)} sim ${p.similarity}  ${p.metres} m  → ${tier}`,
        );
      }
      check(
        auto.length === 1 && auto[0].secondary.id === alphaDt,
        'only Alpha (same domain) is in the auto tier',
      );
      check(
        held.length === 2 &&
          held.find((h) => h.secondary.id === betaDt)?.identity ===
            'disagree' &&
          held.find((h) => h.secondary.id === gammaDt)?.identity === 'none',
        'Beta (domains differ) and Gamma (one side silent) are held',
      );

      const w = await writeLinks(db, auto);
      check(w.written === 1 && w.refused.length === 0, 'one row written');

      // ---- the trace ---------------------------------------------------
      console.log(
        '\n--- the link is a row an arbitrator can read and undo ---',
      );
      const trace = await db.query<{
        metres: number;
        name_similarity: number;
        rule: string;
        unlinked_at: string | null;
      }>(
        `SELECT metres, name_similarity, rule, unlinked_at FROM spot_links
          WHERE primary_id = $1 AND secondary_id = $2`,
        [alphaOsm, alphaDt],
      );
      const t = trace.rows[0];
      check(
        !!t && t.metres === 71 && Number(t.name_similarity) === 1,
        `spot_links holds Alpha with its numbers (${t?.metres} m, sim ${t?.name_similarity})`,
      );
      check(
        !!t && t.rule === RULE_ID && t.unlinked_at === null,
        `… stamped with the rule that made it: ${t?.rule}`,
      );
      const heldRows = await db.query(
        `SELECT 1 FROM spot_links WHERE secondary_id = ANY($1::uuid[])
             OR primary_id = ANY($1::uuid[])`,
        [[betaOsm, betaDt, gammaOsm, gammaDt]],
      );
      check(
        heldRows.rowCount === 0,
        'no row of any kind for Beta or Gamma — held means untouched',
      );
      check(
        (await snapshot()) === before,
        'the six campsite rows are byte-for-byte what they were',
      );

      // ---- hidden by the read side, then back with one UPDATE ---------
      console.log('\n--- hidden at read time, and back with one UPDATE ---');
      const visible = async (id: string) =>
        (
          await db.query(
            `SELECT 1 FROM camping_spots s WHERE s.id = $1 AND ${notSecondarySql('s')}`,
            [id],
          )
        ).rowCount === 1;
      check(!(await visible(alphaDt)), 'Alpha DT is hidden behind its OSM row');
      check(
        (await visible(betaDt)) && (await visible(gammaDt)),
        'Beta DT and Gamma DT are still their own pages',
      );
      await db.query(
        `UPDATE spot_links SET unlinked_at = now(), unlinked_reason = 'rehearsal'
          WHERE primary_id = $1 AND secondary_id = $2`,
        [alphaOsm, alphaDt],
      );
      check(await visible(alphaDt), 'after the undo, Alpha DT is a page again');
      check(
        (await snapshot()) === before,
        'and the campsite rows still never changed',
      );

      // ---- and the undone pair is not re-proposed ----------------------
      const judged = new Set<string>(
        (
          await db.query<{ k: string }>(
            `SELECT primary_id || '|' || secondary_id AS k FROM spot_links`,
          )
        ).rows.map((r) => r.k),
      );
      const again = proposeLinks(pairs, judged, new Set());
      check(
        again.alreadyJudged === 1 &&
          !splitByIdentity(again.link).auto.some(
            (p) => p.secondary.id === alphaDt,
          ),
        'the undone pair is counted as judged and not proposed again',
      );
    } finally {
      await db.query('ROLLBACK');
    }

    const left = await db.query(
      `SELECT count(*)::int AS n FROM camping_spots WHERE slug LIKE 'thr-%'`,
    );
    check(left.rows[0].n === 0, 'nothing planted survives the rollback');
  } finally {
    await db.end();
  }

  if (failed > 0) {
    console.error(`\n✗ ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log('\n✓ the threshold rehearsal holds');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
