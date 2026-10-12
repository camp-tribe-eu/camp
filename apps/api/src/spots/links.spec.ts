import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UPSERT_SPOT_SQL } from '../osm/import-spots';
import {
  attributeTaken,
  GONE_LIST_SQL,
  linkedSecondariesJoin,
  mergeAllLinked,
  mergedNameSql,
  mergedStarsSql,
  mergeLinked,
  notSecondarySql,
  REDIRECT_LIST_SQL,
  REDIRECT_PAIRS_SQL,
  RESOLVED_REDIRECTS_SQL,
  withoutTaken,
} from './links';

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

  it('hides the row that is the secondary, not the one carrying it', () => {
    // If the sides were ever swapped, every merged campsite would
    // disappear from the site and the duplicates would be all that was
    // left. The alias is what says which is which.
    expect(notSecondarySql('s')).toContain('l.secondary_id = s.id');
    expect(notSecondarySql('s')).not.toContain('l.primary_id = s.id');
  });

  it('only hides a row whose primary is itself on the site', () => {
    // 🔴 The failure this closes: OSM drops a campsite, the weekly
    // import stamps missing_since on the primary, every read query
    // filters it out — and the complete DATAtourisme row stays hidden
    // behind it. The campsite would then be on no page at all, deleted
    // from the site by a join, which is the thing this card forbids.
    const sql = notSecondarySql('s');
    expect(sql).toContain('lp.missing_since IS NULL');
    expect(sql).toContain('lp.region IS NOT NULL');
  });
});

describe('linkedSecondariesJoin', () => {
  const join = linkedSecondariesJoin();

  it('🔴 is deterministic — a total order, not a LIMIT', () => {
    // A bare LIMIT 1 picked whatever the planner returned first. With
    // two secondaries on one primary that made the star rating on a page
    // change between builds, with no error anywhere. The answer is now
    // every secondary in a fixed order, and the order is what decides
    // which value wins, so it has to be total: created_at can tie for
    // two links made in the same transaction, and the id breaks it.
    expect(join).toContain('ORDER BY l.created_at, x.id');
    expect(join).not.toContain('LIMIT 1');
  });

  it('returns every live secondary, not the first one', () => {
    expect(join).toContain('jsonb_agg');
    expect(join).toContain('l.unlinked_at IS NULL');
  });

  it('selects an id per row, so the merge can tell "none" from "no data"', () => {
    expect(join).toContain("'linked_id', x.id");
  });

  it('never brings the other row‘s location, amenities or slug', () => {
    // The page's URL and its geometry are the primary's, always. A join
    // that offered these would let a later edit pick one up by accident.
    for (const forbidden of ['location', 'amenities', 'slug', 'region']) {
      expect(join).not.toContain(`x.${forbidden}`);
    }
  });

  it('🔴 answers false, not NULL, when there is no secondary at all', () => {
    // bool_or over no rows is NULL, and `false OR NULL` is NULL. The
    // page's `indexable` would then be neither true nor false.
    expect(join).toContain('coalesce(bool_or(x.stars IS NOT NULL), false)');
    expect(join).toContain(
      'coalesce(bool_or(x.description IS NOT NULL), false)',
    );
  });

  it('evaluates per-secondary expressions against the secondary row', () => {
    // The tariffs are read once per secondary, because a price list
    // belongs to the record it was published in.
    const withTariffs = linkedSecondariesJoin({ linked_tariffs: 'f(x.id)' });
    expect(withTariffs).toContain("'linked_tariffs', f(x.id)");
    expect(join).not.toContain('linked_tariffs');
  });
});

