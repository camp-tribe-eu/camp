import { BATHING_RADIUS_M, nearestBathingWaterSql } from './nearby';
import { BATHING_SOURCE_ID } from './source';

// CAMP-168: the read query is the place where the radius, the season and
// the determinism of the page are decided, so each of them is asserted
// against the SQL text. Every assertion here was checked by deleting the
// clause it names and watching this file go red.

/** The SQL with its whitespace collapsed, so layout is not asserted. */
const flat = (sql: string): string => sql.replace(/\s+/g, ' ');

describe('nearestBathingWaterSql', () => {
  const sql = nearestBathingWaterSql('s.location');

  it('filters by the radius, in metres, on the geography column', () => {
    expect(sql).toContain(
      `ST_DWithin(s.location, b.location, ${BATHING_RADIUS_M})`,
    );
  });

  it('takes the radius as an argument so a caller can measure others', () => {
    expect(nearestBathingWaterSql('s.location', 500)).toContain(
      'ST_DWithin(s.location, b.location, 500)',
    );
  });

  // 🔴 Every page must carry the season. It is not optional in the
  // payload, so it must be selected here — the page cannot print a year
  // the query never fetched.
  it('selects the season with every record', () => {
    expect(sql).toContain("'season', b.season");
  });

  it('selects the name, the distance and the profile link', () => {
    expect(sql).toContain("'name', b.name");
    expect(sql).toContain("'metres'");
    expect(sql).toContain("'profileUrl', b.profile_url");
  });

  // 🔴 The newest season, chosen by the data rather than compiled in.
  // Next June's import must be picked up without a deploy, and a table
  // holding two seasons mid-import must still yield one row per campsite.
  it('reads the newest season present rather than a hard-coded year', () => {
    expect(flat(sql)).toContain('b.season = ( SELECT max(m.season)');
    expect(sql).not.toMatch(/b\.season = \d{4}/);
  });

  // 🔴 The newest season OF THIS SOURCE. The subquery used to read the
  // whole table: a second publisher with a higher season would have made
  // `b.season = max(...)` match no EEA row at all, and every campsite
  // page would have said "no bathing water within 2 km" — a confident,
  // silent, wrong answer on every page, with nothing in the table today
  // to show it.
  it('takes the newest season of this source, not of the whole table', () => {
    expect(flat(sql)).toContain(
      `SELECT max(m.season) FROM bathing_waters m WHERE m.source_id = '${BATHING_SOURCE_ID}')`,
    );
  });

  it('reads only this source', () => {
    expect(sql).toContain(`b.source_id = '${BATHING_SOURCE_ID}'`);
  });

  // 🔴 One row, and deterministically the same one. Two equidistant
  // bathing waters without the `b.ref` tiebreak swap between builds and
  // rewrite pages whose content did not change.
  it('is a single, totally ordered row', () => {
    expect(sql).toContain('LIMIT 1');
    expect(sql).toContain('ORDER BY s.location <-> b.location, b.ref');
  });

  // 🔴 No CURRENT_DATE anywhere. A query whose output changes at
  // midnight churns a statically built site nightly — the lesson
  // tariffsSql already records, repeated here because this data has a
  // date in it and the temptation is right there.
  it('has no clock in it', () => {
    expect(sql).not.toMatch(/now\(\)|CURRENT_DATE|CURRENT_TIMESTAMP/i);
  });

  it('is a scalar subquery, so it can sit in a SELECT list', () => {
    expect(sql.trim().startsWith('(')).toBe(true);
    expect(sql.trim().endsWith(')')).toBe(true);
  });
});

describe('BATHING_RADIUS_M', () => {
  // 🔴 The number the measurement in nearby.ts argues for. If somebody
  // widens it, the comment above it stops describing the code and this
  // test is the thing that says so.
  it('is 2 km', () => {
    expect(BATHING_RADIUS_M).toBe(2000);
  });
});
