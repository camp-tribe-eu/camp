import { WEBCAM_LIMIT, WEBCAM_RADIUS_M, nearbyWebcamsSql } from './nearby';

// CAMP-190: this file had no spec at all, and review said so.
//
// 🔴 The radius, the limit and the ORDER are decided here and nowhere
// else, and each of them is a promise the page makes out loud: "no
// public webcam within 25 km", three cards, nearest first. Every
// assertion below was checked by deleting or changing the clause it
// names and watching this file go red.
//
// 🔴 The guards at the top of `nearbyWebcamsSql` are the reason the
// interpolation is safe. `radiusM` and `limit` go into the SQL as bare
// numbers, so "is it an integer" is not a tidiness check — it is the
// only thing between a caller and an injected string.

/** The SQL with its whitespace collapsed, so layout is not asserted. */
const flat = (sql: string): string => sql.replace(/\s+/g, ' ');

describe('nearbyWebcamsSql', () => {
  const sql = nearbyWebcamsSql('s.location');

  it('searches the radius the page prints', () => {
    expect(sql).toContain(`ST_DWithin(s.location, c.location, ${WEBCAM_RADIUS_M})`);
    // The number the campsite page renders lives in apps/web and is tied
    // to this one by scripts/ci/check-webcam-radius.mjs, which is where
    // both files can be read at once.
    expect(WEBCAM_RADIUS_M).toBe(25_000);
  });

  it('offers three, not the whole catalogue', () => {
    expect(WEBCAM_LIMIT).toBe(3);
    expect(flat(sql)).toContain(`LIMIT ${WEBCAM_LIMIT}`);
  });

  it('orders by distance with `ref` breaking ties, in BOTH orderings', () => {
    // 🔴 Two of them, and the second is not decoration: the inner query
    // picks WHICH rows by the KNN operator, and the aggregate decides
    // what order they are written in. A build that is not reproducible
    // reports as a change nobody made, in the duplicate-page and visual
    // guards at once.
    expect(flat(sql)).toContain('json_agg(w ORDER BY w.metres, w.ref)');
    expect(flat(sql)).toContain('ORDER BY s.location <-> c.location, c.ref');
  });

  it('measures the distance it returns, rather than trusting the index', () => {
    expect(flat(sql)).toContain(
      'round(ST_Distance(s.location, c.location))::int AS metres',
    );
  });

  it('never selects an image column, because there is none to select', () => {
    // The bytes are Windy's and are served from their CDN under their
    // terms. A column here would be a copy.
    expect(sql).not.toMatch(/\bimage\b/i);
  });

  it('answers an empty array rather than null when nothing is near', () => {
    // A null would reach the page as "unknown" and the panel would have
    // to guess which of its two empty sentences to print.
    expect(flat(sql)).toContain(`coalesce(json_agg`);
    expect(flat(sql)).toContain(`'[]'::json`);
  });

  it('takes the location expression from the caller, once per use', () => {
    const sql2 = nearbyWebcamsSql('x.geom');
    expect(sql2).toContain('ST_DWithin(x.geom, c.location');
    expect(sql2).not.toContain('s.location');
  });

  describe('refuses anything that is not a plain positive integer', () => {
    // 🔴 These go into the SQL unquoted. Each case below is a value that
    // would otherwise be pasted into the statement verbatim.
    const bad: [string, unknown][] = [
      ['a decimal', 25_000.5],
      ['zero', 0],
      ['a negative', -1],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
      ['a numeric string', '25000' as unknown],
      ['an injected string', '0); DROP TABLE webcams; --' as unknown],
      ['null', null as unknown],
      ['undefined passed explicitly as a number', Number.NaN],
    ];

    for (const [name, value] of bad) {
      it(`radius: ${name}`, () => {
        expect(() => nearbyWebcamsSql('s.location', value as number)).toThrow(
          /webcam radius must be a positive integer/,
        );
      });
      it(`limit: ${name}`, () => {
        expect(() =>
          nearbyWebcamsSql('s.location', WEBCAM_RADIUS_M, value as number),
        ).toThrow(/webcam limit must be a positive integer/);
      });
    }

    it('and accepts the honest values either side of the defaults', () => {
      expect(() => nearbyWebcamsSql('s.location', 1, 1)).not.toThrow();
      expect(nearbyWebcamsSql('s.location', 5_000, 2)).toContain('c.location, 5000');
      expect(flat(nearbyWebcamsSql('s.location', 5_000, 2))).toContain('LIMIT 2');
    });
  });
});
