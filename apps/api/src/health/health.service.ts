import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { evaluate, type Facts, type Level } from './health.rules';

/**
 * How long one answer stands for.
 *
 * Five seconds: shorter than any sane monitor's interval, so a real
 * outage is still noticed within one poll, and long enough that a flood
 * cannot turn the health check into the outage.
 */
const CACHE_MS = 5_000;

interface HealthReport {
  status: Level;
  checkedAt: string;
  checks: Record<string, { ok: boolean; detail: string }>;
}

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

    // 🔴 The version ONLY IF the computation agrees. NULL otherwise.
    //
    // The first version appended " (ST_DWithin disagrees with itself)" to
    // the version string — and a longer string is still a string, so the
    // rules, which fail only on null, reported a PostGIS that answers
    // wrong as healthy with a 200. Review reproduced it by forcing the
    // predicate false: the endpoint said ok and the detail read
    // "PostGIS 3.6 (ST_DWithin disagrees with itself)".
    //
    // Now a disagreement produces NULL, which is the path the rules
    // already treat as "we could not measure, and that is a failure".
    // The check is worth making because a row count proves rows; only a
    // real geography computation proves the extension can do the thing
    // every map request needs.
    const postgis = await this.text(
      `SELECT CASE WHEN ST_DWithin(
                     ST_MakePoint(14.09, 46.36)::geography,
                     ST_MakePoint(14.10, 46.37)::geography, 5000)
                   THEN postgis_version() END`,
    );

    const spots = await this.number(
      `SELECT count(*) FROM camping_spots WHERE missing_since IS NULL`,
    );
    const withSurroundings = await this.number(
      `SELECT count(*) FROM camping_spots
        WHERE missing_since IS NULL AND context <> '{}'::jsonb`,
    );
    // 🔴 The STALEST country, not the freshest row anywhere.
    //
    // This was `max(last_seen_at)` across the whole table, and
    // osm-weekly.yml is a `fail-fast: false` matrix of 27 jobs — so one
    // country failing while the rest succeed is the EXPECTED failure, and
    // the workflow's own comment says of it: "a country's data would
    // simply stop being refreshed while the others kept updating … and
    // nothing anywhere looks wrong."
    //
    // The aggregate hid exactly that. Review reproduced it: France 120
    // days stale, Malta fresh, and the endpoint reported "last import 1 h
    // ago", ok, 200. Blindness mode 1 from the list at the top of
    // health.rules.ts, reintroduced by a max().
    const importAgeHours = await this.number(
      `SELECT EXTRACT(EPOCH FROM (now() - min(last))) / 3600
         FROM (SELECT max(last_seen_at) AS last
                 FROM camping_spots
                WHERE missing_since IS NULL
                GROUP BY country) per_country`,
    );

    // 🔴 Per country, because a total cannot notice one disappearing.
    const countries = await this.number(
      `SELECT count(DISTINCT country) FROM camping_spots WHERE missing_since IS NULL`,
    );
    const smallestCountry = await this.number(
      `SELECT min(n) FROM (SELECT count(*) AS n FROM camping_spots
                            WHERE missing_since IS NULL GROUP BY country) c`,
    );

    return {
      databaseMs,
      postgis,
      spots,
      withSurroundings,
      importAgeHours,
      countries,
      smallestCountry,
    };
  }

  /**
   * 🔴 Cached for a few seconds, because /health is the one route with no
   * rate limit and the most database work per request.
   *
   * Measured by review on the live database: two sequential counts over
   * camping_spots, ~31 MB of buffer traffic each, and 130 unthrottled
   * requests from one client in 7 seconds — 18.6 req/s, no key, no limit.
   * throttle.ts exists so that "a single misbehaving client … gets a 429
   * rather than a bill", and the route exempted from it was the most
   * expensive one. It also scales with a dataset that went from 9,830 to
   * 61,521 rows in one night.
   *
   * A monitor polling every 60 s sees no difference; a flood costs one
   * query set per window instead of one per request. `Cache-Control:
   * no-store` still governs what the CLIENT may keep — this is our own
   * memory, not theirs.
   */
  private cached: { at: number; value: HealthReport } | null = null;

  async report(): Promise<{
    status: Level;
    checkedAt: string;
    checks: Record<string, { ok: boolean; detail: string }>;
  }> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < CACHE_MS)
      return this.cached.value;

    const { status, checks } = evaluate(await this.facts());
    const value = { status, checkedAt: new Date().toISOString(), checks };
    this.cached = { at: now, value };
    return value;
  }
}
