import { UPSERT_SPOT_SQL } from './import-spots';

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
