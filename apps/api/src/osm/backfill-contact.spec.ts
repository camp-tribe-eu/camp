import { BACKFILL_SQL } from './backfill-contact';

describe('the contact backfill (CAMP-141)', () => {
  it('🔴 writes content_changed_at, not only contact', () => {
    // The defect this file caused: 10 637 pages gained a contact block
    // and kept the previous import's date, so <lastmod> said nothing had
    // changed on exactly the pages the work existed to improve. Worse,
    // it was permanent — the next import computes the same contact, the
    // upsert's CASE sees no difference, and the date never moves.
    expect(BACKFILL_SQL).toMatch(/content_changed_at\s*=\s*now\(\)/);
  });

  it('🔴 does not restamp a page whose contact did not change', () => {
    // Without this the script is not idempotent: every rerun would bump
    // <lastmod> on 10 000 pages that did not change, which teaches a
    // crawler the field is noise — the same harm from the other side.
    expect(BACKFILL_SQL).toMatch(/contact\s+IS DISTINCT FROM\s+\$2/);
  });

  it('touches exactly one table and two columns', () => {
    // The whole reason this exists instead of running import-spots.ts:
    // that marks every campsite absent from the current extract as
    // missing. Anything else appearing in this statement is that bug
    // coming back in through the side door.
    expect(BACKFILL_SQL).toMatch(/^UPDATE camping_spots\b/);
    for (const forbidden of [
      'missing_since',
      'last_seen_at',
      'sources',
      'owner_overrides',
      'slug',
      'name',
      'location',
      'website',
    ]) {
      expect(`${forbidden}:${BACKFILL_SQL.includes(forbidden)}`).toBe(
        `${forbidden}:false`,
      );
    }
  });

  it('matches on osm_ref, which is what joins us to the extract', () => {
    expect(BACKFILL_SQL).toMatch(/WHERE osm_ref = \$1/);
  });
});
