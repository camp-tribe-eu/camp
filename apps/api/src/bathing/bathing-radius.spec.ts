import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BATHING_RADIUS_M } from './nearby';

// CAMP-172: the CI fixture must hold the bathing waters the page can reach.
//
// 🔴 WHY THIS FILE EXISTS. regenerate.sh selects "every bathing water
// within 2 km of a campsite in the fixture" in SQL, and SQL cannot import
// BATHING_RADIUS_M. So the number is written twice. The day the page's
// radius moves to 3 000 m, the fixture would go on holding the 2 km slice:
// a campsite 2.4 km from a bathing water would render "none within 3 km"
// in CI because the row simply is not there — a correct rendering of an
// incomplete fixture, which is the failure CAMP-168 built the three-state
// tests to avoid.
//
// The number is a psql variable (`\set bathing_radius_m`), so it is written
// once and the distance test reads it. This reads the SQL FILE, not a
// description of it, strips its comments so a number in prose cannot satisfy
// it, compares that one variable with the constant the page uses, and checks
// that the only distance test in the file reads the variable rather than a
// number of its own. Checked by changing either number and by adding a
// second one.

const SELECT = readFileSync(
  join(__dirname, '../../test/fixtures/_select.sql'),
  'utf8',
);

const code = SELECT.replace(/--[^\n]*/g, '');

describe('the fixture select for bathing waters', () => {
  const radii = [
    ...code.matchAll(/^\\set\s+bathing_radius_m\s+(\d+)\s*$/gm),
  ].map((m) => Number(m[1]));

  it('sets the radius in exactly one place', () => {
    expect(radii).toHaveLength(1);
  });

  it('uses the radius the campsite page uses', () => {
    expect(radii[0]).toBe(BATHING_RADIUS_M);
  });

  // Not "some distance test reads the variable": the ONLY one does, so a
  // literal added beside it (a second radius the page has never heard of)
  // cannot slip in.
  it('has one distance test, and it reads that variable', () => {
    const tests = [...code.matchAll(/ST_DWithin\(([^)]*)\)/g)].map((m) =>
      m[1].replace(/\s+/g, ' ').trim(),
    );
    expect(tests).toEqual([
      'b.location, s.location::geography, :bathing_radius_m',
    ]);
  });

  // Not a copy of the page's rule, a guard on the copy: the page reads only
  // the newest season of a source, and a fixture holding an older one would
  // carry rows no page can show.
  it('takes the newest season of each source, as the page does', () => {
    expect(code).toMatch(
      /b\.season\s*=\s*\(\s*SELECT\s+max\(m\.season\)\s+FROM\s+bathing_waters\s+m\s+WHERE\s+m\.source_id\s*=\s*b\.source_id\s*\)/,
    );
  });
});
