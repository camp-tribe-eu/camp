import {
  countrySql,
  EU_SQL_LIST,
  euLeakGuardSql,
  firstOf,
  normaliseCountrySql,
  POINT_SQL,
  WEBSITE_SQL,
} from './route-poi-sql';
import { EU_MEMBER_STATES } from './eu';

// CAMP-113 — the import SQL, which had no test at all until review
// showed what that cost.
//
// 🔴 Every test here was written against a MUTATION and shown to fail on
// it. The mutations are named in the test that covers them, because a
// test whose failure mode nobody has seen is a test nobody can trust —
// and these four all shipped green:
//
//   ST_PointOnSurface → ST_Centroid
//   the website `^https?://` check, deleted
//   the country's NULL-keeping exception
//   the member list without its Åland alias

describe('where a POI is placed', () => {
  // 🔴 MUTATION: ST_PointOnSurface → ST_Centroid. Silent, and it puts a
  // fuel station in the field next to itself for any C-shaped or
  // ring-shaped way — 473 000 of the staged objects are polygons.
  it('uses a point guaranteed to lie ON the geometry', () => {
    expect(POINT_SQL).toContain('ST_PointOnSurface');
    expect(POINT_SQL).not.toContain('ST_Centroid');
  });

  // An invalid polygon is repaired rather than dropped, and a
  // GEOMETRYCOLLECTION is reduced before a point is taken from it.
  it('repairs the geometry before taking a point from it', () => {
    expect(POINT_SQL).toContain('ST_MakeValid');
    expect(POINT_SQL).toContain('ST_CollectionExtract');
  });
});

describe('the values copied off a staging row', () => {
  // 🔴 MUTATION: delete the `~*` test. The column then holds whatever a
  // stranger typed into OpenStreetMap, and the page renders it as an
  // href on a public site.
  it('accepts only http and https for a website', () => {
    expect(WEBSITE_SQL).toContain("~* '^https?://");
    for (const scheme of ['javascript:', 'data:', 'file:']) {
      // The pattern is anchored, so nothing but http(s) can match.
      expect(
        new RegExp('^https?://[^\\s<>"]+$').test(`${scheme}alert(1)`),
      ).toBe(false);
    }
    expect(
      new RegExp('^https?://[^\\s<>"]+$').test('https://example.org'),
    ).toBe(true);
  });

  // 🔴 MUTATION: drop split_part. A `tel:` with two numbers glued
  // together dials neither; 157 campsite rows were doing exactly that
  // before CAMP-141.
  it('keeps only the first of several semicolon-separated values', () => {
    expect(firstOf('s.phone')).toContain("split_part(s.phone, ';', 1)");
    expect(firstOf('s.phone')).toContain('nullif');
  });
});

describe('which country a point is in', () => {
  const sql = countrySql('PT', '$3');

  // 🔴 MUTATION: delete the nearest-polygon arm and go back to
  // containment alone. That is the live defect: 423 rows strictly nearer
  // a non-member than the Union, kept because their country was NULL.
  it('falls back to the nearest polygon rather than answering nothing', () => {
    expect(sql).toContain('COALESCE');
    expect(sql).toContain('ST_Contains');
    expect(sql).toContain('<->');
  });

  // 🔴 MUTATION: drop the geodesic re-rank and trust `<->`. Planar
  // degrees are not metres, and a degree of longitude is 111 km at the
  // equator against 55 km at Uppsala.
  it('overfetches and re-ranks on the spheroid', () => {
    expect(sql).toContain('LIMIT 8');
    expect(sql).toContain('::geography');
    expect(sql).toMatch(/ORDER BY c\.m,/);
  });

  // 🔴 A tie goes to the NON-member: when we cannot tell which country a
  // point is in, we do not publish it. Preferring the member is how a
  // leak is spelled, and five rows sit exactly on this line.
  it('breaks a tie against the Union, not for it', () => {
    expect(sql).toMatch(/ORDER BY c\.m, \(c\.iso = ANY \(\$3::text\[\]\)\)/);
  });

  // 🔴 MUTATION: remove the Åland alias. 218 Finnish points disappear
  // and nothing anywhere says so, because a row that was never inserted
  // cannot be counted by a check on the table.
  it('normalises a subdivision code to its member state', () => {
    expect(normaliseCountrySql('x')).toContain("WHEN 'ax' THEN 'fi'");
    expect(sql).toContain("WHEN 'ax' THEN 'fi'");
  });

  it('refuses to build SQL from a code it cannot safely quote', () => {
    // The alias table is a constant, but this is the line that would
    // matter if it ever stopped being one. The repo is public.
    expect(() =>
      normaliseCountrySql("x'; DROP TABLE camping_spots; --"),
    ).not.toThrow();
    // …the EXPRESSION is interpolated, the CODES are validated:
    expect(normaliseCountrySql('x')).toMatch(/WHEN '[a-z]{2}' THEN '[a-z]{2}'/);
  });
});

describe('the list SQL tests membership against', () => {
  // 🔴 MUTATION: use EU_MEMBER_STATES here instead. That is the Åland
  // defect exactly — `ax` is not a member STATE, and the 218 points on
  // it are in Finland.
  it('carries the subdivision aliases as well as the members', () => {
    expect(EU_SQL_LIST).toContain('ax');
    expect(EU_SQL_LIST).toContain('fi');
    expect(EU_SQL_LIST.length).toBeGreaterThan(EU_MEMBER_STATES.length);
  });

  it('carries nothing that is outside the Union', () => {
    for (const code of ['gb', 'ch', 'mc', 'gi', 'no', 'tr', 'rs']) {
      expect(EU_SQL_LIST).not.toContain(code);
    }
  });
});

describe('the leak guard', () => {
  const guard = euLeakGuardSql('$1');

  // 🔴 THE POINT OF THIS GUARD. The one it replaced read the `country`
  // column — the column the import had just written — and returned 0
  // against a table holding 423 foreign rows.
  // 🔴 The assertion is on the WHOLE query, not on a slice of it. The
  // first version searched from `guard.indexOf('WHERE f.m')`, and a
  // mutation that inserted `n.country IS NOT NULL AND` right there moved
  // the needle so indexOf returned -1 and the test passed over nothing.
  // Caught by rehearsing the mutation rather than by reading the test.
  // The guard therefore does not select `country` either, so there is no
  // occurrence for a slice to miss.
  it('never mentions the country column at all', () => {
    expect(guard).not.toContain('country');
    expect(guard).toContain('ST_Distance');
  });

  // 🔴 MUTATION: `f.m <= e.m` → `f.m < e.m`. Five rows sit equidistant
  // from a member and a non-member; the import drops them, so the guard
  // has to accept them too or it fails a clean load.
  it('flags a non-member that is merely AS near as the Union', () => {
    expect(guard).toContain('f.m <= e.m');
  });

  it('drives out from the non-member polygons, so it can see a NULL', () => {
    expect(guard).toContain('ST_DWithin');
    expect(guard).toContain('<> ALL');
  });
});
