import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { evaluate, type Facts, type Level } from './health.rules';

// CAMP-59: measuring, kept apart from deciding.
//
// 🔴 Every measurement is allowed to fail on its own, and a failure is
// recorded as `null` — never as zero, never as a default. The decision
// in health.rules.ts then treats null as "we could not measure", which
// is a failure of the check itself and not a statement about the world.
//
// That separation is the whole point: "the count is 0" and "the count
// did not arrive" look identical in a naive implementation, and the
// second one is how a monitor reports health over a dead database.

@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * One number, or null if the query did not answer.
   *
   * Each measurement is wrapped separately rather than the whole set:
   * PostGIS being absent should not also hide the campsite count, and a
   * single try/catch around everything would report one failure and stop
   * measuring — leaving the person reading the alarm with less than they
   * had before.
   */
  private async number(sql: string): Promise<number | null> {
    try {
      const rows = (await this.db.query(sql)) as Record<string, unknown>[];
      const value = rows?.[0] ? Object.values(rows[0])[0] : undefined;
      if (value === null || value === undefined) return null;
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  private async text(sql: string): Promise<string | null> {
    try {
      const rows = (await this.db.query(sql)) as Record<string, unknown>[];
      const value = rows?.[0] ? Object.values(rows[0])[0] : undefined;
      return value === null || value === undefined ? null : String(value);
    } catch {
      return null;
    }
  }

  async facts(): Promise<Facts> {
    // 🔴 Timed around a query that does no work, so the number describes
    // the connection rather than the query plan.
    const started = Date.now();
    const alive = await this.number('SELECT 1');
    const databaseMs = alive === null ? null : Date.now() - started;

    // 🔴 Not `postgis_version()` alone: that proves the function exists.
    // A real geography computation proves the extension can actually do
    // the thing every map request needs.
    const postgis = await this.text(
      `SELECT postgis_version() ||
              CASE WHEN ST_DWithin(
                     ST_MakePoint(14.09, 46.36)::geography,
                     ST_MakePoint(14.10, 46.37)::geography, 5000)
                   THEN '' ELSE ' (ST_DWithin disagrees with itself)' END`,
    );

    const spots = await this.number(
      `SELECT count(*) FROM camping_spots WHERE missing_since IS NULL`,
    );
    const withSurroundings = await this.number(
      `SELECT count(*) FROM camping_spots
        WHERE missing_since IS NULL AND context <> '{}'::jsonb`,
    );
    const importAgeHours = await this.number(
      `SELECT EXTRACT(EPOCH FROM (now() - max(last_seen_at))) / 3600
         FROM camping_spots`,
    );

    return { databaseMs, postgis, spots, withSurroundings, importAgeHours };
  }

  async report(): Promise<{
    status: Level;
    checkedAt: string;
    checks: Record<string, { ok: boolean; detail: string }>;
  }> {
    const { status, checks } = evaluate(await this.facts());
    return { status, checkedAt: new Date().toISOString(), checks };
  }
}
