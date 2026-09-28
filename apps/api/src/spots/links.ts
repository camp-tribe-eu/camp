import type { SpotSource } from '../entities/camping-spot.entity';

// CAMP-144: the one predicate every read query has to learn.
//
// 🔴 A fragment in one file, not the same EXISTS clause copied into
// twenty queries.
//
// Every read path in this service already shares two conditions —
// `region IS NOT NULL` and `missing_since IS NULL` — by having them
// typed out again in each query, with no builder anywhere. That has held
// so far because both are short. This one is not, and a copy of it that
// somebody forgets to update is a page that silently comes back as a
// duplicate: the worst kind of failure, because the site looks fine and
// only a crawler notices.
//
// So it is a function of the table alias, exported once, and a spec
// asserts that every query which returns campsites to a reader uses it.

/**
 * True when this row has been folded into another campsite.
 *
 * 🔴 `unlinked_at IS NULL` is not decoration. A link a person has undone
 * must stop hiding the row THAT DAY, without a re-import and without a
 * deploy — that is what makes a false match reversible. The partial
 * unique index `idx_spot_links_secondary_live` covers exactly this
 * predicate, so the lookup is an index probe rather than a scan.
 */
export function isSecondarySql(alias: string): string {
  return `EXISTS (SELECT 1 FROM spot_links l
                   WHERE l.secondary_id = ${alias}.id
                     AND l.unlinked_at IS NULL)`;
}

/**
 * The condition a campsite must pass to be a page, a pin, a search
 * result or one of a route's four suggestions.
 *
 * 🔴 The secondary is hidden, NOT deleted, and not even marked. Its row
 * is untouched; the DATAtourisme importer keeps writing to it; its stars
 * and description are read through the link and printed on the primary's
 * page. Hiding happens at read time and only at read time, which is why
 * undoing a link needs one UPDATE and nothing else.
 */
export function notSecondarySql(alias: string): string {
  return `NOT ${isSecondarySql(alias)}`;
}

/**
 * The live secondary of a spot, as a LATERAL join.
 *
 * 🔴 One row at most, guaranteed by `idx_spot_links_secondary_live`
 * plus the invariant that an OSM row is never a secondary — both checked
 * by verify-links.ts against the live table rather than assumed here.
 * If that ever stops holding, `LIMIT 1` would silently pick one of two
 * sources for the stars, so the check is the thing that matters, not
 * this clause.
 */
export const LINKED_SECONDARY_JOIN = `
  LEFT JOIN LATERAL (
    SELECT x.stars, x.description, x.description_lang, x.website,
           x.name, x.contact, x.sources, x.owner_overrides,
           x.content_changed_at
      FROM spot_links l
      JOIN camping_spots x ON x.id = l.secondary_id
     WHERE l.primary_id = s.id AND l.unlinked_at IS NULL
     LIMIT 1
  ) linked ON true`;

/**
 * CAMP-144: fold the linked row into the row that owns the page.
 *
 * 🔴 WHAT NEVER COMES FROM THE OTHER ROW: slug, country, region, type,
 * location, amenities, context.
 *
 * The first four are the URL and the page's identity — taking them from
 * the other row would move a published address, which CAMP-87 forbids
 * outright. The last two are OSM's real geometry and the surroundings
 * computed from it; the DATAtourisme row is a single point dropped by a
 * tourist office and carries no amenities at all, so preferring it would
 * trade a measured fact for a worse one.
 *
 * 🔴 WHAT ONLY EVER COMES FROM THE OTHER ROW, in practice: `stars`.
 * Measured on the 2 986 linked pairs — not one has a star rating on both
 * sides, because OpenStreetMap does not carry the French classification
 * at all. This is the whole reason the card forbids deleting either row.
 *
 * 🔴 Gap-filling, never overwriting — the same rule the DATAtourisme
 * importer states in one line, and for the same reason. If we already
 * hold a name or a website, a second source's version does not replace
 * it; it fills a hole or it is not used.
 *
 * 🔴 `sources` are CONCATENATED, and that is a licence obligation, not
 * tidiness. ODbL asks for attribution of the OSM part; Licence Ouverte
 * asks for the source AND the date it last changed the information
 * reused. A page built from both that named one of them would breach the
 * other. The page prints this list verbatim (source-note.tsx).
 */
