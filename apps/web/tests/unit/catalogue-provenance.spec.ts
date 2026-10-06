import { expect, test } from '@playwright/test';
import { CatalogueProvenance } from '@/components/catalogue-provenance';
import type { Guide, GuideProvenance } from '@/lib/guides';
import { renderComponent } from './render-component';

// CAMP-210 — the disclosure block on a catalogue page.
//
// 🔴 THE FIRST VERSION PRINTED A FALSE SENTENCE, and no test caught it
// because no test rendered it: the label came from the data and the
// prose was the `data-generated` paragraph, written out once. On a page
// holding one `ai-generated` guide it read, on one line:
//
//   Written by a machine … Nothing here is … a sentence a model invented.
//
// Review found it by rendering the component. So does this file.
//
// This is not a styling test. Article 50(2) of the EU AI Act is in force
// since 02.08.2026 and the text here is the disclosure itself — a false
// clause in it is not a typo, it is the thing the law is about.

const guide = (provenance: GuideProvenance, generator: string | null = 'region-facts@2') =>
  ({
    slug: `x-${provenance}-${Math.random().toString(36).slice(2, 7)}`,
    category: 'region',
    title: 'A guide',
    summary: 'A summary.',
    body: null,
    provenance,
    generator,
    authorName: null,
    authorCredentials: null,
    readingMinutes: null,
    factsCheckedAt: null,
    publishedAt: null,
  }) as Guide;

const render = (guides: Guide[]) =>
  renderComponent(CatalogueProvenance, { guides });

const text = (guides: Guide[]) =>
  render(guides)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

test.describe('the catalogue disclosure says what is on the page', () => {
  test('🔴 the "nothing a model invented" claim appears ONLY when it is true', () => {
    const CLAIM = 'a sentence a model invented';

    // True: every guide here came from the database program.
    expect(text([guide('data-generated'), guide('data-generated')])).toContain(CLAIM);

    // False the moment a model wrote one of them. This is the case
    // review rendered and the first version printed anyway.
    expect(text([guide('data-generated'), guide('ai-generated')])).not.toContain(CLAIM);
    expect(text([guide('ai-generated')])).not.toContain(CLAIM);
    expect(text([guide('ai-assisted')])).not.toContain(CLAIM);
    // And not when a person wrote one either: the sentence is about the
    // whole page, so one exception makes it untrue.
    expect(text([guide('data-generated'), guide('human', null)])).not.toContain(CLAIM);
  });

  test('…and never claims a program wrote what a person wrote', () => {
    const mixed = text([guide('data-generated'), guide('human', null)]);
    // Both kinds are named, with their counts, so the block and the cards
    // under it cannot contradict each other.
    expect(mixed).toContain('1 was written by a program');
    expect(mixed).toContain('1 was written by a person');
  });

  test('…and counts rather than rounds', () => {
    const many = text([
      guide('data-generated'),
      guide('data-generated'),
      guide('data-generated'),
      guide('human', null),
    ]);
    expect(many).toContain('3 were written by a program');
    expect(many).toContain('1 was written by a person');
  });

  test('…and discloses at the strongest level present', () => {
    // One machine-written guide among many makes the page machine-written.
    const out = render([guide('human', null), guide('ai-generated')]);
    expect(out).toContain('data-provenance="ai-generated"');
    // 🔴 Not "human", which would be true of half the page and false of
    // the half that the Act is about.
    expect(out).not.toContain('data-provenance="human"');
  });

  test('…and names every program on the page, once each', () => {
    const out = render([
      guide('data-generated', 'region-facts@2'),
      guide('data-generated', 'region-facts@2'),
      guide('data-generated', 'region-facts@1'),
    ]);
    expect(out).toContain('<code>region-facts@1</code>');
    expect(out).toContain('<code>region-facts@2</code>');
    expect(out.match(/region-facts@2/g)?.length).toBe(1);
    expect(out).toContain('The programs are');
  });

  test('…and a page with nothing on it says nothing', () => {
    expect(render([])).toBe('');
  });

  test('…and the block still carries what the AI Act guard looks for', () => {
    const out = render([guide('data-generated')]);
    // The three things check-guide-disclosure.mjs reads.
    expect(out).toContain('data-testid="provenance"');
    expect(out).toMatch(/data-provenance="[^"]+"/);
    expect(out).toMatch(/machine|program|model/i);
    expect(out).toMatch(/<code>[^<]+<\/code>/);
  });
});
