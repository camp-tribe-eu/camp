// CAMP-66: build the guides the data supports, and no others.
//
//   npx ts-node src/guides/generate.ts            # dry run
//   npx ts-node src/guides/generate.ts --apply
//
// 🔴 Dry run by default for the same reason the DATAtourisme importer is:
// this writes pages that get URLs, and a URL is a promise. It also
// REMOVES guides whose data has fallen below the threshold, which is the
// more dangerous half — see `retired` below.

import 'dotenv/config';
import { Client } from 'pg';
import {
  compose,
  MIN_SUBJECTS,
  slugFor,
  THEMES,
  worthPublishing,
} from './region-facts';
import type { RegionFacts } from './region-facts';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * The name that goes in `guides.generator`.
 *
 * 🔴 Versioned on purpose. When the wording changes, the version changes,
 * and every page carries the version that produced it — so "which text
 * did a reader actually see in October" has an answer. Article 50 asks us
 * to disclose that a machine wrote it; being able to say WHICH machine
 * and when is the part that makes the disclosure worth anything.
 */
export const GENERATOR = 'region-facts@1';
export const CATEGORY = 'region';
export const LANGUAGE = 'en-GB';

/** Slug for a region, the same rule the campsite URLs use. */
export function regionSlug(region: string): string {
  return region
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    const wanted = new Map<string, RegionFacts>();

    for (const theme of THEMES) {
      // One query per theme rather than per region: 5 queries, not 40.
      const rows = await db.query<{
        country: string;
        region: string;
        subjects: string;
        total: string;
        unknown: string;
      }>(
        `
        SELECT country,
               region,
               count(*) FILTER (WHERE ${theme.predicate})::text AS subjects,
               count(*)::text AS total,
               -- "Unknown" means this theme has no answer for the row.
               -- For an amenity that is the literal 'unknown'; for the
               -- computed surroundings it is an empty context; for a
               -- classification or a type it is simply absent.
               count(*) FILTER (WHERE NOT (${theme.predicate}))::text AS unknown
          FROM camping_spots
         WHERE region IS NOT NULL
           AND missing_since IS NULL
         GROUP BY country, region
        `,
      );

      for (const r of rows.rows) {
        const facts: RegionFacts = {
          country: r.country,
          region: r.region,
          theme,
          subjects: Number(r.subjects),
          total: Number(r.total),
          unknown: Number(r.unknown),
          examples: [],
        };
        if (!worthPublishing(facts)) continue;

        // The named examples, only now that the page is going to exist.
        const ex = await db.query<{
          name: string;
          slug: string;
          stars: number | null;
        }>(
          `SELECT name, slug, stars
             FROM camping_spots
            WHERE country = $1 AND region = $2
              AND missing_since IS NULL
              AND name IS NOT NULL
              AND ${theme.predicate}
            ORDER BY (stars IS NULL), stars DESC, name
            LIMIT 5`,
          [r.country, r.region],
        );
        facts.examples = ex.rows.map((e) => ({
          name: e.name,
          slug: e.slug,
          detail: e.stars ? `${e.stars} official stars` : null,
        }));

        wanted.set(slugFor(facts, regionSlug(r.region)), facts);
      }
    }

    const existing = await db.query<{ slug: string }>(
      `SELECT slug FROM guides WHERE generator = $1`,
      [GENERATOR],
    );
    const have = new Set<string>(existing.rows.map((r) => r.slug));

    const fresh = [...wanted.keys()].filter((s) => !have.has(s));
    /**
     * 🔴 Guides whose data fell below the threshold.
     *
     * These are RETIRED, not deleted: a published URL that starts
     * answering 404 is a broken promise to whoever linked to it, and
     * CAMP-87 has rules about that. Setting status to `archived` takes
     * the page out of the index and the sitemap while leaving the row —
     * the 410 path decides the rest.
     */
    const retired = [...have].filter((s) => !wanted.has(s));

    console.log(`themes          ${THEMES.length}`);
    console.log(`guides the data supports  ${wanted.size}`);
    console.log(`  new                     ${fresh.length}`);
    console.log(`  already published       ${wanted.size - fresh.length}`);
    console.log(`  to retire               ${retired.length}`);
    console.log(`threshold: at least ${MIN_SUBJECTS} campsites with data`);

    if (!apply) {
      console.log('\nfirst few:');
      for (const slug of fresh.slice(0, 8)) {
        console.log(`  ${slug}  —  ${compose(wanted.get(slug)!).title}`);
      }
      console.log('\n(dry run — nothing was written. Add --apply to write.)');
      return;
    }

    await db.query('BEGIN');
    for (const [slug, facts] of wanted) {
      const { title, summary, body } = compose(facts);
      // 🔴 provenance and generator are not optional here either: the
      // database refuses the row without them, and this is the only
      // place that writes these guides.
      const res = await db.query<{ id: string }>(
        `
        INSERT INTO guides (slug, category, status, provenance, generator,
                            reading_minutes, facts_checked_at, published_at)
        VALUES ($1, $2, 'published', 'data-generated', $3, 1, CURRENT_DATE, now())
        ON CONFLICT (slug) DO UPDATE SET
          status           = 'published',
          facts_checked_at = CURRENT_DATE,
          generator        = EXCLUDED.generator
        RETURNING id
        `,
        [slug, CATEGORY, GENERATOR],
      );
      const id = res.rows[0].id;

      await db.query(
        `
        INSERT INTO guide_translations (guide_id, language_code, title, summary, body)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (guide_id, language_code) DO UPDATE SET
          title = EXCLUDED.title, summary = EXCLUDED.summary, body = EXCLUDED.body
        `,
        [id, LANGUAGE, title, summary, body],
      );
    }

    if (retired.length > 0) {
      await db.query(
        `UPDATE guides SET status = 'archived' WHERE slug = ANY($1::text[])`,
        [retired],
      );
    }

    await db.query('COMMIT');
    console.log(`\n✓ ${wanted.size} published, ${retired.length} archived`);
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
