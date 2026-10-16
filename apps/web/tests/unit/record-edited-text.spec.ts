import { expect, test } from '@playwright/test';
import RecordEdited from '@/components/record-edited';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-256 — the red rule of the card, as a PROPERTY of the block.
//
// The card forbids saying "out of date" or "possibly wrong": all an edit date
// proves is WHEN SOMEBODY LAST TOUCHED THE RECORD, and a campground that has
// not changed in six years has an old record and a correct one.
//
// 🔴 WHY THIS IS NOT A LIST OF FORBIDDEN WORDS. The first version of this
// guard compared the caption and checked that the fixed sentence was
// PRESENT (`toContain`). Review APPENDED a sentence to the over-three grade
// — "This entry is out of date and may be wrong." — and 49 of 49 tests
// stayed green: every check was blind to something ADDED, and caught only
// something REPLACED. A word list would have been beaten by the next
// synonym. So the property is stated the other way round:
//
//   THE VISIBLE TEXT OF THE BLOCK IS THE TEMPLATE, CHARACTER FOR
//   CHARACTER — the date line, then the one fixed sentence under it, and
//   nothing else.
//
// Equality, not containment. Any extra sentence — whatever its words, however
// politely worded, in whichever grade — breaks it, and so does a changed one.
// The cost is that rewording the block means editing the strings below, which
// is the point: the wording of this block is a decision the card made, and it
// lives in one reviewed place.
//
// Every expected string is TYPED, and `now` is typed: nothing here is built
// from the component's own constants.

const NOW = new Date('2026-10-15T20:00:00.000Z');

const CAVEAT =
  'This is the last time a mapper changed the OpenStreetMap record this page is built on, not the day we last checked it. An older date says when it was last touched, not whether it is right.';
const CAVEAT_DT =
  'This is the last time the source system behind DATAtourisme updated this record, as of our last import, not the day we last checked it. An older date says when it was last touched, not whether it is right.';
const UNKNOWN =
  'We hold no edit date for this place from OpenStreetMap or DATAtourisme.';

/** A DATAtourisme entry as the API sends it: the SOURCE's own day, no time. */
const dt = (updatedAt: string) => [
  {
    id: 'datatourisme',
    ref: 'https://data.datatourisme.fr/13/71389ebb-090b-3ff0-ac17-386c0ab52a21',
    updatedAt,
    fields: ['name', 'location'],
  },
];

/** The text a reader meets in the block, as the other page specs read it. */
const blockText = (osmEditedAt: unknown, sources?: unknown) =>
  visibleText(
    renderComponent(RecordEdited, { osmEditedAt, sources, now: NOW }),
  );

test.describe('the block says the template, and only the template', () => {
  test('within the last year', () => {
    expect(blockText('2026-06-14T10:11:12.000Z')).toBe(
      `Record last edited: June 2026 — within the last year ${CAVEAT}`,
    );
  });

  test('between one and three years', () => {
    expect(blockText('2025-07-14T10:11:12.000Z')).toBe(
      `Record last edited: July 2025 — between one and three years ago ${CAVEAT}`,
    );
  });

  test('more than three years — the grade where the judgement would be tempting', () => {
    expect(blockText('2023-06-14T10:11:12.000Z')).toBe(
      `Record last edited: June 2023 — more than three years ago ${CAVEAT}`,
    );
  });

  test('a record from 2011 is shown whole, not trimmed or flagged', () => {
    expect(blockText('2011-02-03T04:05:06.000Z')).toBe(
      `Record last edited: February 2011 — more than three years ago ${CAVEAT}`,
    );
  });

  test('not known', () => {
    expect(blockText(null)).toBe(`Record last edited: Not known ${UNKNOWN}`);
  });

  // 🔴 THE SAME PROPERTY FOR A RECORD THAT COMES ONLY FROM DATAtourisme: its
  // own date, its name beside it, its own fixed sentence — and nothing else.
  // `updatedAt` there is a DAY, so nothing finer than a month is printed.
  test('DATAtourisme, within the last year', () => {
    expect(blockText(null, dt('2026-08-20'))).toBe(
      `Record last edited: August 2026 (DATAtourisme) — within the last year ${CAVEAT_DT}`,
    );
  });

  test('DATAtourisme, between one and three years', () => {
    expect(blockText(null, dt('2025-03-30'))).toBe(
      `Record last edited: March 2025 (DATAtourisme) — between one and three years ago ${CAVEAT_DT}`,
    );
  });

  test('DATAtourisme, more than three years — the oldest record we hold is from 2002', () => {
    expect(blockText(null, dt('2002-05-24'))).toBe(
      `Record last edited: May 2002 (DATAtourisme) — more than three years ago ${CAVEAT_DT}`,
    );
  });

  // 🔴 NO PRECISION THAT THE SOURCE DID NOT GIVE. DATAtourisme dates a record
  // to the DAY (`2026-08-20`), with no time of day, and the machine-readable
  // attribute carries exactly that — not `…T00:00:00Z`, which would be an hour
  // we made up. (The text a reader sees is a month, which is coarser still.)
  test('the machine-readable date is the day the source gave, with no time invented', () => {
    const html = renderComponent(RecordEdited, {
      osmEditedAt: null,
      sources: dt('2026-08-20'),
      now: NOW,
    });
    expect(html).toMatch(/datetime="2026-08-20"/i);
    expect(html).not.toMatch(/datetime="[^"]*T/i);
  });

  test('🔴 anchor: the helper really reads the block — an empty string would satisfy "nothing extra"', () => {
    expect(blockText('2023-06-14T10:11:12.000Z').length).toBeGreaterThan(200);
    expect(blockText(null).length).toBeGreaterThan(60);
  });
});
