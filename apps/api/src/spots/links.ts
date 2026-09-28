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
 * True when this row has been folded into a campsite that is ACTUALLY
 * SHOWING it.
 *
 * 🔴 `unlinked_at IS NULL` is not decoration. A link a person has undone
 * must stop hiding the row THAT DAY, without a re-import and without a
 * deploy — that is what makes a false match reversible. The partial
 * unique index `idx_spot_links_secondary_live` covers exactly this
 * predicate, so the lookup is an index probe rather than a scan.
 *
 * 🔴 And the primary must itself be publishable, which is the condition
 * this started without.
 *
 * A link hides one row because another one is carrying its content. The
 * moment the primary stops being carried anywhere, that stops being
 * true. Two ways it happens, and both are ordinary:
 *
 *   - OSM drops the campsite and the weekly import stamps
 *     `missing_since`, which every read query already filters out;
 *   - the primary has no region, so `canonicalPath` returns null and it
 *     has no URL at all (135 rows measured on 24.09.2026).
 *
 * Without this clause the campsite would then be on NO page: the primary
 * filtered out for being missing, the secondary hidden for being linked
 * to it — and the DATAtourisme row, which is complete and which nobody
 * said anything about, silently deleted from the site by a join. That is
 * the exact failure this card forbids, arrived at from the other end.
 *
 * With it, the secondary simply becomes its own page again, which is
 * what it was the day before the link was made. `SpotsService.links`
 * carries the same two conditions, so the 301 withdraws in the same
 * build rather than pointing at a page that is now a 410.
 */
