import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { measure, type Report } from './data-quality';

/**
 * How long one measurement is served for. The slowest source behind it
 * is imported weekly and the fastest daily; ten minutes is far inside
 * both, and it bounds what a reloading browser can ask of the database
 * to one run per ten minutes.
 */
export const CACHE_MS = 10 * 60 * 1000;

@Injectable()
export class DataQualityService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private kept: { at: number; report: Report } | null = null;
  private running: Promise<Report> | null = null;

  /**
   * 🔴 A VALUE IS CACHED, NEVER A PROMISE. A cached rejected promise
   * would answer "the database is down" for ten minutes after it came
   * back. `running` only joins callers that arrive during one run, and
   * is dropped the moment that run settles either way.
   */
  async report(now: number = Date.now()): Promise<Report> {
    if (this.kept && now - this.kept.at < CACHE_MS) return this.kept.report;
    this.running ??= this.run().finally(() => {
      this.running = null;
    });
    const report = await this.running;
    this.kept = { at: now, report };
    return report;
  }

  /**
   * 🔴 ITS OWN CONNECTION. `measure()` opens a read-only transaction and
   * sets a statement timeout inside it; on the shared pool those would
   * land on whichever connection each query happened to be handed.
   */
  private async run(): Promise<Report> {
    const runner = this.db.createQueryRunner();
    try {
      await runner.connect();
      return await measure({
        query: async (sql) => ({
          rows: (await runner.query(sql)) as unknown[],
        }),
      });
    } finally {
      await runner.release();
    }
  }
}
