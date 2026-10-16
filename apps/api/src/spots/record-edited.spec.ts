import type { DataSource } from 'typeorm';
import { SPOT_DETAIL_SQL } from './detail-query';
import { SpotsService } from './spots.service';

// CAMP-256 — how the campsite page's query result becomes the `SpotView`
// the page reads: the OSM edit date goes through under its OWN name, and the
// other date stays the other date.
//
// 🔴 TWO DATES, YEARS APART, ON ONE ROW. `last_seen_at` is the day our
// importer last found the place (5 days before the notional "today" below);
// `osm_record_edited_at` is the day a mapper last edited it (2019). A mapper
// that reached for the wrong column — the one mistake this card is most
// likely to ship, because it looks like success — would hand the page a
// 2026 date under a 2019 label. Every expected value is typed.

const row = (extra: Record<string, unknown>) => ({
  slug: 'campingplatz-pichlingersee',
  name: 'Campingplatz Pichlingersee',
  country: 'AT',
  region: 'Oberösterreich',
  type: 'paid',
  lat: 48.2353,
  lon: 14.3797,
  amenities: {},
  owner_overrides: {},
  last_seen_at: new Date('2026-10-15T19:36:02.200Z'),
  missing_since: null,
  context: {},
  sources: [],
  ...extra,
});

/** A service whose database answers every query with these rows. */
const serviceReturning = (rows: Record<string, unknown>[]) =>
  new SpotsService({
    query: async () => rows,
  } as unknown as DataSource);

const load = (r: Record<string, unknown>) =>
  serviceReturning([r]).findBySlug(
    'at',
    'oberosterreich',
    'campingplatz-pichlingersee',
  );

describe('SpotView.osmRecordEditedAt', () => {
  it('🔴 carries the EDIT date, and lastSeenAt stays the date the importer ran', async () => {
    const view = await load(
      row({ osm_record_edited_at: new Date('2019-02-15T22:19:38.000Z') }),
    );
    expect(view.osmRecordEditedAt?.toISOString()).toBe(
      '2019-02-15T22:19:38.000Z',
    );
    expect(view.lastSeenAt?.toISOString()).toBe('2026-10-15T19:36:02.200Z');
  });

  it('🔴 a row with no edit date reads null — it does not borrow lastSeenAt', async () => {
    const view = await load(row({ osm_record_edited_at: null }));
    expect(view.osmRecordEditedAt).toBeNull();
    // Anchor: the row DID have a last-seen date to borrow.
    expect(view.lastSeenAt).not.toBeNull();
  });

  it('a query that never selected the column reads null, not undefined and not another date', async () => {
    const view = await load(row({}));
    expect(view.osmRecordEditedAt).toBeNull();
  });

  it('🔴 a DATAtourisme secondary linked to an OSM primary does not overwrite or blank the edit date', async () => {
    // The shape `linkedSecondariesJoin` produces: columns prefixed
    // `linked_`, so nothing in a secondary can reach the primary's own.
    const view = await load(
      row({
        osm_record_edited_at: new Date('2019-02-15T22:19:38.000Z'),
        linked_rows: [
          {
            linked_id: '00000000-0000-0000-0000-000000000002',
            linked_stars: 3,
            linked_description: null,
            linked_description_lang: null,
            linked_website: null,
            linked_name: 'Camping Linz',
            linked_contact: {},
            linked_sources: [
              {
                id: 'datatourisme',
                ref: 'x',
                updatedAt: '2026-08-20',
                fields: ['stars'],
              },
            ],
            linked_owner_overrides: {},
            linked_content_changed_at: null,
          },
        ],
      }),
    );
    expect(view.osmRecordEditedAt?.toISOString()).toBe(
      '2019-02-15T22:19:38.000Z',
    );
    // Anchor: the merge really ran — the star rating came across.
    expect(view.stars).toBe(3);
  });
});

describe('the page query selects the edit date by its own name', () => {
  it('names osm_record_edited_at, and does not alias last_seen_at to it', () => {
    expect(SPOT_DETAIL_SQL).toMatch(/\bs\.osm_record_edited_at\b/);
    // The other date is still selected, under its own name.
    expect(SPOT_DETAIL_SQL).toMatch(/\bs\.last_seen_at\b/);
    expect(SPOT_DETAIL_SQL).not.toMatch(
      /last_seen_at\s+AS\s+osm_record_edited_at/i,
    );
  });
});
