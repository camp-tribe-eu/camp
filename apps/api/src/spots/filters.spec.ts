import {
  describeFilters,
  filterSql,
  NO_FILTERS,
  parseFilters,
  SPOT_TYPES,
} from './filters';
import { AMENITY_KEYS } from '../osm/tag-mapping';

describe('parseFilters: only values this codebase defines reach the SQL', () => {
  it('keeps known types and amenities', () => {
    const f = parseFilters({
      types: 'free,rv_park',
      amenities: 'shower,wheelchairFull',
    });
    expect(f.types).toEqual(['free', 'rv_park']);
    expect(f.amenities).toEqual(['shower', 'wheelchairFull']);
  });

  // 🔴 Dropped, not rejected. A bookmark from before an amenity was
  // renamed should still draw the map, and an error message echoing the
  // caller's own string back is how a query parameter becomes a payload.
  it('drops anything it does not recognise, and never errors', () => {
    const f = parseFilters({
      types: "free,'; DROP TABLE camping_spots; --",
      amenities: 'shower,sauna,<script>',
    });
    expect(f.types).toEqual(['free']);
    expect(f.amenities).toEqual(['shower']);
  });

  it('collapses repeats, so one tick cannot become two conditions', () => {
    expect(parseFilters({ amenities: 'shower,shower,shower' }).amenities).toEqual(
      ['shower'],
    );
  });

  it('treats a missing, empty or non-string parameter as no filter', () => {
    for (const raw of [undefined, '', 42, null, ['shower']]) {
      expect(parseFilters({ amenities: raw }).amenities).toEqual([]);
    }
  });

  it('reads the unknown opt-in only from an explicit yes', () => {
    expect(parseFilters({ unknown: '1' }).includeUnknown).toBe(true);
    expect(parseFilters({ unknown: 'true' }).includeUnknown).toBe(true);
    expect(parseFilters({ unknown: '0' }).includeUnknown).toBe(false);
    expect(parseFilters({}).includeUnknown).toBe(false);
  });

  it('accepts every type and amenity the rest of the code knows about', () => {
    // Guards the lists from drifting apart: a new amenity that the parser
    // silently refuses would be a filter that never matches anything.
    const f = parseFilters({
      types: SPOT_TYPES.join(','),
      amenities: AMENITY_KEYS.join(','),
    });
    expect(f.types).toHaveLength(SPOT_TYPES.length);
    expect(f.amenities).toHaveLength(AMENITY_KEYS.length);
  });
});

describe('filterSql: placeholders continue the caller’s numbering', () => {
  it('adds nothing at all when nothing is filtered', () => {
    const sql = filterSql(NO_FILTERS, 4);
    expect(sql.where).toBe('');
    expect(sql.params).toEqual([]);
    expect(sql.lenientWhere).toBe('');
  });

  it('starts at the placeholder after the bbox', () => {
    const sql = filterSql({ ...NO_FILTERS, amenities: ['shower'] }, 4);
    expect(sql.where).toBe(" AND amenities ->> $5 = 'yes'");
    expect(sql.params).toEqual(['shower']);
  });

  it('numbers types and amenities in one continuous run', () => {
    const sql = filterSql(
      { types: ['free'], amenities: ['shower', 'wifi'], includeUnknown: false },
      4,
    );
    expect(sql.where).toContain('$5::text[]');
    expect(sql.where).toContain("amenities ->> $6 = 'yes'");
    expect(sql.where).toContain("amenities ->> $7 = 'yes'");
    expect(sql.params).toEqual([['free'], 'shower', 'wifi']);
  });

  // 🔴 The count query passes both parameter lists to one statement, so
  // the lenient placeholders must not collide with the strict ones.
  it('continues the lenient placeholders after the strict ones', () => {
    const sql = filterSql({ ...NO_FILTERS, amenities: ['shower', 'wifi'] }, 4);
    expect(sql.params).toHaveLength(2);
    expect(sql.lenientWhere).toContain('$7');
    expect(sql.lenientWhere).toContain('$8');
    expect(sql.lenientWhere).not.toContain('$5');
    expect(sql.lenientParams).toEqual(['shower', 'wifi']);
  });

  it('asks a different question when the reader opted into unknowns', () => {
    const strict = filterSql({ ...NO_FILTERS, amenities: ['shower'] }, 4);
    const loose = filterSql(
      { ...NO_FILTERS, amenities: ['shower'], includeUnknown: true },
      4,
    );
    expect(strict.where).toContain("= 'yes'");
    expect(loose.where).toContain("IS DISTINCT FROM 'no'");
  });

  // A row written before an amenity existed has no such key, and `->>`
  // answers NULL. `!= 'no'` would drop it; IS DISTINCT FROM keeps it.
  it('uses a NULL-safe comparison, so rows predating an amenity survive', () => {
    const loose = filterSql(
      { ...NO_FILTERS, amenities: ['greyWater'], includeUnknown: true },
      4,
    );
    expect(loose.where).toContain('IS DISTINCT FROM');
    expect(loose.where).not.toMatch(/<>|!=/);
  });

  it('never leaves a filter value inline in the SQL text', () => {
    const sql = filterSql(
      { types: ['free', 'paid'], amenities: ['shower'], includeUnknown: false },
      4,
    );
    for (const value of ['free', 'paid', 'shower']) {
      expect(sql.where).not.toContain(value);
    }
  });

  it('skips the lenient question when no amenity is filtered', () => {
    const sql = filterSql({ ...NO_FILTERS, types: ['wild'] }, 4);
    expect(sql.where).not.toBe('');
    expect(sql.lenientWhere).toBe('');
    expect(sql.lenientParams).toEqual([]);
  });
});

describe('describeFilters', () => {
  it('says "none" rather than an empty string', () => {
    expect(describeFilters(NO_FILTERS)).toBe('none');
  });

  it('names every part that was asked for', () => {
    expect(
      describeFilters({
        types: ['wild'],
        amenities: ['toilets'],
        includeUnknown: true,
      }),
    ).toBe('types=wild amenities=toilets unknown=included');
  });
});
