import {
  assignOneToOne,
  buildCandidateSql,
  MATCH_CANDIDATES,
  MATCH_RADIUS_M,
  type MatchCandidate,
} from './match';

// CAMP-154 — which forecourt gets which price.
//
// 🔴 THIS IS THE FILE WHOSE BUGS LOOK RIGHT.
//
// A missing price is visible: the row says we hold none. A price on the
// WRONG forecourt is invisible — it is a real number, from a real
// ministry, under a real station name, and nothing on the page can tell
// a reader it belongs to the garage across the roundabout. So the tests
// here are about the failure that leaves no trace.

const c = (
  stationKey: string,
  osmRef: string,
  metres: number,
): MatchCandidate => ({
  stationKey,
  osmRef,
  metres,
});

describe('🔴 one point, one price', () => {
  // Two source stations either side of a dual carriageway, one OSM node
  // between them. Without an assignment rule both claim it and the page
  // shows whichever the planner returned first.
  it('gives a contested point to the nearer station and drops the other', () => {
    const out = assignOneToOne([
      c('es-minetur:A', 'n1', 12),
      c('es-minetur:B', 'n1', 80),
    ]);
    expect(out).toEqual([
      { stationKey: 'es-minetur:A', osmRef: 'n1', metres: 12 },
    ]);
  });

  it('lets the loser take its second choice rather than nothing', () => {
    const out = assignOneToOne([
      c('es-minetur:A', 'n1', 12),
      c('es-minetur:B', 'n1', 80),
      c('es-minetur:B', 'n2', 95),
    ]);
    expect(out).toEqual([
      { stationKey: 'es-minetur:A', osmRef: 'n1', metres: 12 },
      { stationKey: 'es-minetur:B', osmRef: 'n2', metres: 95 },
    ]);
  });

  it('never gives one station two points', () => {
    const out = assignOneToOne([
      c('it-mimit:A', 'n1', 5),
      c('it-mimit:A', 'n2', 6),
    ]);
    expect(out).toHaveLength(1);
  });

  it('never gives one point to two stations, however many compete', () => {
    const out = assignOneToOne([
      c('fr-data-economie:A', 'w9', 30),
      c('fr-data-economie:B', 'w9', 31),
      c('fr-data-economie:C', 'w9', 32),
      c('fr-data-economie:D', 'w9', 33),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].stationKey).toBe('fr-data-economie:A');
  });
});

describe('the radius is a refusal, not a preference', () => {
  // 🔴 `ORDER BY location <-> p LIMIT 1` always returns something. Over
  // Spain's 11 309 stations it would return 11 309 answers, including
  // one 40 km away on a different road, and every one of them would
  // print as that station's price.
  it('drops a candidate past the radius rather than taking the nearest', () => {
    const out = assignOneToOne([c('es-minetur:A', 'n1', MATCH_RADIUS_M + 1)]);
    expect(out).toEqual([]);
  });

  it('keeps one exactly at the radius', () => {
    const out = assignOneToOne([c('es-minetur:A', 'n1', MATCH_RADIUS_M)]);
    expect(out).toHaveLength(1);
  });

  it('is the 150 m the distance distribution was read off', () => {
    // Measured 28.09.2026 across ES/FR/IT: median gap 8.5 m, p90 56 m,
    // p99 129 m, and only 250 of 35 318 matches in the last 15 m band.
    // Raising it to 300 m would add 2 175 matches, all of them in the
    // band where the next station down the road lives.
    expect(MATCH_RADIUS_M).toBe(150);
  });
});

describe('the assignment is the same every run', () => {
  // 🔴 A coverage figure from a non-deterministic matcher is not a
  // measurement. Two candidates at exactly the same distance are not
  // rare — a source that files one coordinate for two adjacent bays
  // produces them — and a comparator that left them tied would make the
  // result depend on the order Postgres happened to return rows in.
  it('breaks an exact distance tie the same way whatever the input order', () => {
    const pairs = [
      c('es-minetur:B', 'n2', 40),
      c('es-minetur:A', 'n2', 40),
      c('es-minetur:A', 'n1', 40),
    ];
    const forward = assignOneToOne(pairs);
    const backward = assignOneToOne([...pairs].reverse());
    expect(forward).toEqual(backward);
    expect(forward).toEqual([
      { stationKey: 'es-minetur:A', osmRef: 'n1', metres: 40 },
      { stationKey: 'es-minetur:B', osmRef: 'n2', metres: 40 },
    ]);
  });

  it('does not mutate what it was given', () => {
    const pairs = [c('b', 'n2', 40), c('a', 'n1', 10)];
    assignOneToOne(pairs);
    expect(pairs[0].stationKey).toBe('b');
  });
});

describe('the candidate query', () => {
  const sql = buildCandidateSql();

  // 🔴 A partial index is only usable when the planner can PROVE the
  // query's quals imply its predicate, and it cannot prove that against
  // a parameter. The same mistake cost 9 699 ms on one route page — a
  // Seq Scan with 1 938 428 rows discarded per lookup.
  it('writes kind = fuel as a literal so the partial index is provable', () => {
    expect(sql).toContain("r.kind = 'fuel'");
    expect(sql).not.toMatch(/kind\s*=\s*\$/);
  });

  // 🔴 Along the Ventimiglia border a French station and an Italian one
  // are 300 m apart and the two feeds disagree by 20 cents, because the
  // taxes differ.
  it('will not match a station to another country’s forecourt', () => {
    expect(sql).toContain('r.country = s.country');
  });

  // 🔴 The KNN operator orders by PLANAR degrees, which is what the GiST
  // index holds; a degree of longitude is 111 km at the equator against
  // 79 km at Narbonne. So the walk overfetches and the metres that are
  // compared against the radius come from ::geography.
  it('orders by the index operator but measures in metres', () => {
    expect(sql).toContain('r.location <-> s.location');
    expect(sql).toContain(
      'ST_Distance(s.location::geography, n.location::geography)',
    );
  });

  it('takes both the candidate count and the radius as parameters', () => {
    expect(sql).toContain('LIMIT $1');
    expect(sql).toContain('<= $2');
    expect(MATCH_CANDIDATES).toBeGreaterThan(1);
  });
});