export function mergeLinked(
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (row.linked_sources === null || row.linked_sources === undefined) {
    return row;
  }
  /**
   * 🔴 Every field the merge actually takes is recorded as it is taken.
   *
   * The linked row's source entry says which fields that source supplied
   * for ITS OWN row — `["stars","description","name","website","location"]`
   * for a typical DATAtourisme record. Copying that list onto this page
   * would claim the page's location came from DATAtourisme. It did not:
   * the point shown is OSM's, and the tourist office's single point was
   * discarded by the rule above.
   *
   * The page renders this list as "what this source gave us"
   * (source-note.tsx), so an over-claim there is a false statement about
   * provenance in the one place the licences make us be exact — and it
   * points the wrong way, crediting a source for data it did not
   * provide. What is owed is attribution for what is REUSED, so the list
   * is narrowed to what was reused.
   */
  const taken = new Set<string>();
  const firstOf = (mine: unknown, theirs: unknown, field?: string): unknown => {
    const empty = mine === null || mine === undefined || mine === '';
    if (empty && field && theirs !== null && theirs !== undefined) {
      taken.add(field);
    }
    return empty ? theirs : mine;
  };

  const description = firstOf(
    row.description,
    row.linked_description,
    'description',
  );
  const contact = {
    ...((row.linked_contact ?? {}) as Record<string, unknown>),
    ...((row.contact ?? {}) as Record<string, unknown>),
  };
  for (const key of Object.keys(
    (row.linked_contact ?? {}) as Record<string, unknown>,
  )) {
    if (!(key in ((row.contact ?? {}) as Record<string, unknown>))) {
      taken.add('contact');
    }
  }

  const merged = {
    ...row,
    name: firstOf(row.name, row.linked_name, 'name'),
    stars: firstOf(row.stars, row.linked_stars, 'stars'),
    description,
    // 🔴 The language travels with the text it describes, never
    // independently. Keeping our own `description_lang` beside their
    // description would label French prose as Slovenian — and the page
    // renders it into a `lang` attribute, so a screen reader would then
    // read French aloud with Slovenian phonetics. Whoever's description
    // won, their language wins with it.
    description_lang:
      description === row.description
        ? row.description_lang
        : row.linked_description_lang,
    website: firstOf(row.website, row.linked_website, 'website'),
    // Ours wins key by key: `contact` is OSM's phone, email and address,
    // and the other row's is empty in every measured case — but a blanket
    // `??` would drop ours entirely the day that stops being true.
    contact,
    // 🔴 An owner's correction is never dropped, whichever row they
    // claimed. Ours wins on a conflict, because the primary is the row
    // the claim portal points at — but a correction made on the other
    // row before it was linked still has to survive, or this work would
    // erase exactly what owner_overrides exists to protect.
    owner_overrides: {
      ...((row.linked_owner_overrides ?? {}) as Record<string, unknown>),
      ...((row.owner_overrides ?? {}) as Record<string, unknown>),
    },
    sources: [
      ...((row.sources ?? []) as SpotSource[]),
      // 🔴 Narrowed to what this page actually reuses, and dropped
      // entirely when it reuses nothing. A source credited for a page it
      // contributed nothing to is not a courtesy — it tells a reader
      // that a fact came from somewhere it did not.
      ...((row.linked_sources ?? []) as SpotSource[])
        .map((entry) => ({
          ...entry,
          fields: (entry.fields ?? []).filter((f) => taken.has(f)),
        }))
        .filter((entry) => entry.fields.length > 0),
    ],
  };
  return merged;
}