describe('mergedFieldSql', () => {
  it('treats an empty string as absent, exactly as the JS merge does', () => {
    // 🔴 The two merges have to agree about "empty" or one campsite gets
    // two answers: the detail page (JS) shows the other source's name
    // while every listing, pin and search document (SQL) shows ''. And
    // `notable()` filters IS NOT NULL, which '' passes — a nameless card
    // on the home page.
    expect(mergedNameSql('s')).toContain("nullif(btrim(s.name), '')");
    expect(mergedNameSql('s')).toContain("nullif(btrim(x.name), '')");
  });

  it('does not btrim a number', () => {
    // A smallint has no empty string, and casting it to text and back
    // buys nothing but a chance to be wrong.
    expect(mergedStarsSql('s')).toContain('s.stars');
    expect(mergedStarsSql('s')).not.toContain('btrim');
  });

  it('reads only live links, and deterministically', () => {
    const sql = mergedStarsSql('s');
    expect(sql).toContain('l.unlinked_at IS NULL');
    expect(sql.indexOf('ORDER BY')).toBeLessThan(sql.indexOf('LIMIT 1'));
  });
});

describe('attributeTaken', () => {
  const entry = (id: string, fields: string[]) => ({
    id,
    ref: `ref-${id}`,
    updatedAt: '2026-04-24',
    fields,
  });

  it('credits a field we took that the entry never declared', () => {
    // `contact` post-dates these rows (CAMP-141), so a DATAtourisme entry
    // lists everything but. Filtering by the declared list alone dropped
    // the attribution for data the page visibly prints.
    const out = attributeTaken(
      [entry('dt', ['stars'])],
      new Set(['stars', 'contact']),
    );
    expect(out[0].fields.sort()).toEqual(['contact', 'stars']);
  });

  it('still credits an orphan when the row carries two sources', () => {
    // 🔴 The rule used to be "only when there is exactly one entry", so
    // the attribution vanished the day a secondary carried two — and
    // CAMP-128 is about to add sources. The entry that contributed
    // something is the one that gets it.
    const out = attributeTaken(
      [entry('dt', ['stars']), entry('other', ['location'])],
      new Set(['stars', 'contact']),
    );
    const dt = out.find((e) => e.id === 'dt');
    expect(dt?.fields.sort()).toEqual(['contact', 'stars']);
  });

  it('drops an entry that contributed nothing to this page', () => {
    const out = attributeTaken(
      [entry('dt', ['stars']), entry('other', ['location'])],
      new Set(['stars']),
    );
    expect(out.map((e) => e.id)).toEqual(['dt']);
  });

  it('credits the only source on the row even for a field it never declared', () => {
    // Not a hole: if the row has one source, everything on that row came
    // from it, whatever its `fields` list happens to say.
    const out = attributeTaken([entry('dt', ['location'])], new Set(['stars']));
    expect(out.map((e) => e.fields)).toEqual([['stars']]);
  });
});