export function isSecondarySql(alias: string): string {
  return `EXISTS (SELECT 1 FROM spot_links l
                    JOIN camping_spots lp ON lp.id = l.primary_id
                   WHERE l.secondary_id = ${alias}.id
                     AND l.unlinked_at IS NULL
                     AND lp.missing_since IS NULL
                     AND lp.region IS NOT NULL)`;
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
 * 🔴 `ORDER BY` before `LIMIT 1`, and the review that asked for it was
 * right twice over.
 *
 * The first version said "one row at most, guaranteed by the unique
 * index plus an invariant" — and neither guaranteed it. The index was
 * unique on `secondary_id`, not `primary_id`, and no invariant said a
 * primary has one secondary. Two DATAtourisme records near one OSM
 * campsite could each choose it, and then the stars on that page were
 * whichever row the planner returned first: no error, and a page that
 * changes between builds.
 *
 * `idx_spot_links_primary_live` is now UNIQUE, which makes the second
 * row impossible rather than merely unlikely. The ORDER BY stays anyway,
 * because a bare `LIMIT 1` is only deterministic while that index holds,
 * and the cost of being wrong is silent.
 */
export const LINKED_SECONDARY_JOIN = `
  LEFT JOIN LATERAL (
    SELECT x.id, x.stars, x.description, x.description_lang, x.website,
           x.name, x.contact, x.sources, x.owner_overrides,
           x.content_changed_at
      FROM spot_links l
      JOIN camping_spots x ON x.id = l.secondary_id
     WHERE l.primary_id = s.id AND l.unlinked_at IS NULL
     ORDER BY l.created_at, x.id
     LIMIT 1
  ) linked ON true`;

/**
 * One field of a campsite, read through its link.
 *
 * 🔴 The detail page is not the only place a star rating belongs, and
 * this exists because review found the hole: `mergeLinked` runs in ONE
 * query, while `notSecondarySql` runs in twenty. So the secondary's row
 * was hidden everywhere and merged in one place.
 *
 * Measured over the French rows the guides' own LIVE predicate admits —
 * a region, not missing, not a hidden secondary:
 *
 *     four or five stars    699 from the row alone   1 159 through here
 *     any star rating     2 080                      4 210
 *
 * OpenStreetMap carries no French classification at all (0 of the 2 986
 * primaries has one), so the `classified` guide theme and the "with an
 * official star rating" facet on three others would have lost 40% and
 * 51% of what they should see.
 *
 * 🔴 `name` goes through here too, and that half is a guard rather than
 * a repair: today 0 live links have a named secondary behind a nameless
 * primary, because `decide` refuses to match an unnamed candidate
 * however close. A hand-made link is exactly the case that would break
 * it, which is why the read is here and not left until it happens.
 *
 * A correlated subquery rather than a join, so it can be dropped into a
 * SELECT list, a WHERE, an ORDER BY or a predicate string without
 * restructuring the statement around it — which is what made it possible
 * to close this in the guide predicates at all.
 */
export function mergedFieldSql(alias: string, column: string): string {
  return `coalesce(${alias}.${column}, (
    SELECT x.${column}
      FROM spot_links l
      JOIN camping_spots x ON x.id = l.secondary_id
     WHERE l.primary_id = ${alias}.id AND l.unlinked_at IS NULL
     ORDER BY l.created_at, x.id
     LIMIT 1))`;
}

/** The star rating this campsite has, from whichever source holds it. */
export const mergedStarsSql = (alias: string): string =>
  mergedFieldSql(alias, 'stars');

/** The name this campsite has, from whichever source holds one. */
export const mergedNameSql = (alias: string): string =>
  mergedFieldSql(alias, 'name');

/**
 * The linked row's source entries, narrowed to what this page reuses.
 *
 * 🔴 Narrowed, and dropped entirely when it reuses nothing. A source
 * credited for a page it contributed nothing to is not a courtesy — it
 * tells a reader a fact came from somewhere it did not.
 *
 * 🔴 And a field we took that the entry never declared still has to be
 * credited. A spec caught this: we take the other row's phone number,
 * but its entry lists `["stars","description","name","website","location"]`
 * because `contact` was added to the source shape later (CAMP-141) and
 * older rows were written before it. Filtering by the declared list
 * alone dropped the attribution for data we are visibly publishing —
 * an under-claim, which breaks the same licence condition as an
 * over-claim, just quietly.
 *
 * So: a taken field goes to the entry that declared it; a taken field
 * nobody declared goes to the row's single source, and is left
 * unattributed when the row has more than one, because then we do not
 * know which of them provided it and guessing is the thing this file
 * exists not to do.
 */
export function attributeTaken(
  entries: SpotSource[],
  taken: Set<string>,
): SpotSource[] {
  const declared = new Set(entries.flatMap((e) => e.fields ?? []));
  const orphans = [...taken].filter((f) => !declared.has(f));
  return entries
    .map((entry, i) => {
      const fields = (entry.fields ?? []).filter((f) => taken.has(f));
      if (entries.length === 1 && i === 0) fields.push(...orphans);
      return { ...entry, fields };
    })
    .filter((entry) => entry.fields.length > 0);
}

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
 * Measured across the 2 986 linked pairs — 2 134 carry a star rating,
 * on both sides 0 times, and on the OSM side 0 times. OpenStreetMap does
 * not carry the French classification at all. This is the whole reason
 * the card forbids deleting either row.
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
  // 🔴 The sentinel is the joined row's id, not one of the columns being
  // merged. It used to be `linked_sources`, which is a plain nullable
  // jsonb column: a secondary whose `sources` was NULL would have meant
  // "there is no linked row", the whole merge would have been skipped in
  // silence, and the star rating that is the point of this card would
  // simply not appear on the page. An id from the join is the only value
  // here that answers the question actually being asked.
  if (row.linked_id === null || row.linked_id === undefined) {
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

  /**
   * 🔴 ONE definition of "empty", applied to BOTH sides.
   *
   * It used to be applied to ours only: `theirs` merely had to be
   * non-null. So an empty string in the other row counted as a value —
   * the page got `website: ''` where the UI expects null and has a
   * fallback, `indexable` went true for `description: ''`, and worst of
   * all the source entry kept `website` in its field list, printing
   * "this source gave us: website" beside no website. That is the exact
   * false-provenance statement the comment above forbids, produced by
   * the code the comment is attached to.
   */
  const isEmpty = (v: unknown): boolean =>
    v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

  /** Their value only if we have none and theirs is real. */
  const firstOf = (
    mine: unknown,
    theirs: unknown,
    field: string,
  ): { value: unknown; fromThem: boolean } => {
    if (!isEmpty(mine)) return { value: mine, fromThem: false };
    if (isEmpty(theirs)) return { value: mine ?? null, fromThem: false };
    taken.add(field);
    return { value: theirs, fromThem: true };
  };

  const description = firstOf(
    row.description,
    row.linked_description,
    'description',
  );

  // 🔴 Key by key, and the same `isEmpty` as everywhere else. A blanket
  // spread let our `{phone: ''}` beat their real phone number — and
  // because the key was present, the loop that records what was taken did
  // not fire either, so the loss was not even attributed.
  const ourContact = (row.contact ?? {}) as Record<string, unknown>;
  const theirContact = (row.linked_contact ?? {}) as Record<string, unknown>;
  const contact: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ourContact)) {
    if (!isEmpty(v)) contact[k] = v;
  }
  for (const [k, v] of Object.entries(theirContact)) {
    if (isEmpty(contact[k]) && !isEmpty(v)) {
      contact[k] = v;
      taken.add('contact');
    }
  }

  const merged = {
    ...row,
    name: firstOf(row.name, row.linked_name, 'name').value,
    stars: firstOf(row.stars, row.linked_stars, 'stars').value,
    description: description.value,
    // 🔴 The language travels with the text it describes, never
    // independently. Keeping our own `description_lang` beside their
    // description would label French prose as Slovenian — and the page
    // renders it into a `lang` attribute, so a screen reader would read
    // French aloud with Slovenian phonetics.
    //
    // Decided by WHERE the text came from, not by comparing values.
    // Comparing them meant that when neither row had a description, our
    // own language was dropped for no reason, and two rows carrying the
    // same text under different languages resolved correctly only by
    // accident.
    description_lang: description.fromThem
      ? row.linked_description_lang
      : row.description_lang,
    website: firstOf(row.website, row.linked_website, 'website').value,
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
      ...attributeTaken((row.linked_sources ?? []) as SpotSource[], taken),
    ],
  };
  return merged;
}
