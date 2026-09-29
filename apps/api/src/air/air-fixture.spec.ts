import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIR_RADIUS_M } from './source';

// CAMP-164: the CI fixture must hold what the page can reach, and must
// hold it where the page's radius says it is.
//
// 🔴 WHY THIS FILE EXISTS. The seed is SQL and SQL cannot import
// AIR_RADIUS_M, so the number is written twice — the same situation
// bathing-radius.spec.ts guards for bathing water. The day the radius
// moves to 25 km the fixture would go on placing "the station just
// outside" at 20.5 km, which is INSIDE, and the test that says a
// campsite there gets the model instead would be asserting an artefact.
// This reads the SQL FILE, not a description of it, strips its comments
// so a number in prose cannot satisfy it, and compares.

const DIR = join(__dirname, '../../test/fixtures');
const SEED = readFileSync(join(DIR, 'ci-seed-hourly-air-quality.sql'), 'utf8');
const code = SEED.replace(/--[^\n]*/g, '');

const numbers = (s: string): number[] => s.split(',').map((n) => Number(n.trim()));

describe('the fixture seed for air quality', () => {
  const radius = /radius_m\s+constant\s+int\s*:=\s*(\d+)/.exec(code);
  const offsets = /offset_m\s+int\[\]\s*:=\s*ARRAY\[([^\]]+)\]/.exec(code);
  const separation = [...code.matchAll(/ST_DWithin\(p,\s*spot\.g,\s*(\d+)\)/g)].map((m) => Number(m[1]));

  it('sets the radius in exactly one place, and it is the page’s', () => {
    expect([...code.matchAll(/radius_m\s+constant/g)]).toHaveLength(1);
    expect(radius).not.toBeNull();
    expect(Number(radius![1])).toBe(AIR_RADIUS_M);
  });

  // The one distance test for "no station within 20 km" reads the
  // variable; a literal added beside it would be a second radius the page
  // has never heard of.
  it('tests "no station nearby" against that variable and nothing else', () => {
    const tests = [...code.matchAll(/ST_DWithin\(s\.location::geography,\s*st\.location,\s*([^)]*)\)/g)].map(
      (m) => m[1].trim(),
    );
    expect(tests).toEqual(['radius_m']);
  });

  // 🔴 The pair that makes the radius an assertion: one station just
  // inside it and one just outside, each within a kilometre of the edge.
  it('places one station just inside the radius and one just outside', () => {
    const list = numbers(offsets![1]);
    expect(list).toHaveLength(7);
    const inside = list.filter((m) => m < AIR_RADIUS_M && m > AIR_RADIUS_M - 1000);
    const outside = list.filter((m) => m > AIR_RADIUS_M && m < AIR_RADIUS_M + 1000);
    expect(inside).toEqual([19_500]);
    expect(outside).toEqual([20_500]);
    // The rest are well inside, so "a station is shown" has plain subjects.
    expect(list.filter((m) => m <= 8000)).toHaveLength(5);
  });

  // 🔴 Two picks must not be able to see each other's station, or a
  // campsite chosen to be "20.5 km from the only station" could have a
  // second one at 12 km. The separation has to cover the radius plus the
  // furthest offset.
  it('separates the campsites it picks by more than the radius plus the furthest offset', () => {
    expect(separation).toHaveLength(1);
    expect(separation[0]).toBeGreaterThan(AIR_RADIUS_M + Math.max(...numbers(offsets![1])));
  });

  it('marks every station it makes as synthetic, in its name and its code', () => {
    const names = [...code.matchAll(/'(CI fixture station [^']+)'/g)].map((m) => m[1]);
    expect(names).toHaveLength(7);
    expect(code).toContain("'FIXTURE' || n");
  });

  it('fails loudly rather than seeding fewer states than the spec needs', () => {
    expect(code).toMatch(/IF n < 7 THEN\s+RAISE EXCEPTION/);
    expect(code).toMatch(/IF m < 2 THEN\s+RAISE EXCEPTION/);
  });

  it('gives no reading to exactly one station, and an old one to exactly one', () => {
    const hours = /hours_ago\s+int\[\]\s*:=\s*ARRAY\[([^\]]+)\]/.exec(code)![1]
      .split(',')
      .map((h) => h.trim());
    expect(hours.filter((h) => h === 'NULL')).toHaveLength(1);
    expect(hours.filter((h) => h !== 'NULL' && Number(h) > 4)).toHaveLength(1);
    // Everything else is inside the four-hour budget with room to spare.
    for (const h of hours.filter((x) => x !== 'NULL' && Number(x) <= 4)) {
      expect(Number(h)).toBeLessThanOrEqual(2);
    }
  });

  // 🔴 SORTS AFTER ci-seed-gone.sql, because that file marks a campsite as
  // dropped and this one must not pick it.
  it('is appended after the file that marks a campsite as gone', () => {
    const files = ['ci-seed-gone.sql', 'ci-seed-hourly-air-quality.sql', 'ci-seed-route-poi.sql'];
    expect([...files].sort()).toEqual(files);
  });

  // ci-seed.sql is what CI actually loads, and regenerate.sh builds it by
  // appending this file verbatim. If somebody edits the source and not
  // the product, the fixture CI runs is not the fixture this describes.
  it('is inside ci-seed.sql, word for word', () => {
    const seed = readFileSync(join(DIR, 'ci-seed.sql'), 'utf8');
    expect(seed.split(SEED).length - 1).toBe(1);
  });
});
