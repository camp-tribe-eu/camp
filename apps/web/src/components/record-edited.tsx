import { recordEdit } from '@/lib/record-age';
import { SOURCES } from '@/lib/sources';

// CAMP-256 — "Record last edited: June 2023".
//
// The day a mapper last changed this place's entry in OpenStreetMap — or,
// for a record that comes only from DATAtourisme, the day its source system
// last updated it, with DATAtourisme named beside the date — as plain text
// beside the facilities it describes, and "Not known" where no source we
// hold dates the place.
//
// 🔴 "THE RECORD THIS PAGE IS BUILT ON", not "this place's entry". One page
// is usually one OpenStreetMap object. Where the importer merged a node and
// a way into one page, the date is the NEWEST of the objects it was built
// from (apps/api/src/osm/record-age.ts, `mergedRecord`): the page shows a
// union of their tags, and the kept object's date alone was older than a
// displayed tag in 162 of 516 merged clusters (measured 15.10.2026). The
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
 * 🔴 Under "Not known", and the reason it is there: without it, "Record last
 * edited: Not known" would read as though NO record of this place had a date,
 * when the point is that none of the sources we hold dates this one. The
 * sources named are the ones that CAN date a record — OpenStreetMap, and every
 * source the registry marks `edited` — read from the registry, so adding a
 * source there changes this sentence and the page with it.
 */
export const RECORD_EDITED_UNKNOWN = `We hold no edit date for this place from ${[
  'OpenStreetMap',
  ...Object.values(SOURCES)
    .filter((s) => s.datesAre === 'edited')
    .map((s) => s.name),
].join(' or ')}.`;

/** The OpenStreetMap date's sentence. "The record this page is built on": see the header. */
export const RECORD_EDITED_CAVEAT =
  'This is the last time a mapper changed the OpenStreetMap record this page is built on, not the day we last checked it. An older date says when it was last touched, not whether it is right.';

/**
 * A source's OWN date. "As of our last import" is in the sentence because it
 * is true and it matters: the source keeps editing, and a page built from last
 * month's import cannot know it (checked 15.10.2026: of 15 DATAtourisme
 * records, 3 had been updated at the source after our snapshot).
 */
export const recordEditedCaveatFor = (sourceName: string) =>
  `This is the last time the source system behind ${sourceName} updated this record, as of our last import, not the day we last checked it. An older date says when it was last touched, not whether it is right.`;

export default function RecordEdited({
  osmEditedAt,
  sources,
  now = new Date(),
}: {
  /** The API's `osmRecordEditedAt`, unchecked: an ISO instant, null, or absent. */
  osmEditedAt: unknown;
  /** The API's `sources`, unchecked. Read only through `recordEdit`. */
  sources?: unknown;
  now?: Date;
}) {
  const age = recordEdit(osmEditedAt, sources, now);
  const own = age.known && age.source.id !== 'osm' ? age.source : null;

  return (
    <div data-testid="record-edited" data-band={age.known ? age.band : 'unknown'}>
      <p className="mt-4 max-w-prose text-sm text-ink-2">
        <span data-boilerplate="record-edited-label">Record last edited:</span>{' '}
        {age.known ? (
          <>
            <time dateTime={age.day} className="text-heading">
              {age.month}
            </time>
            {/* The source's name beside a date that is the source's own, so
                a reader sees whose record is meant. The same on every page
                it appears on, so it is marked. */}
            {own && (
              <>
                {' '}
                <span data-boilerplate={`record-edited-source-${own.id}`}>
                  ({own.name})
                </span>
              </>
            )}
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
          age.known
            ? `record-edited-caveat${own ? `-${own.id}` : ''}`
            : 'record-edited-unknown'
        }
      >
        {age.known
          ? own
            ? recordEditedCaveatFor(own.name)
            : RECORD_EDITED_CAVEAT
          : RECORD_EDITED_UNKNOWN}
      </p>
    </div>
  );
}
