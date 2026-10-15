// CAMP-262: the planner's measuring scripts read a database that an import
// may be writing to, and must not write to it themselves.
//
// One READ ONLY, REPEATABLE READ transaction does both jobs: the server
// refuses a write (so "read-only" is a property, not a promise in a
// comment), and every query inside sees the same snapshot (so the numbers
// printed side by side agree with each other while rows are moving).

/** The one method of `pg.Client` this needs. */
export interface Queryable {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export const BEGIN_READ_ONLY =
  'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY';

/** Runs `fn` inside it; rolls back whatever `fn` throws. */
export async function inReadOnlyTransaction<T>(
  db: Queryable,
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(BEGIN_READ_ONLY);
  try {
    const result = await fn();
    await db.query('COMMIT');
    return result;
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}
