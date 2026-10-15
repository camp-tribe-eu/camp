import { recordAge } from '@/lib/record-age';

// CAMP-256 — "Record last edited: June 2023".
//
// The day a mapper last changed this place's entry in OpenStreetMap, as
// plain text beside the facilities it describes, and "Not known" where we
// do not have it.
//
// 🔴 "THE RECORD THIS PAGE IS BUILT ON", not "this place's entry". One page
// is usually one OpenStreetMap object. Where the importer merged a node and
// a way into one page it keeps the date of the object it kept (the way,
// whose id is the `osm_ref` we store), and the merged-away object can be the newer
// of the two: 162 of the 516 merged pages across the 27 extracts of
// 24.09.2026 (measured 15.10.2026), about 0.3% of all dated pages. The
// caption names the record, so it stays true for them too.
//
// 🔴 IT SAYS WHEN SOMEBODY LAST TOUCHED THE ENTRY, and nothing about
// whether the entry is right. The card is explicit that "out of date" and
// "possibly wrong" are claims we cannot prove from a date, so the words are
// "last edited", the age is a span of time, and the one fixed sentence
// under it says in so many words what the date is not.
//
// 🔴 NOTHING IS HIDDEN OR FILTERED. A record last edited in 2011 is shown
// with its month and a caption; a record with no date says "Not known" in
// the same place and the same voice, as everything else on this page does.
//
// 🔴 THIS IS NOT THE "Last checked against this source" DATE in the box at
// the foot of the page. That one is the day our importer last found the
// place and moves every week; this one moves only when a mapper edits. The
// sentence under the date says so, because the two sit on one page and
// differ by years.
//
// 🔴 `data-boilerplate` marks ONLY text that is word for word the same on
// every page it appears on: the label, each grade's caption (one name per
// grade) and the fixed sentence under the date. The MONTH is page-specific
// and is not marked, so the duplicate-page guard keeps reading the one part
// of this line that says something about this campsite — and looks away
// from the rest, which is the same on thousands of pages and would only
// make two thin ones look more alike. (source-note.tsx has the opposite
// lesson: marking the DATE as well hid the one page-specific thing there.)
//
// 🔴 `now` is a prop with the build's clock as its default, so the grade is
// the age AT BUILD: a caption is a span of time measured then, and the date
// beside it is absolute.

/**
 * 🔴 Under "Not known", and the reason it is there. 5 139 of the 52 741
 * campsite pages in the dev database (15.10.2026) have no OpenStreetMap object
 * at all — they come from DATAtourisme, whose own date sits in the box at
 * the foot of the page. "Record last edited: Not known" with nothing more
 * would read, just above that date, as though we did not know when ANY
 * record of this place was last changed; this says which date is missing.
 */
export const RECORD_EDITED_UNKNOWN =
  'We hold no edit date from OpenStreetMap for this place.';

export const RECORD_EDITED_CAVEAT =
  'This is the last time a mapper changed the OpenStreetMap record this page is built on, not the day we last checked it. An older date says when it was last touched, not whether it is right.';

export default function RecordEdited({
  editedAt,
  now = new Date(),
}: {
  /** The API's `osmRecordEditedAt`, unchecked: an ISO instant, null, or absent. */
  editedAt: unknown;
  now?: Date;
}) {
  const age = recordAge(editedAt, now);

  return (
    <div data-testid="record-edited" data-band={age.known ? age.band : 'unknown'}>
      <p className="mt-4 max-w-prose text-sm text-ink-2">
        <span data-boilerplate="record-edited-label">Record last edited:</span>{' '}
        {age.known ? (
          <>
            <time dateTime={age.day} className="text-heading">
              {age.month}
            </time>
            {' — '}
            {/* One name per grade: each is word for word the same on every
                page it appears on, which is the rule the mark is held to. */}
            <span data-boilerplate={`record-edited-caption-${age.band}`}>
              {age.caption}
            </span>
          </>
        ) : (
          'Not known'
        )}
      </p>
      <p
        className="mt-1 max-w-prose text-xs leading-5 text-ink-2"
        data-boilerplate={
          age.known ? 'record-edited-caveat' : 'record-edited-unknown'
        }
      >
        {age.known ? RECORD_EDITED_CAVEAT : RECORD_EDITED_UNKNOWN}
      </p>
    </div>
  );
}
