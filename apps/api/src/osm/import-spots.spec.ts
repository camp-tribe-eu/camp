import { dedupe, UPSERT_SPOT_SQL } from './import-spots';

// CAMP-28. The upsert is the whole card, and its two most important
// properties are things it must NOT do. Both are one careless line away,
// and neither would throw - they would just quietly destroy work:
//
//   slug             following the OSM name would change the URL every
//                    time a mapper renames a campsite, throwing away the
//                    links and rankings that page had earned (CAMP-87).
//
//   owner_overrides  belongs to the campsite owner (CAMP-86). A weekly job
//                    rewriting it would erase their corrections and they
//                    would never be told why.
describe('the weekly upsert', () => {
  const doUpdate = UPSERT_SPOT_SQL.slice(
    UPSERT_SPOT_SQL.indexOf('DO UPDATE SET'),
  );

  it('upserts on the stable OSM id, not on a row counter', () => {
    expect(UPSERT_SPOT_SQL).toContain('ON CONFLICT (osm_ref)');
  });

  it('never overwrites the slug', () => {
    expect(doUpdate).not.toMatch(/\bslug\s*=/);
  });

  it("never overwrites the owner's corrections", () => {
    expect(doUpdate).not.toMatch(/\bowner_overrides\s*=/);
  });

  it('does refresh the fields that come from OSM', () => {
    for (const field of ['name', 'type', 'amenities', 'location']) {
      expect(doUpdate).toMatch(new RegExp(`\\b${field}\\s*=`));
    }
  });

  it('clears missing_since so a returning campsite comes back', () => {
    // A site deleted in OSM by mistake usually reappears within a week.
    expect(doUpdate).toMatch(/missing_since\s*=\s*NULL/);
  });
});

describe('dedupe (CAMP-71)', () => {
  const row = (
    osm_ref: string,
    lon: number,
    lat: number,
    tags: Record<string, string>,
  ) => ({
    osm_ref,
    point_wkt: `POINT(${lon} ${lat})`,
    admin_region: 'Bovec',
    admin_country: 'SI',
    tags,
  });

  it('merges a node into the way of the same campsite', () => {
    const out = dedupe([
      row('n1', 14.0, 46.0, { name: 'Camp Bovec', shower: 'yes' }),
      row('w2', 14.0002, 46.0001, { name: 'Camp Bovec', wifi: 'yes' }),
    ]);
    expect(out).toHaveLength(1);
    // The way wins — it carries the footprint the page is meant to draw.
    expect(out[0].osm_ref).toBe('w2');
    // ...but the node's tags are not thrown away with it.
    expect(out[0].tags.shower).toBe('yes');
    expect(out[0].tags.wifi).toBe('yes');
  });

  it('keeps the winner own tag when both carry the same key', () => {
    const out = dedupe([
      row('n1', 14.0, 46.0, { name: 'X', wifi: 'no' }),
      row('w2', 14.0, 46.0, { name: 'X', wifi: 'yes' }),
    ]);
    expect(out[0].tags.wifi).toBe('yes');
  });

  it('does not merge identically named sites that are far apart', () => {
    // "Camping Municipal" repeats across a whole country; distance is the
    // only thing separating a duplicate from a namesake.
    const out = dedupe([
      row('n1', 14.0, 46.0, { name: 'Camping Municipal' }),
      row('n2', 14.5, 46.5, { name: 'Camping Municipal' }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('merges unnamed sites that are metres apart', () => {
    // Measured: 54 unnamed pairs sit within 50 m, 39 of them an area and
    // the way it was built from, averaging 19 m. That is `osmium export`
    // emitting one outline twice, not two campsites.
    const out = dedupe([
      row('w1', 14.0, 46.0, {}),
      row('a2', 14.0001, 46.0001, {}),
    ]);
    expect(out).toHaveLength(1);
  });

  it('🔴 leaves unnamed sites beyond the tight radius alone', () => {
    // ~120 m apart. Without a name there is no second signal, so the
    // radius is the only guard and it stays a quarter of the named one.
    const out = dedupe([
      row('n1', 14.0, 46.0, {}),
      row('n2', 14.0, 46.00108, {}),
    ]);
    expect(out).toHaveLength(2);
  });

  it('leaves a unique campsite untouched', () => {
    const out = dedupe([row('w9', 13.5, 46.3, { name: 'Solo' })]);
    expect(out).toHaveLength(1);
    expect(out[0].osm_ref).toBe('w9');
  });
});

describe('🔴 dedupe is deterministic (CAMP-39)', () => {
  const row = (osm_ref: string, lon: number, lat: number, tags = {}) => ({
    osm_ref,
    point_wkt: `POINT(${lon} ${lat})`,
    admin_region: 'Bled',
    admin_country: 'SI',
    tags,
  });

  // Two polygons, same name, same tag count, 18 m apart — the real
  // Camping Bled. Nothing but osm_ref can separate them.
  const pair = () => [
    row('w460186862', 14.0779, 46.3608, { name: 'Camping Bled' }),
    row('a920373724', 14.0781, 46.3609, { name: 'Camping Bled' }),
  ];

  it('picks the same winner whatever order the rows arrive in', () => {
    // Input order comes from Postgres, which does not guarantee it. When
    // the winner depended on it, the published URL flipped between
    // /camping-bled and /camping-bled-2 on consecutive imports of
    // identical data — silent URL churn, every Monday.
    const forward = dedupe(pair());
    const reversed = dedupe(pair().reverse());
    expect(forward).toHaveLength(1);
    expect(reversed).toHaveLength(1);
    expect(forward[0].osm_ref).toBe(reversed[0].osm_ref);
  });

  it('picks the same winner for unnamed pairs too', () => {
    const unnamed = () => [
      row('w1266747456', 14.0779, 46.3608),
      row('a2533494912', 14.0781, 46.3609),
    ];
    expect(dedupe(unnamed())[0].osm_ref).toBe(
      dedupe(unnamed().reverse())[0].osm_ref,
    );
  });

  it('still prefers the polygon over the node regardless of order', () => {
    const mixed = () => [
      row('n111', 14.0779, 46.3608, { name: 'X' }),
      row('w222', 14.0781, 46.3609, { name: 'X' }),
    ];
    expect(dedupe(mixed())[0].osm_ref).toBe('w222');
    expect(dedupe(mixed().reverse())[0].osm_ref).toBe('w222');
  });
});
