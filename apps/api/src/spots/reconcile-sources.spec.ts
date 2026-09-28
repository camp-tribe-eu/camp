import { complements, proposeLinks } from './reconcile-sources';
import type { PairRow, SpotRow } from './reconcile-sources';

function row(over: Partial<SpotRow> & { id: string }): SpotRow {
  return {
    osm_ref: null,
    name: null,
    lat: 44.1,
    lon: 3.08,
    slug: over.id,
    country: 'FR',
    stars: null,
    has_contact: false,
    website: null,
    email: null,
    has_description: false,
    ...over,
  };
}

/** Metres east, roughly, at 44°N. */
const east = (m: number) =>
  3.08 + m / (111_320 * Math.cos((44.1 * Math.PI) / 180));

describe('proposeLinks', () => {
  const osm = row({ id: 'osm-1', osm_ref: 'a216', name: 'Les 2 Rivières' });
  const other = row({
    id: 'dt-1',
    name: 'Camping 2 Rivières',
    lon: east(71),
    stars: 3,
  });
  const pair: PairRow = { a: osm, b: other, metres: 71 };

  it('links a pair the shared matcher calls the same campsite', () => {
    const out = proposeLinks([pair], new Set());
    expect(out.link).toHaveLength(1);
    expect(out.review).toHaveLength(0);
  });

  it('always makes the OSM row the primary, whichever side it arrived on', () => {
    // 🔴 The direction is what makes a chain impossible: an OSM row can
    // never be a secondary, so the read side never walks more than one
    // hop. Swapping the sides of the pair must not change it.
    for (const p of [pair, { a: other, b: osm, metres: 71 } as PairRow]) {
      const out = proposeLinks([p], new Set());
      expect(out.link[0].primary.id).toBe('osm-1');
      expect(out.link[0].secondary.id).toBe('dt-1');
    }
  });

  it('leaves a pair the matcher is unsure about for a person', () => {
    const far = { ...other, lon: east(250) };
    const out = proposeLinks([{ a: osm, b: far, metres: 250 }], new Set());
    expect(out.link).toHaveLength(0);
    expect(out.review).toHaveLength(1);
  });

  it('keeps two differently named campsites apart', () => {
    const elsewhere = row({
      id: 'dt-2',
      name: 'Camping du Viaduc',
      lon: east(60),
    });
    const out = proposeLinks([{ a: osm, b: elsewhere, metres: 60 }], new Set());
    expect(out.link).toHaveLength(0);
    expect(out.apart).toBe(1);
  });

  it('chooses between two candidates instead of linking both', () => {
    // 🔴 Asked pair by pair, the matcher would happily call two
    // different OSM rows "the same campsite as this one" and we would
    // write two links for one row — which the unique index would then
    // reject halfway through a run. Grouping is what prevents it.
    const decoy = row({
      id: 'osm-2',
      osm_ref: 'a999',
      name: 'Les 2 Rivières',
      lon: east(30),
    });
    const out = proposeLinks(
      [pair, { a: decoy, b: other, metres: 41 }],
      new Set(),
    );
    expect(out.link).toHaveLength(1);
  });

  it('never re-proposes a pair the table has already judged', () => {
    // 🔴 Including one a person has UNDONE. If the reconciler put a
    // rejected link back on its next run, the undo would last until
    // Monday and "reversible" would be a word rather than a property.
    const out = proposeLinks([pair], new Set(['osm-1|dt-1']));
    expect(out.link).toHaveLength(0);
    expect(out.alreadyJudged).toBe(1);
  });

  it('does not link a row to itself through a duplicate pair', () => {
    const out = proposeLinks([pair, pair], new Set());
    expect(out.link).toHaveLength(1);
  });
});

describe('complements', () => {
  const make = (primary: Partial<SpotRow>, secondary: Partial<SpotRow>) => ({
    primary: row({ id: 'a', osm_ref: 'a1', ...primary }),
    secondary: row({ id: 'b', ...secondary }),
    metres: 50,
    similarity: 1,
    why: '',
  });

  it('sees the case the card is about: contacts here, stars there', () => {
    const c = complements(make({ has_contact: true }, { stars: 3 }));
    expect(c.gains).toBe(true);
    expect(c.bothContactAndStars).toBe(true);
  });

  it('counts a website as a way of being reachable', () => {
    const c = complements(make({ website: 'https://x.fr' }, { stars: 3 }));
    expect(c.bothContactAndStars).toBe(true);
  });

  it('says a pair gains nothing when neither side holds anything', () => {
    const c = complements(make({}, {}));
    expect(c.gains).toBe(false);
    expect(c.bothContactAndStars).toBe(false);
  });
});
