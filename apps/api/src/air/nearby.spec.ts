import { airQualitySql } from './nearby';
import { AIR_RADIUS_M } from './source';

// CAMP-164: the read query is where the radius, the order of the three
// answers and the determinism of the page are decided, so each is
// asserted against the SQL text. Every assertion was checked by deleting
// the clause it names and watching this file go red. The BEHAVIOUR of the
// query — which of the three answers a campsite actually gets — is read
// out of the served HTML by tests/e2e/air-quality.spec.ts against a real
// PostGIS, because a string assertion cannot say what a COALESCE returns.

const flat = (sql: string): string => sql.replace(/\s+/g, ' ');

describe('airQualitySql', () => {
  const sql = airQualitySql('s.location', 's.id');
  const one = flat(sql);

  it('filters stations by the radius, in metres, on geography', () => {
    expect(one).toContain(
      `ST_DWithin(s.location::geography, st.location, ${AIR_RADIUS_M})`,
    );
  });

  it('takes the radius as an argument so a caller can measure others', () => {
    expect(flat(airQualitySql('s.location', 's.id', 500))).toContain(
      'ST_DWithin(s.location::geography, st.location, 500)',
    );
  });

  // 🔴 One station, and deterministically the same one. Two stations at
  // an identical distance without the `st.code` tiebreak swap between
  // builds and rewrite pages whose content did not change.
  it('takes one station, totally ordered', () => {
    expect(one).toContain(
      'ORDER BY s.location::geography <-> st.location, st.code LIMIT 1',
    );
  });

  // 🔴 THE THREE ANSWERS, IN ORDER: a station, else the model, else none.
  it('falls from a station to the model to an explicit none, in that order', () => {
    const station = one.indexOf("'kind', 'station'");
    const modelled = one.indexOf("'kind', 'modelled'");
    const none = one.indexOf("json_build_object('kind', 'none')");
    expect(station).toBeGreaterThan(-1);
    expect(modelled).toBeGreaterThan(station);
    expect(none).toBeGreaterThan(modelled);
    expect(one).toMatch(
      /SELECT COALESCE\( \(SELECT json_build_object\( 'kind', 'station'/,
    );
  });

  // 🔴 A SILENT STATION IS STILL THE ANSWER. If the station subquery
  // filtered on `reading_hour IS NOT NULL`, a campsite whose nearest
  // station had stopped reporting would fall through to the model and the
  // page would never say "no fresh data" about the station that is not
  // reporting — the card's third requirement, quietly turned into a
  // model value.
  it('does not skip a station that has no reading', () => {
    const stationPart = one.slice(0, one.indexOf("'kind', 'modelled'"));
    // 🔴 Keyed to the EFFECT, not to one column name. Until CAMP-195 this
    // named `reading_hour` and `WHERE st.reading` literally, so the very
    // same mutation written against a sibling column — `AND
    // st.reading_basis IS NOT NULL` — passed 13/13 green while the 33
    // campsites around the silent fixture station went from
    // "No fresh data." to "No air-quality data". Any reading column will
    // do it, so the column name is the wrong thing to name.
    //
    // 🔴 But four spellings is still four spellings, not "the shape" —
    // the first version of this comment claimed the latter and was wrong.
    // SQL has more ways to drop a NULL row than a list can hold. The
    // honest statement: the four below are the forms we have actually
    // seen or been bitten by, this test exists to fail FIRST and name the
    // rule, and the net that cannot be out-spelled is the e2e against
    // served HTML — apps/web/tests/e2e/air-quality.spec.ts:254, which
    // counts silent stations on real pages (`silent.length > 5`) and runs
    // ungated in ci.yml:590.
    //
    // `IS NULL` inside the CASE below is the honest use and must survive.
    expect(stationPart).not.toMatch(/\breading_\w+\s+IS\s+NOT\s+NULL/i);
    // 🔴 `IS NOT NULL` is one spelling of the ban, not the ban. Review of
    // this PR caught the first version DROPPING the line below while
    // claiming to generalise it — and `WHERE st.reading_hour >
    // '1970-01-01'` filters the silent station out just as thoroughly
    // without ever writing `IS NOT NULL`. Measured: main caught it, the
    // generalised-but-narrower version did not. Station 3 in the fixture
    // has `hours_ago NULL`, so `NULL > …` is unknown, the row drops, and
    // the campsite falls through to the model.
    expect(stationPart).not.toContain('WHERE st.reading');
    expect(stationPart).not.toMatch(/\bNOT\s+st\.reading_\w+\s+IS\s+NULL/i);
    expect(stationPart).not.toMatch(
      /\bst\.reading_\w+\s*(?:>=|<=|<>|!=|>|<|=)/i,
    );
    // The real net under this one is the e2e against served HTML
    // (apps/web/tests/e2e/air-quality.spec.ts:256, `silent.length > 5`),
    // which counts silent stations on real pages and cannot be fooled by
    // a rename. This test exists to fail first and say why.
    expect(stationPart).toContain(
      "'reading', CASE WHEN st.reading_hour IS NULL THEN NULL",
    );
  });

  it('reads the model by campsite id', () => {
    expect(one).toContain('FROM air_quality_modelled m WHERE m.spot_id = s.id');
  });

  it('takes the campsite expressions it is given', () => {
    const other = flat(airQualitySql('linked.location', 'linked.id'));
    expect(other).toContain('ST_DWithin(linked.location::geography');
    expect(other).toContain('m.spot_id = linked.id');
    expect(other).not.toContain('s.location');
  });

  // Everything the page prints about a station and a reading must be
  // selected here — the page cannot print what the query never fetched.
  it('selects the name, kind and distance of the station', () => {
    expect(one).toContain("'name', st.name");
    expect(one).toContain("'type', st.station_type");
    expect(one).toContain(
      "'metres', round(ST_Distance(s.location::geography, st.location))::int",
    );
    expect(one).toContain("'municipality', st.municipality");
  });

  it('selects the hour, level, basis, culprit and pollutants of the reading', () => {
    expect(one).toContain("'band', st.reading_band");
    expect(one).toContain("'basis', st.reading_basis");
    expect(one).toContain("'culprit', st.reading_culprit");
    expect(one).toContain("'pollutants', st.reading_pollutants");
    expect(one).toContain("'hour', to_char(st.reading_hour AT TIME ZONE 'UTC'");
  });

  // 🔴 Every timestamp the page prints is UTC, spelled one way. A
  // timestamptz inside json_build_object comes out in the SERVER's zone
  // and the page would print an hour that is not the hour reported.
  it('spells every timestamp as ISO 8601 UTC', () => {
    const stamps = [
      ...one.matchAll(
        /to_char\(([^)]*?) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'\)/g,
      ),
    ].map((m) => m[1]);
    expect(stamps).toEqual([
      'st.reading_hour',
      'st.read_at',
      'm.hour',
      'm.read_at',
    ]);
  });

  // 🔴 No clock. A query whose output changes with the time of day
  // rewrites a statically built site whenever it is run — and freshness
  // is not this query's to decide.
  it('has no clock in it', () => {
    expect(sql).not.toMatch(
      /now\(\)|CURRENT_DATE|CURRENT_TIMESTAMP|clock_timestamp/i,
    );
  });

  it('is a scalar subquery, so it can sit in a SELECT list', () => {
    expect(sql.trim().startsWith('(')).toBe(true);
    expect(sql.trim().endsWith(')')).toBe(true);
  });
});

describe('AIR_RADIUS_M', () => {
  // 🔴 The number the measurement in source.ts argues for. If somebody
  // moves it, the comment stops describing the code and this is the
  // thing that says so.
  it('is 15 km', () => {
    expect(AIR_RADIUS_M).toBe(15_000);
  });
});
