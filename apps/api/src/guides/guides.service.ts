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

const SELECT = `
  SELECT g.slug, g.category, g.provenance, g.generator,
         g.author_name        AS "authorName",
         g.author_credentials AS "authorCredentials",
         g.reading_minutes    AS "readingMinutes",
         g.facts_checked_at   AS "factsCheckedAt",
         g.published_at       AS "publishedAt",
         t.title, t.summary, t.body
    FROM guides g
    JOIN guide_translations t
      ON t.guide_id = g.id AND t.language_code = $1
   WHERE g.status = 'published'
`;

@Injectable()
export class GuidesService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async list(language = 'en-GB'): Promise<GuideView[]> {
    return this.db.query(`${SELECT} ORDER BY g.category, t.title`, [language]);
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