describe('withoutTaken', () => {
  it('stops our own entry claiming a field the other row supplied', () => {
    // 🔴 The over-claim on the side nobody looked at: our website is
    // empty, the page prints theirs, and the OSM entry still declared
    // `website` among what it gave us.
    const out = withoutTaken(
      [
        {
          id: 'osm',
          ref: 'a1',
          updatedAt: '2026-09-24',
          fields: ['name', 'location', 'website'],
        },
      ],
      new Set(['website']),
    );
    expect(out[0].fields).toEqual(['name', 'location']);
  });

  it('keeps our entry even when nothing is left in it', () => {
    // It is our row and the reason the page exists; its licence and date
    // still apply to the location that is always ours.
    const out = withoutTaken(
      [{ id: 'osm', ref: 'a1', updatedAt: '2026-09-24', fields: ['name'] }],
      new Set(['name']),
    );
    expect(out).toHaveLength(1);
    expect(out[0].fields).toEqual([]);
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
    linked_id: 'b2b2b2b2-0000-0000-0000-000000000001',
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

  it('merges a linked row whose own sources column is null', () => {
    // 🔴 The sentinel used to be `linked_sources`, a plain nullable
    // jsonb column. A secondary with no sources meant "there is no
    // linked row", the merge was skipped in silence, and the star
    // rating — the entire point of the card — did not reach the page.
    const merged = mergeLinked({
      ...osm,
      ...fromOther,
      linked_sources: null,
    });
    expect(merged.stars).toBe(3);
    expect(merged.sources).toHaveLength(1);
  });

  it('treats an empty string from the other row as nothing', () => {
    // 🔴 Empty was checked on our side only, so `website: ''` counted as
    // a value: the page got '' where the UI expects null, AND the source
    // entry kept "website" in its field list — printing "this source
    // gave us: website" beside no website.
    const merged = mergeLinked({
      ...osm,
      ...fromOther,
      linked_website: '   ',
      linked_name: '',
    });
    expect(merged.website).toBeNull();
    expect(merged.name).toBe('Les 2 Rivières');
    const sources = merged.sources as { id: string; fields: string[] }[];
    expect(sources[1].fields).not.toContain('website');
    expect(sources[1].fields).not.toContain('name');
  });

  it('does not let our empty contact value beat their real one', () => {
    // A blank phone on our row used to win, because the KEY was present
    // — and the "what did we take" loop did not fire either, so the loss
    // was not even attributed.
    const merged = mergeLinked({
      ...osm,
      contact: { phone: '' },
      ...fromOther,
      linked_contact: { phone: '+33 1 23 45 67 89' },
    });
    expect(merged.contact).toEqual({ phone: '+33 1 23 45 67 89' });
    const sources = merged.sources as { id: string; fields: string[] }[];
    expect(sources[1].fields).toContain('contact');
  });

  it('normalises our own empty string to null when theirs is empty too', () => {
    // `'' ?? null` is `''`. Only the their-side half of the empty-string
    // fix had landed, so the page still got the value the UI cannot
    // handle.
    const merged = mergeLinked({
      ...osm,
      website: '  ',
      ...fromOther,
      linked_website: null,
    });
    expect(merged.website).toBeNull();
  });

  it('stops OUR entry claiming a field that came from theirs', () => {
    const merged = mergeLinked({
      ...osm,
      website: '',
      sources: [
        {
          id: 'osm',
          ref: 'a216',
          updatedAt: '2026-09-24',
          fields: ['name', 'website'],
        },
      ],
      ...fromOther,
    });
    const sources = merged.sources as { id: string; fields: string[] }[];
    expect(sources[0].id).toBe('osm');
    expect(sources[0].fields).not.toContain('website');
    expect(sources[1].fields).toContain('website');
  });

  it('keeps our language when neither row has a description', () => {
    // Deciding the pairing by comparing values meant that with our
    // description '' and theirs null, the language came from the linked
    // row for no reason.
    const merged = mergeLinked({
      ...osm,
      description: '',
      description_lang: 'sl',
      ...fromOther,
      linked_description: null,
      linked_description_lang: null,
    });
    expect(merged.description_lang).toBe('sl');
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

/**
 * CAMP-279. The redirect list and the gone list answer about the same
 * URLs, and the one thing that must never happen is a path in both.
 *
 * 🔴 These are assertions about SHARING, not about wording. A test that
 * matched the conditions in each query would pass the day somebody
 * retypes them identically into both and fails the day somebody
 * reformats one — the opposite of what matters. What matters is that
 * there is one definition and both read it, which is what makes the two
 * lists impossible to drift apart.
 *
 * The behaviour itself is rehearsed in verify-links.ts, against a
 * database, with the state planted and then taken away again.
 */
describe('the two lists cannot drift apart', () => {
  it('gone computes the published list and subtracts from it', () => {
    // 🔴 The RESOLVED list, not the raw pairs. A review planted a chain
    // of ten: row ten was half of a pair, so the pairs-based version
    // subtracted it from gone, but the walk stopped short and published
    // no redirect for it. That URL was in neither list.
    expect(GONE_LIST_SQL).toContain(RESOLVED_REDIRECTS_SQL);
    // And it is SUBTRACTED, not merely mentioned — the first version of
    // this test passed with the subtraction deleted, because the CTE
    // was still there. The behaviour is held by the rehearsal; this
    // holds the name honest.
    expect(GONE_LIST_SQL).toContain('NOT EXISTS (SELECT 1 FROM redirected rr');
  });

  it('the redirect list is the resolved form of those same pairs', () => {
    expect(RESOLVED_REDIRECTS_SQL).toContain(REDIRECT_PAIRS_SQL);
    expect(REDIRECT_LIST_SQL).toContain(RESOLVED_REDIRECTS_SQL);
  });

  it('a pair can point either way, which is the whole fix', () => {
    // Half one: the secondary redirects to its primary — the ordinary
    // case. Half two: the primary redirects to its secondary, for the
    // week OSM drops the primary and the secondary keeps the campsite.
    expect(REDIRECT_PAIRS_SQL).toContain('l.secondary_id AS from_id');
    expect(REDIRECT_PAIRS_SQL).toContain('l.primary_id AS from_id');
  });

  it('🔴 the second half is guarded by the negation of the first', () => {
    // Not decoration: without it a link whose primary is publishable
    // would feed both halves, UNION ALL would emit two rows, and the
    // campsite would redirect in a circle.
    expect(REDIRECT_PAIRS_SQL).toContain(
      'NOT (lp.missing_since IS NULL AND lp.region IS NOT NULL)',
    );
  });

  it('a chain is walked to a row nothing redirects away from', () => {
    expect(RESOLVED_REDIRECTS_SQL).toMatch(
      /NOT EXISTS \(SELECT 1 FROM pairs t WHERE t\.from_id = w\.to_id\)/,
    );
  });

  it('🔴 the walk ends because it has been there, not after N steps', () => {
    // `depth < 8` shipped first and lost row ten of a ten-row chain —
    // no redirect, and already subtracted from gone. A cap is a guess
    // about how long a chain can be.
    expect(RESOLVED_REDIRECTS_SQL).not.toMatch(/depth\s*<\s*\d/);
    expect(RESOLVED_REDIRECTS_SQL).toContain('NOT p.to_id = ANY (w.seen)');
  });

  it('the gone list computes that walk once, not per row', () => {
    // Without MATERIALIZED the full-window query went from ~200 ms to
    // 657–778 ms, measured 12.10.2026.
    expect(GONE_LIST_SQL).toContain('AS MATERIALIZED');
  });
});

/**
 * CAMP-280: folding the merge over several secondaries.
 *
 * 🔴 These run without a database on purpose. The rehearsal in
 * verify-links.ts proves the SQL produces the array; this proves what
 * the fold does with it, including the cases a live database has no
 * rows for yet.
 */
describe('mergeAllLinked', () => {
  const sec = (over: Record<string, unknown>) => ({
    linked_id: 'x',
    linked_name: null,
    linked_stars: null,
    linked_description: null,
    linked_description_lang: null,
    linked_website: null,
    linked_contact: null,
    linked_sources: [],
    linked_owner_overrides: null,
    linked_tariffs: [],
    linked_tariffs_withheld: 0,
    ...over,
  });
  const primary = (over: Record<string, unknown> = {}) => ({
    name: 'Camping Les Pins',
    stars: null,
    description: null,
    description_lang: null,
    website: null,
    contact: {},
    sources: [],
    owner_overrides: {},
    tariffs: [],
    tariffs_withheld: 0,
    ...over,
  });

  it('leaves a campsite with no secondary exactly as it was', () => {
    const row = primary({ linked_rows: null });
    expect(mergeAllLinked(row)).toBe(row);
  });

  it('🔴 takes a field from EACH secondary, not from the first only', () => {
    // The whole reason the one-row read had to go: a campsite can be an
    // OSM area, the way it was exported from, and a DATAtourisme record.
    // Seven were in that shape on 12.10.2026 and their star rating was
    // on the row the merge could not reach.
    const merged = mergeAllLinked(
      primary({
        linked_rows: [
          sec({ linked_id: 'a', linked_stars: 4 }),
          sec({ linked_id: 'b', linked_website: 'https://b.test' }),
        ],
      }),
    );
    expect(merged.stars).toBe(4);
    expect(merged.website).toBe('https://b.test');
  });

  it('the earlier secondary wins where both have the field', () => {
    const merged = mergeAllLinked(
      primary({
        linked_rows: [
          sec({ linked_id: 'a', linked_stars: 3 }),
          sec({ linked_id: 'b', linked_stars: 5 }),
        ],
      }),
    );
    expect(merged.stars).toBe(3);
  });

  it('🔴 the language label travels with the text, across secondaries', () => {
    // The trap this would fall into: taking the description from the
    // second secondary and the language from the first, so French prose
    // is announced as German in a lang attribute a screen reader obeys.
    const merged = mergeAllLinked(
      primary({
        linked_rows: [
          sec({ linked_id: 'a', linked_stars: 4 }),
          sec({
            linked_id: 'b',
            linked_description: 'Au bord du lac',
            linked_description_lang: 'fr',
          }),
        ],
      }),
    );
    expect(merged.description).toBe('Au bord du lac');
    expect(merged.description_lang).toBe('fr');
  });

  it('the primary still beats every secondary', () => {
    const merged = mergeAllLinked(
      primary({
        stars: 2,
        linked_rows: [
          sec({ linked_id: 'a', linked_stars: 4 }),
          sec({ linked_id: 'b', linked_stars: 5 }),
        ],
      }),
    );
    expect(merged.stars).toBe(2);
  });

  it('🔴 credits each source only for what it actually gave', () => {
    // Attribution is a licence obligation, not tidiness: the page prints
    // this list as "what this source gave us". Crediting the second
    // source for a star rating the first supplied is a false statement
    // about provenance — and it is the shape a careless N-row merge
    // produces, because both sources declare the field.
    const merged = mergeAllLinked(
      primary({
        linked_rows: [
          sec({
            linked_id: 'a',
            linked_stars: 4,
            linked_sources: [{ id: 'dt-a', ref: 'A', fields: ['stars'] }],
          }),
          sec({
            linked_id: 'b',
            linked_stars: 5,
            linked_website: 'https://b.test',
            linked_sources: [
              { id: 'dt-b', ref: 'B', fields: ['stars', 'website'] },
            ],
          }),
        ],
      }),
    );
    const sources = merged.sources as { id: string; fields: string[] }[];
    expect(sources.find((e) => e.id === 'dt-a')?.fields).toEqual(['stars']);
    expect(sources.find((e) => e.id === 'dt-b')?.fields).toEqual(['website']);
  });

  it('🔴 credit for a field two secondaries both filled survives', () => {
    // `contact` is the one field that can be taken twice, because it is
    // merged key by key. The first secondary supplies a phone, the
    // second an email, and a naive fold feeds the first one's credit
    // back in as "ours" and strips it — leaving a source entry claiming
    // nothing, beside data it did supply.
    const merged = mergeAllLinked(
      primary({
        contact: {},
        linked_rows: [
          sec({
            linked_id: 'a',
            linked_contact: { phone: '+33 1 23 45 67 89' },
            linked_sources: [{ id: 'dt-a', ref: 'A', fields: ['contact'] }],
          }),
          sec({
            linked_id: 'b',
            linked_contact: { email: 'hello@b.test' },
            linked_sources: [{ id: 'dt-b', ref: 'B', fields: ['contact'] }],
          }),
        ],
      }),
    );
    expect(merged.contact).toEqual({
      phone: '+33 1 23 45 67 89',
      email: 'hello@b.test',
    });
    const sources = merged.sources as { id: string; fields: string[] }[];
    expect(sources.find((e) => e.id === 'dt-a')?.fields).toEqual(['contact']);
    expect(sources.find((e) => e.id === 'dt-b')?.fields).toEqual(['contact']);
  });

  it('a price list is still taken whole, from the first that has one', () => {
    const merged = mergeAllLinked(
      primary({
        linked_rows: [
          sec({ linked_id: 'a', linked_tariffs: [] }),
          sec({
            linked_id: 'b',
            linked_tariffs: [{ minPrice: '12.00' }],
            linked_tariffs_withheld: 3,
          }),
        ],
      }),
    );
    expect(merged.tariffs).toEqual([{ minPrice: '12.00' }]);
    expect(merged.tariffs_withheld).toBe(3);
  });
});

/**
 * CAMP-283: `contact` is the one field both rows can fill at once, and
 * the attribution model is flat.
 *
 * 🔴 The page prints the source list verbatim as "what this source gave
 * us". Before this, our phone number was shown beside a line saying we
 * had no contact details from OpenStreetMap — so a reader wanting to
 * correct it was pointed at the wrong source. The over-claim this file
 * already guards against, pointing the other way.
 */
describe('CAMP-283: credit for a field both rows filled', () => {
  const base = { linked_id: 'dt', tariffs: [], linked_tariffs: [] };
  const osm = (fields: string[]) => [{ id: 'osm', ref: 'w1', fields }];
  const dt = (fields: string[]) => [{ id: 'dt', ref: 'D1', fields }];
  const credited = (row: Record<string, unknown>, id: string) =>
    (mergeLinked(row).sources as { id: string; fields: string[] }[]).find(
      (e) => e.id === id,
    )?.fields;

  it('🔴 both keep it when both supplied a key', () => {
    const row = {
      ...base,
      contact: { phone: '+33 OWN' },
      sources: osm(['name', 'contact', 'location']),
      linked_contact: { email: 'hello@dt.test' },
      linked_sources: dt(['contact']),
    };
    expect(mergeLinked(row).contact).toEqual({
      phone: '+33 OWN',
      email: 'hello@dt.test',
    });
    expect(credited(row, 'osm')).toContain('contact');
    expect(credited(row, 'dt')).toEqual(['contact']);
  });

  it('🔴 we do NOT claim it when we supplied nothing', () => {
    // Fixing an under-claim must not invent an over-claim.
    const row = {
      ...base,
      contact: {},
      sources: osm(['name', 'contact', 'location']),
      linked_contact: { email: 'hello@dt.test' },
      linked_sources: dt(['contact']),
    };
    expect(credited(row, 'osm')).toEqual(['name', 'location']);
    expect(credited(row, 'dt')).toEqual(['contact']);
  });

  it('when both offer the SAME key, ours wins and theirs claims nothing', () => {
    const row = {
      ...base,
      contact: { phone: '+33 OWN' },
      sources: osm(['contact']),
      linked_contact: { phone: '+33 THEIRS' },
      linked_sources: dt(['contact']),
    };
    expect(mergeLinked(row).contact).toEqual({ phone: '+33 OWN' });
    expect(credited(row, 'osm')).toEqual(['contact']);
    // Nothing of theirs was reused, so the entry is dropped entirely.
    expect(credited(row, 'dt')).toBeUndefined();
  });

  it('🔴 an empty string of ours is not a contribution', () => {
    // The same definition of empty as everywhere else: `{phone: ''}` is
    // no phone number, so claiming `contact` on its strength would be
    // the over-claim again, dressed as the fix for the under-claim.
    const row = {
      ...base,
      contact: { phone: '  ' },
      sources: osm(['contact']),
      linked_contact: { phone: '+33 THEIRS' },
      linked_sources: dt(['contact']),
    };
    expect(mergeLinked(row).contact).toEqual({ phone: '+33 THEIRS' });
    expect(credited(row, 'osm')).toEqual([]);
    expect(credited(row, 'dt')).toEqual(['contact']);
  });

  it('a field that is not composite is still ours or theirs, never both', () => {
    const row = {
      ...base,
      website: null,
      contact: {},
      sources: osm(['website', 'location']),
      linked_website: 'https://dt.test',
      linked_sources: dt(['website']),
    };
    expect(credited(row, 'osm')).toEqual(['location']);
    expect(credited(row, 'dt')).toEqual(['website']);
  });
});
