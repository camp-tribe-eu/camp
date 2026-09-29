import type { QueryRunner } from 'typeorm';
import { BathingWaters1790662800000 } from '../migrations/1790662800000-BathingWaters';
import { BATHING_STATUSES } from './source';

// CAMP-168: what the database itself refuses.
//
// 🔴 WHY THIS FILE EXISTS. The page's claim that it can never print a
// classification without its year rests on the `season` column: the API
// reads the row out of JSON with an unchecked cast
// (`row.bathing_water as BathingWaterView`), so nothing in TypeScript
// stops a null season reaching a page. The column is what does — and no
// test referenced the migration at all, so removing `NOT NULL` from it
// broke nothing anywhere.
//
// This runs the REAL `up()` against a query runner that records what it
// is asked to execute, and asserts the constraints that matter in the
// DDL it emitted. It reads the statement, not a database: the same
// statement CI executes when it migrates the fixture, and the end-to-end
// spec then reads the seasons those rows serve. Each assertion was
// checked by deleting the clause it names.

async function emittedSql(): Promise<string> {
  const statements: string[] = [];
  const runner = {
    query: async (sql: string) => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  await new BathingWaters1790662800000().up(runner);
  return statements.map((s) => s.replace(/\s+/g, ' ').trim()).join('\n');
}

describe('the bathing_waters migration', () => {
  it('creates the table and does something', async () => {
    const sql = await emittedSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS bathing_waters');
  });

  // 🔴 The one the page depends on.
  it('makes season an int that cannot be null', async () => {
    expect(await emittedSql()).toMatch(/\bseason int NOT NULL\b/);
  });

  it('refuses a season no directive report could hold', async () => {
    expect(await emittedSql()).toContain(
      'CHECK (season BETWEEN 1990 AND 2100)',
    );
  });

  // "Not classified" is a VALUE, not an absence; a NULL status would be
  // indistinguishable from an import that dropped the row.
  it('makes status non-null and limited to the five values the source publishes', async () => {
    const sql = await emittedSql();
    expect(sql).toMatch(/\bstatus text NOT NULL\b/);
    const list = BATHING_STATUSES.map((s) => `'${s}'`).join(', ');
    expect(sql).toContain(`CHECK (status IN (${list}))`);
  });

  // A new season lands beside the old one instead of overwriting it.
  it('keys a bathing water by source, reference AND season', async () => {
    expect(await emittedSql()).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_bathing_waters_identity ON bathing_waters (source_id, ref, season)',
    );
  });

  it('gives every row a location, because the page is chosen by geography', async () => {
    expect(await emittedSql()).toMatch(
      /\blocation geography\(Point, 4326\) NOT NULL\b/,
    );
  });
});
