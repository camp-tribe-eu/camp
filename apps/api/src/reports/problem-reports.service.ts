import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ProblemReport } from '../entities/problem-report.entity';
import { canonicalPath } from '../spots/canonical';
import type { ParsedReport } from './problem-reports.rules';

// «Report a problem» — storage. Every rule lives in ./problem-reports.rules,
// which has its own spec; this file is only the part that needs a database.

@Injectable()
export class ProblemReportsService {
  constructor(
    @InjectRepository(ProblemReport)
    private readonly repo: Repository<ProblemReport>,
    @InjectDataSource() private readonly db: DataSource,
  ) {}

  /**
   * Store a report, or say that the campsite does not exist.
   *
   * 🔴 THE CAMPSITE IS LOOKED UP, NOT TRUSTED. The browser names a slug; the
   * row it resolves to supplies the id and the page address that are stored.
   * A slug nobody has is `unknown_campsite` and writes nothing — a public
   * endpoint that stored reports about campsites that do not exist would be a
   * free-text inbox with an unbounded key.
   *
   * A slug is unique across the table (`spots.service.ts`, `findBySlug`), so
   * country and region are not needed to find the row.
   */
  async accept(
    report: ParsedReport,
  ): Promise<{ outcome: 'stored' } | { outcome: 'unknown_campsite' }> {
    const rows = (await this.db.query(
      `SELECT id, country, region, slug FROM camping_spots WHERE slug = $1 LIMIT 1`,
      [report.slug],
    )) as Array<{
      id: string;
      country: string;
      region: string | null;
      slug: string;
    }>;
    const spot = rows[0];
    if (!spot) return { outcome: 'unknown_campsite' };

    await this.repo.insert({
      campingSpotId: spot.id,
      // `canonicalPath` is null only for a row without a region, which the
      // page never has — but the column is NOT NULL, so say the slug alone
      // rather than fail to store a report a person took the time to write.
      spotPath:
        canonicalPath(spot.country, spot.region, spot.slug) ??
        `/camping/${spot.country.toLowerCase()}/-/${spot.slug}`,
      kind: report.kind,
      description: report.description,
      contact: report.contact,
    });
    return { outcome: 'stored' };
  }
}
