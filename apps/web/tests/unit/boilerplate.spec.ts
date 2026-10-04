import { expect, test } from '@playwright/test';
// 🔴 THE GUARD'S OWN STRIPPER, IMPORTED — not a copy of its regex.
// `scripts/seo/page-text.mjs` is the one definition of "what a reader
// sees on a built page"; CI runs it over 65 435 files after a build,
// this file runs it over a component in half a second. A second copy of
// that rule here would agree with itself and with nothing else.
import { visibleHtmlText, boilerplateBlocks } from '../../../../scripts/seo/page-text.mjs';
import { WebcamPanel } from '@/components/webcam-panel';
import { renderComponent } from './render-component';
import type { Webcam } from '@/lib/webcams';

// CAMP-190 — `data-boilerplate` is a claim, and this is where it is checked.
//
// 🔴 WHY THIS FILE EXISTS.
//
// The duplicate-page guard strips every `data-boilerplate` block before
// comparing two pages, so the attribute is the one thing in this
// codebase that can make the guard look away. Its rule is written in
// `check-duplicate-pages.mjs` and is strict: *the block must be
// identical on every page it appears on.*
//
// Nothing enforced that rule. A paragraph that varied with the campsite
// could be marked — by mistake, or by somebody with a red CI job and a
// deadline — and the guard would stop reading the very text it exists
// to read. CI would go green by being blinded.
//
// So: render the panel twice with DIFFERENT data and ask two questions.
// Every marked block must come out word for word the same (it is
// template), and the unmarked text must come out different (the panel
// still says something about this campsite). The second half is what
// stops "mark everything" from being the fix.

/**
 * Every marked block as `name::text`, read by the GUARD'S OWN WALK.
 *
 * 🔴 Not a regex of this file's own. A test that found the blocks its
 * own way could assert a mark is present and identical while the guard
 * was discarding something else entirely — which is the exact failure
 * this file exists to prevent, one level up.
 */
function markedBlocks(html: string): string[] {
  return boilerplateBlocks(html).map(
    (b: { name: string; text: string }) =>
      `${b.name}::${b.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`,
  );
}

const NOW = new Date('2026-10-04T19:35:00.000Z');

// Two campsites' worth of rows, as the query returns them. Different
// cameras, different places, different distances, different ages.
const SET_A: Webcam[] = [
  {
    ref: '1690466401',
    title: 'Bovec: Live webcam - airport - View to Kanin',
    categories: ['mountain'],
    detailUrl: 'https://windy.com/webcams/1690466401',
    providerUrl: 'https://www.whatsupcams.com/en/webcams/Slovenia/Goriska/Bovec/live-webcam-bovec-airport',
    lastFrameAt: '2026-10-04T19:23:01.000Z',
    metres: 465,
  },
  {
    ref: '1689851105',
    title: 'Bovec',
    categories: ['mountain'],
    detailUrl: 'https://windy.com/webcams/1689851105',
    providerUrl: null,
    lastFrameAt: '2026-10-04T18:10:57.000Z',
    metres: 591,
  },
];

const SET_B: Webcam[] = [
  {
    ref: '1726103455',
    title: "Saint-Medard-d'Aunis › West: La Plaine",
    categories: ['landscape'],
    detailUrl: 'https://windy.com/webcams/1726103455',
    providerUrl: 'https://example-operator.fr/cam',
    lastFrameAt: '2026-10-04T19:31:40.000Z',
    metres: 18_400,
  },
  {
    ref: '1611140235',
    title: 'Zadar: harbour',
    categories: ['harbor'],
    detailUrl: 'https://windy.com/webcams/1611140235',
    providerUrl: null,
    lastFrameAt: '2026-10-04T17:52:12.000Z',
    metres: 2_050,
  },
];

test.describe('what `data-boilerplate` is allowed to hide', () => {
  // 🔴 THE RULE, STATED AS THE GUARD STATES IT: a marked block must be
  // identical on every page it appears on. So: gather every block from
  // several renders with different data, group by mark, and require each
  // mark to have exactly one text.
  //
  // By mark, not by position. How many cards carry an operator link
  // varies with the campsite, so the ORDER of the blocks legitimately
  // does; the words inside each one may not.
  test('every mark carries exactly one text, across different campsites', () => {
    const texts = new Map<string, Set<string>>();
    for (const webcams of [SET_A, SET_B, [SET_A[1]], [SET_B[0]], [], null]) {
      for (const block of markedBlocks(renderComponent(WebcamPanel, { webcams, now: NOW }))) {
        const [name, text] = [block.slice(0, block.indexOf('::')), block.slice(block.indexOf('::') + 2)];
        if (!texts.has(name)) texts.set(name, new Set());
        texts.get(name)!.add(text);
      }
    }

    expect([...texts.keys()].sort(), 'the panel marks a different set of blocks than expected').toEqual([
      'webcam-credit',
      'webcam-frame-note',
      'webcam-heading',
      'webcam-none',
      'webcam-operator',
    ]);

    for (const [name, variants] of texts) {
      expect(
        [...variants],
        `"${name}" is not the same words on every page, so it may not be marked`,
      ).toHaveLength(1);
    }
  });

  // 🔴 THE OTHER HALF, and the one that stops "mark everything".
  //
  // A panel whose entire visible text were marked would pass the test
  // above and contribute nothing a reader or the guard could tell apart.
  // What survives the stripping has to be the camera's own facts.
  test('what survives the stripping still differs between two campsites', () => {
    const a = visibleHtmlText(renderComponent(WebcamPanel, { webcams: SET_A, now: NOW }));
    const b = visibleHtmlText(renderComponent(WebcamPanel, { webcams: SET_B, now: NOW }));

    expect(a.length, 'the panel is template and nothing else').toBeGreaterThan(20);
    expect(a).not.toEqual(b);

    // Named, so a future "simplification" that drops the distance or the
    // camera's name has to argue with a test rather than with a number.
    // Measured against what the component actually renders: `shortTitle`
    // drops the `Place ›` scaffolding and `distance` rounds under a
    // kilometre to the nearest 50 m.
    expect(a).toContain('view to kanin');
    expect(a).toContain('450 m away');
    expect(b).toContain('la plaine');
    expect(b).toContain('18 km away');
    expect(b).toContain('looking west');
  });

  // 🔴 And the heading, the caption and the credit must NOT survive it —
  // otherwise the marks are decorative and the guard is still counting
  // the template.
  test('the template itself does not survive the stripping', () => {
    const stripped = visibleHtmlText(renderComponent(WebcamPanel, { webcams: SET_A, now: NOW }));
    for (const phrase of [
      'webcams nearby',
      'the most recent daylight view',
      'webcams provided by windy.com',
      'own site',
    ]) {
      expect(stripped, `"${phrase}" is still counted against every pair`).not.toContain(phrase);
    }
  });
});
