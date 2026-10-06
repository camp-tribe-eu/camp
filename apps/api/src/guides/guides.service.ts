import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// CAMP-66 — reading guides.
//
// 🔴 Only `published` rows ever leave this file. A draft is somebody's
// half-finished thought and an archived one is a page whose data stopped
// supporting it; either reaching a reader would be us publishing
// something nobody decided to publish.

export interface GuideView {
  slug: string;
  category: string;
  title: string;
  summary: string | null;
  body: string | null;
  /** How the text was made — a publication condition, see the entity. */
  provenance: string;
  generator: string | null;
  authorName: string | null;
  authorCredentials: string | null;
  readingMinutes: number | null;
  factsCheckedAt: string | null;
  publishedAt: string | null;
}

/**
 * 🔴 `body` IS NOT IN HERE, AND THAT IS THE POINT (CAMP-210).
 *
 * It used to be, and the list endpoint shipped every article in full:
 * **4 117 809 bytes** for 1 256 guides, of which 3.46 MB was `body`.
 * Nothing reads it from the list — the article page fetches one guide by
 * slug — so it was pure weight.
 *
 * It was not only weight. Next refuses its data cache to anything over
 * 2 MB:
 *
 *   Failed to set Next.js data cache, items over 2MB can not be cached
 *
 * So `next: { revalidate: 3600 }` on `/guides` silently did nothing, and
 * every page that called `getGuides()` hit the API again. Measured by
 * review on an isolated build of the 31 catalogue pages: **34 requests**
 * with this payload, **3** with a 623 KB one. The cause is the size, not
 * the count of callers.
 *
 * That is ~134 MB of transfer and 34 hits on the rate limiter per build,
 * where CAMP-69 already recorded what a throttled build does: it exits 0
 * with most of the site missing.
 */
const LIST_COLUMNS = `
  SELECT g.slug, g.category, g.provenance, g.generator,
         g.author_name        AS "authorName",
         g.author_credentials AS "authorCredentials",
         g.reading_minutes    AS "readingMinutes",
         g.facts_checked_at   AS "factsCheckedAt",
         g.published_at       AS "publishedAt",
         t.title, t.summary
    FROM guides g
    JOIN guide_translations t
      ON t.guide_id = g.id AND t.language_code = $1
   WHERE g.status = 'published'
`;

/** One guide, read whole: this is the only caller that needs the text. */
const SELECT = LIST_COLUMNS.replace(
  't.title, t.summary',
  't.title, t.summary, t.body',
);

@Injectable()
export class GuidesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async list(language = 'en-GB'): Promise<GuideView[]> {
    return this.db.query(`${LIST_COLUMNS} ORDER BY g.category, t.title`, [
      language,
    ]);
  }

  async bySlug(slug: string, language = 'en-GB'): Promise<GuideView> {
    const rows = await this.db.query(`${SELECT} AND g.slug = $2 LIMIT 1`, [
      language,
      slug,
    ]);
    if (!rows[0]) throw new NotFoundException(`No guide "${slug}"`);
    return rows[0];
  }
}
