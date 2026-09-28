import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UPSERT_SPOT_SQL } from '../osm/import-spots';
import { LINKED_SECONDARY_JOIN, mergeLinked, notSecondarySql } from './links';

/**
 * 🔴 The test that protects the whole card.
 *
 * The card's second requirement is that the link survives the weekly
 * import, and names the failure mode: a link stored where the import
 * overwrites it vanishes silently. This repository has already had that
 * failure twice with columns that should not have been in the upsert's
 * DO UPDATE list, and both times the symptom was invisible.
 *
 * Putting the link in its own table means the upsert CANNOT reach it —
 * but only while the upsert stays a statement about `camping_spots`. The
 * day somebody adds a join or a second statement to that file, this is
 * what says no.
 *
 * `verify-links.ts` proves the same thing the other way round, by
 * actually running the import against a linked row and rolling back. A
 * static check and a rehearsal answer different questions: this one runs
 * in CI with no database, that one catches a change in Postgres's
 * behaviour rather than in ours.
 */
describe('the weekly import cannot touch a link', () => {
  it('never mentions spot_links', () => {
    expect(UPSERT_SPOT_SQL).not.toContain('spot_links');
  });

  it('still upserts on osm_ref, which is what keeps the row id stable', () => {
    // A link points at camping_spots.id. If the import ever started
    // inserting a new row instead of updating the existing one, every
    // link would be left pointing at an abandoned row and the pages
    // would split again with nothing to show for it.
    expect(UPSERT_SPOT_SQL).toContain('ON CONFLICT (osm_ref)');
  });

  it('does not delete anything', () => {
    const src = readFileSync(
      join(__dirname, '..', 'osm', 'import-spots.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/DELETE\s+FROM\s+camping_spots/i);
  });
});

/**
 * 🔴 The card's first requirement, asserted against the source rather
 * than trusted: nothing is deleted, by this work or by the import.
 */
describe('the reconciler only ever writes links', () => {
  const src = readFileSync(join(__dirname, 'reconcile-sources.ts'), 'utf8');

  it('never deletes a campsite', () => {
    expect(src).not.toMatch(/DELETE\s+FROM\s+camping_spots/i);
  });

  it('never updates a campsite', () => {
    expect(src).not.toMatch(/UPDATE\s+camping_spots/i);
  });

  it('writes to exactly one table', () => {
    const writes = src.match(/INSERT\s+INTO\s+(\w+)/gi) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w.toLowerCase()).toContain('spot_links');
  });
});

describe('notSecondarySql', () => {
  it('asks about live links only, so an undo takes effect at once', () => {
    expect(notSecondarySql('s')).toContain('l.unlinked_at IS NULL');
  });

  it('is written against the alias it is given', () => {
    expect(notSecondarySql('foo')).toContain('l.secondary_id = foo.id');
    expect(notSecondarySql('foo')).not.toContain('s.id');
  });

  it('hides the secondary, never the primary', () => {
    // If this were ever inverted, every merged campsite would disappear
    // from the site and the duplicates would be the only thing left.
    expect(notSecondarySql('s')).toContain('secondary_id');
    expect(notSecondarySql('s')).not.toContain('primary_id');
  });
});

describe('LINKED_SECONDARY_JOIN', () => {
  it('never brings the other row‘s location, amenities or slug', () => {
    // The page's URL and its geometry are the primary's, always. A join
    // that offered these would let a later edit pick one up by accident.
    for (const forbidden of ['location', 'amenities', 'slug', 'region']) {
      expect(LINKED_SECONDARY_JOIN).not.toContain(`x.${forbidden}`);
    }
  });

  it('reads only live links', () => {
    expect(LINKED_SECONDARY_JOIN).toContain('l.unlinked_at IS NULL');
  });
});

describe('mergeLinked', () => {
  const osm = {
    slug: 'les-2-rivieres',
    name: 'Les 2 Rivières',
    stars: null,
    description: null,
    description_lang: null,
    website: null,
    contact: { phone: '+33 5 65 60 00 27' },
    owner_overrides: {},
    sources: [
      { id: 'osm', ref: 'a216', updatedAt: '2026-09-24', fields: ['name'] },
    ],
  };
  const fromOther = {
    linked_name: 'Camping 2 Rivières',
    linked_stars: 3,
    linked_description: 'Camping traditionnel…',
    linked_description_lang: 'fr',
    linked_website: 'https://www.camping2rivieresmillau.fr/',
    linked_contact: {},
    linked_owner_overrides: {},
    linked_sources: [
      {
        id: 'datatourisme',
        ref: 'https://data.datatourisme.fr/31/3b36',
        updatedAt: '2026-04-24',
        fields: ['stars', 'description', 'name', 'website', 'location'],
      },
    ],
  };

  it('leaves an unlinked row exactly as it found it', () => {
    expect(mergeLinked({ ...osm })).toEqual(osm);
  });

  it('takes the star rating the other source has and this one cannot', () => {
    expect(mergeLinked({ ...osm, ...fromOther }).stars).toBe(3);
  });

  it('keeps its own name rather than the other spelling', () => {
    // The page is at a URL built from this name. Gap-filling, never
    // overwriting — the rule the DATAtourisme importer already states.
    expect(mergeLinked({ ...osm, ...fromOther }).name).toBe('Les 2 Rivières');
  });

  it('carries the language along with the description it belongs to', () => {
    const merged = mergeLinked({ ...osm, ...fromOther });
    expect(merged.description).toBe('Camping traditionnel…');
    expect(merged.description_lang).toBe('fr');
  });

  it('keeps its own description AND its own language when it has one', () => {
    const merged = mergeLinked({
      ...osm,
      description: 'ours',
      description_lang: 'sl',
      ...fromOther,
    });
    expect(merged.description).toBe('ours');
    expect(merged.description_lang).toBe('sl');
  });

  it('attributes the other source for what the page reuses, and no more', () => {
    // 🔴 `location` and `name` are in that source's own field list and
    // must NOT survive into the page's attribution: the point shown is
    // OSM's and the name shown is OSM's.
    const merged = mergeLinked({ ...osm, ...fromOther });
    const sources = merged.sources as { id: string; fields: string[] }[];
    expect(sources.map((s) => s.id)).toEqual(['osm', 'datatourisme']);
    expect(sources[1].fields.sort()).toEqual([
      'description',
      'stars',
      'website',
    ]);
  });

  it('drops a source that contributed nothing to this page', () => {
    const merged = mergeLinked({
      ...osm,
      stars: 4,
      description: 'ours',
      website: 'https://ours.example',
      ...fromOther,
      linked_contact: {},
    });
    const sources = merged.sources as { id: string }[];
    expect(sources.map((s) => s.id)).toEqual(['osm']);
  });

  it('never loses an owner correction made on the other row', () => {
    const merged = mergeLinked({
      ...osm,
      ...fromOther,
      linked_owner_overrides: { name: 'what the owner says' },
    });
    expect(merged.owner_overrides).toEqual({ name: 'what the owner says' });
  });

  it('lets this row‘s owner correction win a conflict', () => {
    const merged = mergeLinked({
      ...osm,
      owner_overrides: { name: 'ours' },
      ...fromOther,
      linked_owner_overrides: { name: 'theirs', stars: 5 },
    });
    expect(merged.owner_overrides).toEqual({ name: 'ours', stars: 5 });
  });

  it('fills a missing name from the other row and says where it came from', () => {
    const merged = mergeLinked({ ...osm, name: null, ...fromOther });
    expect(merged.name).toBe('Camping 2 Rivières');
    const sources = merged.sources as { id: string; fields: string[] }[];
    expect(sources[1].fields).toContain('name');
  });
});
