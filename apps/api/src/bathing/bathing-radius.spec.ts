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
// This reads the SQL FILE, not a description of it, strips its comments so
// a number in prose cannot satisfy it, and compares the one ST_DWithin
// that selects bathing waters with the constant the page uses. Checked by
// changing either number.

const SELECT = readFileSync(
  join(__dirname, '../../test/fixtures/_select.sql'),
  'utf8',
);

const code = SELECT.replace(/--[^\n]*/g, '');

describe('the fixture select for bathing waters', () => {
  const radii = [
    ...code.matchAll(
      /ST_DWithin\(\s*b\.location\s*,\s*s\.location::geography\s*,\s*(\d+)\s*\)/g,
    ),
  ].map((m) => Number(m[1]));

  it('selects by distance exactly once, so there is one number to compare', () => {
    expect(radii).toHaveLength(1);
  });

  it('uses the radius the campsite page uses', () => {
    expect(radii[0]).toBe(BATHING_RADIUS_M);
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
