import { expect, test } from '@playwright/test';
// 🔴 THE GUARD'S OWN STRIPPER, IMPORTED — the same two functions
// boilerplate.spec.ts uses, for the same reason: a second copy of the rule
// "what does the duplicate-page guard read" would agree with itself and with
// nothing else.
import { visibleHtmlText, boilerplateBlocks } from '../../../../scripts/seo/page-text.mjs';
import RecordEdited from '@/components/record-edited';
import { renderComponent } from './render-component';

// CAMP-256 — `data-boilerplate` on the "Record last edited" line is a claim,
// and this is where it is checked (the rule is in boilerplate.spec.ts: a
// marked block must be word for word the same on every page it appears on,
// and the unmarked text must still say something about THIS campsite).
//
// The line is mostly template — a label and a caption that repeat on
// thousands of pages — around one page-specific part, the month. Marked
// correctly, the guard keeps reading the month and looks away from the
// rest. Marked wrongly, in either direction, it goes blind (the month
// marked) or reads thousands of identical strings (nothing marked).

const NOW = new Date('2026-10-15T20:00:00.000Z');

const render = (editedAt: unknown) => renderComponent(RecordEdited, { editedAt, now: NOW });

/** Every marked block as `name::text`, read by the GUARD'S OWN WALK. */
const marked = (html: string): string[] =>
  boilerplateBlocks(html).map(
    (b: { name: string; text: string }) =>
      `${b.name}::${b.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`,
  );

test.describe('the marks on the "Record last edited" line', () => {
  // Two campsites in the SAME grade, a year apart: 2.6 and 1.7 years before NOW.
  const A = '2024-03-02T10:00:00.000Z';
  const B = '2025-01-20T10:00:00.000Z';

  test('anchor: the line has marked blocks at all, or every comparison below is empty = empty', () => {
    expect(marked(render(A)).length).toBeGreaterThanOrEqual(3);
  });

  test('🔴 every marked block is word for word the same on two different campsites', () => {
    expect(marked(render(A))).toEqual(marked(render(B)));
  });

  test('🔴 …and the text the guard still reads DIFFERS — the month is not marked', () => {
    const a = visibleHtmlText(render(A));
    const b = visibleHtmlText(render(B));
    expect(a).not.toBe(b);
    // The guard folds case; the month is what it reads.
    expect(a).toContain('march 2024');
    expect(b).toContain('january 2025');
  });

  test('the label and the caption are what is marked, and the month is not among them', () => {
    const blocks = marked(render(A));
    expect(blocks).toContain('record-edited-label::Record last edited:');
    expect(blocks).toContain('record-edited-caption-one-to-three::between one and three years ago');
    expect(blocks.join('\n')).not.toContain('March 2024');
  });

  test('🔴 each grade has its OWN mark name, so one name never stands for two texts', () => {
    const captions = (['2026-06-14', '2025-07-14', '2023-06-14'] as const).map((d) =>
      marked(render(`${d}T10:00:00.000Z`)).filter((b) => b.startsWith('record-edited-caption-')),
    );
    expect(captions).toEqual([
      ['record-edited-caption-fresh::within the last year'],
      ['record-edited-caption-one-to-three::between one and three years ago'],
      ['record-edited-caption-over-three::more than three years ago'],
    ]);
  });

  test('"Not known": the label and the fixed sentence are marked, and "Not known" is still read', () => {
    const html = render(null);
    expect(marked(html)).toEqual([
      'record-edited-label::Record last edited:',
      'record-edited-unknown::We hold no edit date from OpenStreetMap for this place.',
    ]);
    expect(visibleHtmlText(html)).toContain('not known');
  });
});
