import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundHit } from '../entities/not-found-hit.entity';
import { toRow } from './not-found.rules';

/** One line of the report: a dead path and how often it was asked for. */
export type DeadPath = {
  path: string;
  hits: number;
  /** The most common place still linking to it, or null when nothing links. */
  from: string | null;
};

/** How far back a report looks unless asked otherwise. */
export const REPORT_DAYS = 7;

@Injectable()
export class NotFoundService {
  constructor(
    @InjectRepository(NotFoundHit)
    private readonly repo: Repository<NotFoundHit>,
  ) {}

  /** Record a miss. Returns whether anything was written. */
  async record(path: unknown, referrer: unknown): Promise<boolean> {
    const row = toRow(path, referrer);
    if (!row) return false;
    await this.repo.save(this.repo.create(row));
    return true;
  }

  /**
   * The dead paths worth acting on, most-asked first.
   *
   * 🔴 This IS the deliverable. The card's point is not that we store
   * 404s — it is that somebody can read, on a Monday, the list of URLs
   * the web is still pointing at and decide where each 301 goes.
   *
   * `from` is the single most common referrer for that path, which is
   * usually enough to tell a stale Google index from a partner's old
   * link — two cases that need different answers.
   */
  async worstPaths(days = REPORT_DAYS, limit = 100): Promise<DeadPath[]> {
    const rows = await this.repo.query(
      `SELECT path,
              count(*)::int AS hits,
              (SELECT r.referrer
                 FROM not_found_hits r
                WHERE r.path = h.path
                  AND r.referrer IS NOT NULL
                  AND r.created_at > now() - ($1 || ' days')::interval
                GROUP BY r.referrer
                ORDER BY count(*) DESC, r.referrer
                LIMIT 1) AS from
         FROM not_found_hits h
        WHERE h.created_at > now() - ($1 || ' days')::interval
        GROUP BY h.path
        ORDER BY hits DESC, h.path
        LIMIT $2`,
      [days, limit],
    );
    return rows as DeadPath[];
  }
}
