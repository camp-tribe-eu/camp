import { expect, test } from '@playwright/test';
import { WarningPanel } from '@/components/warning-panel';
import {
  AGGREGATOR,
  DISCLAIMER,
  FRESH_FOR_MINUTES,
  OURS,
  warningState,
  type Warning,
  type WarningFeed,
} from '@/lib/warnings';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';
import {
  AGGREGATOR_CREDIT,
  DISCLAIMER_VERBATIM,
  MAX_DELAY_MINUTES,
  PANEL_CHROME,
  REQUIRED_LINK,
} from './warning-licence';

// CAMP-150 — the six elements, and the ban on emptiness.
//
// 🔴 EVERY ASSERTION READS THE RENDERED PAGE, never a constant. A check
// that asserts `DISCLAIMER.length > 0` passes on a panel that renders
// none of it, which is the failure mode the card is about: the page looks
// normal, the tests are green, and we are in breach every day.
//
// `visibleText` is used rather than the HTML string so that an element
// hidden with `hidden` or `sr-only` cannot satisfy a clause. A credit a
// reader cannot see is not a credit.

const NOW = new Date('2026-10-06T12:00:00Z');
const fresh = (minutesAgo: number) =>
  new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const warning = (over: Partial<Warning> = {}): Warning => ({
  id: 'alert-1|HR803',
  country: 'croatia',
  event: 'Yellow wind warning',
  headline: null,
  description: null,
  instruction: null,
  type: 'Wind',
  typeCode: '1',
  level: 2,
  levelLabel: 'yellow; Moderate',
  sent: '2026-10-05T18:30:00Z',
  onset: '2026-10-06T22:01:01Z',
  effective: null,
  expires: '2026-10-07T21:59:59Z',
  areas: [{ name: 'Velebit channel region', codes: ['EMMA_ID:HR803'], polygons: [], circles: [] }],
  sender: 'DHMZ – Croatian Meteorological and Hydrological Service',
  senderId: 'https://meteo.hr',
  language: 'en-GB',
  ...over,
});

const feed = (fetchedAt: string, warnings: Warning[] = []): WarningFeed => ({
  meta: { source: 'MeteoAlarm (EUMETNET)', sourceUrl: 'https://meteoalarm.org/', fetchedAt },
  warnings,
});

const render = (state: Parameters<typeof WarningPanel>[0]['state']) =>
  renderComponent(WarningPanel, { state });

const shown = (state: Parameters<typeof WarningPanel>[0]['state']) =>
  visibleText(render(state));

/** The three states a reader can be shown, so no test can forget one. */
const EVERY_STATE = () => {
  const one = warning();
  return {
    warnings: warningState(feed(fresh(1), [one]), [one], NOW),
    clear: warningState(feed(fresh(1), []), [], NOW),
    'no-fresh-data': warningState(feed(fresh(90), []), [], NOW),
  };
};

test.describe('the licence text and the panel cannot drift apart', () => {
  test('🔴 the constant the panel renders IS the licence sentence', () => {
    // Two copies, one in src and one written out from the terms here.
    // They are allowed to change — together, in view, on purpose.
    expect(DISCLAIMER).toBe(DISCLAIMER_VERBATIM);
    expect(AGGREGATOR).toBe(AGGREGATOR_CREDIT);
    expect(FRESH_FOR_MINUTES).toBe(MAX_DELAY_MINUTES);
  });
});

test.describe('the four things the licence requires are on the page', () => {
  test('clause 5.3 — one country names the service that issued it', () => {
    const w = warning();
    const text = shown(warningState(feed(fresh(1), [w]), [w], NOW));
    expect(text).toContain('DHMZ – Croatian Meteorological and Hydrological Service');
    // 🔴 And NOT the aggregator, which is the credit for the other case.
    // Reaching for it when one country is on screen uses the clause that
    // does not apply.
    expect(text).not.toContain(AGGREGATOR_CREDIT);
  });

  test('clause 5.2 — more than one country names EUMETNET – MeteoAlarm', () => {
    const hr = warning();
    const si = warning({ id: 'alert-2|SI', country: 'slovenia', sender: 'ARSO' });
    const text = shown(warningState(feed(fresh(1), [hr, si]), [hr, si], NOW));
    expect(text).toContain(AGGREGATOR_CREDIT);
  });

  test('…and one country with two services names both, not the aggregator', () => {
    // Belgium publishes through more than one participant. Naming one
    // would be naming the wrong one; naming EUMETNET would be using the
    // multi-country clause on a single country.
    const a = warning({ id: 'a', country: 'belgium', sender: 'RMI' });
    const b = warning({ id: 'b', country: 'belgium', sender: 'KMI' });
    const text = shown(warningState(feed(fresh(1), [a, b]), [a, b], NOW));
    expect(text).toContain('RMI');
    expect(text).toContain('KMI');
    expect(text).not.toContain(AGGREGATOR_CREDIT);
  });

  test('🔴 clause 5.4 — the time shown is the time of ISSUE, not the onset', () => {
    // Measured on all 27 feeds 06.10.2026: `sent` and `onset` are both
    // present on 1 279 of 1 279 live blocks and differ on 1 279 of 1 279,
    // median 16.7 hours apart. This fixture keeps them a day apart so the
    // substitution cannot pass by being close.
    const w = warning({ sent: '2026-10-05T18:30:00Z', onset: '2026-10-06T22:01:01Z' });
    const text = shown(warningState(feed(fresh(1), [w]), [w], NOW));
    expect(text).toContain('2026-10-05 18:30 UTC');
    expect(text).not.toContain('2026-10-06 22:01');
  });

  test('clause 5.5 — the link to www.meteoalarm.org is really a link', () => {
    const w = warning();
    const html = render(warningState(feed(fresh(1), [w]), [w], NOW));
    expect(html).toContain('href="https://www.meteoalarm.org"');
    // And readable, not an empty anchor behind an icon.
    expect(visibleText(html)).toContain(REQUIRED_LINK);
  });

  test('clause 5.7 — the disclaimer is published word for word', () => {
    const w = warning();
    expect(shown(warningState(feed(fresh(1), [w]), [w], NOW))).toContain(
      DISCLAIMER_VERBATIM,
    );
  });

  test('…and all four are on EVERY state, not only the one with a warning', () => {
    for (const [kind, state] of Object.entries(EVERY_STATE())) {
      const html = render(state);
      const text = visibleText(html);
      expect(text, kind).toContain(DISCLAIMER_VERBATIM);
      expect(text, kind).toContain(OURS);
      // 🔴 THE LINK IS CHECKED AS AN `href`, NOT AS TEXT, and mutation
      // testing is why. Deleting the anchor left this test green: the
      // disclaimer the clause ALSO requires contains the string
      // "www.meteoalarm.org" twice, so a search of the visible text was
      // satisfied by a different clause and certified a page with no link
      // on it. A guard that another guard keeps alive is not a guard.
      expect(html, kind).toContain(`href="https://${REQUIRED_LINK}"`);
    }
  });
});

test.describe('the severity is readable, and it is the service’s word', () => {
  test('🔴 a level 2 and a level 4 warning do not read the same', () => {
    // Measured on all 27 feeds 06.10.2026: only 232 of 1 279 live blocks
    // (18.1%) name their level in `event` or `headline`. Spain alone
    // sends 672 that do not. So on four warnings in five, this line is
    // the only thing between "yellow" and "red".
    const yellow = warning({ event: 'Wind warning', level: 2, levelLabel: 'yellow; Moderate' });
    const red = warning({ event: 'Wind warning', level: 4, levelLabel: 'red; Extreme' });
    const a = shown(warningState(feed(fresh(1), [yellow]), [yellow], NOW));
    const b = shown(warningState(feed(fresh(1), [red]), [red], NOW));
    expect(a).toContain('yellow');
    expect(b).toContain('red');
    expect(a).not.toEqual(b);
  });

  test('…the word is taken from the source, never written for a code', () => {
    // If we mapped 4 → "red" ourselves, a source calling it something
    // else would be overwritten. This asserts we print what it said.
    const w = warning({ level: 4, levelLabel: 'alarma roja; Extreme' });
    expect(shown(warningState(feed(fresh(1), [w]), [w], NOW))).toContain('alarma roja');
  });

  test('…and a warning whose level has no word says nothing rather than guessing', () => {
    const w = warning({ level: 3, levelLabel: null });
    const text = shown(warningState(feed(fresh(1), [w]), [w], NOW));
    expect(text).not.toContain('Level 3 of 4');
    // The warning itself is still shown; only the word we do not have
    // is missing.
    expect(text).toContain('Yellow wind warning');
  });
});

test.describe('the two elements that are ours', () => {
  test('element 5 — the panel says the decision is the reader’s', () => {
    const w = warning();
    expect(shown(warningState(feed(fresh(1), [w]), [w], NOW))).toContain(OURS);
  });

  test('🔴 element 6 — stale data SAYS SO, and is never a blank space', () => {
    const state = warningState(feed(fresh(FRESH_FOR_MINUTES + 1), []), [], NOW);
    expect(state.kind).toBe('no-fresh-data');
    const text = shown(state);
    expect(text).toContain('No fresh data.');
    // 🔴 And it refuses the reading that kills people: an absent warning
    // is not a statement that the weather is fine.
    expect(text).toContain('This is not a statement that conditions are calm.');
  });

  test('…the boundary is the licence’s ten minutes, either side of it', () => {
    expect(warningState(feed(fresh(FRESH_FOR_MINUTES), []), [], NOW).kind).toBe('clear');
    expect(
      warningState(feed(fresh(FRESH_FOR_MINUTES + 0.1), []), [], NOW).kind,
    ).toBe('no-fresh-data');
  });

  test('🔴 …and no state of this panel renders nothing', () => {
    for (const [kind, state] of Object.entries(EVERY_STATE())) {
      expect(shown(state).trim().length, kind).toBeGreaterThan(100);
    }
    // Including the ones that come from failure rather than from data.
    for (const bad of [null, undefined, {} as WarningFeed]) {
      const text = shown(warningState(bad, [], NOW));
      expect(text).toContain('No fresh data.');
    }
  });
});

test.describe('a warning we may not attribute is withheld — and said to be', () => {
  test('🔴 it is not shown', () => {
    const w = warning({ sender: null });
    expect(shown(warningState(feed(fresh(1), [w]), [w], NOW))).not.toContain(
      'Yellow wind warning',
    );
  });

  test('🔴 …and the panel does NOT then claim the area is clear', () => {
    // Dropping a live warning and printing "no warning was in force" is
    // the worst thing this panel could do. It must say it is holding
    // something back instead.
    const w = warning({ sender: null });
    const state = warningState(feed(fresh(1), [w]), [w], NOW);
    expect(state.kind).toBe('no-fresh-data');
    const text = shown(state);
    expect(text).not.toContain('No official warning was in force');
    expect(text).toContain('does not name the service that issued it');
  });

  test('…the same holds for a warning with no time of issue', () => {
    // Without `sent` there is no clause 5.4 element to print, so the
    // warning cannot be redistributed either.
    const w = warning({ sent: null });
    expect(warningState(feed(fresh(1), [w]), [w], NOW).kind).toBe('no-fresh-data');
  });
});

test.describe('nothing on this panel is a phrase we wrote about the weather', () => {
  test('🔴 every word is either the source’s or declared chrome', () => {
    // Sentinels nothing could print by accident.
    const w = warning({
      event: 'ZZEVENTZZ',
      type: 'ZZTYPEZZ',
      levelLabel: 'ZZLEVELZZ; ZZSEVERITYZZ',
      areas: [{ name: 'ZZAREAZZ', codes: [], polygons: [], circles: [] }],
      sender: 'ZZSENDERZZ',
    });
    let left = shown(warningState(feed(fresh(1), [w]), [w], NOW));
    for (const allowed of [
      ...PANEL_CHROME,
      'ZZEVENTZZ',
      'ZZAREAZZ',
      'ZZSENDERZZ',
      'ZZLEVELZZ',
      '2026-10-05 18:30 UTC',
    ]) {
      left = left.split(allowed).join(' ');
    }
    // Punctuation and spacing are what a layout leaves behind; words are
    // what somebody decided to say.
    const words = left.match(/[A-Za-z]{2,}/g) ?? [];
    expect(
      words,
      'the panel printed words that are neither the source’s nor declared in ' +
        'PANEL_CHROME — if this is a sentence we are allowed to publish, add it ' +
        'there, which is the moment to ask whether we are',
    ).toEqual([]);
  });

  test('…and the same holds for the state with no warning in it', () => {
    let left = shown(warningState(feed(fresh(1), []), [], NOW));
    for (const allowed of [...PANEL_CHROME, '2026-10-06 11:59 UTC']) {
      left = left.split(allowed).join(' ');
    }
    expect(left.match(/[A-Za-z]{2,}/g) ?? []).toEqual([]);
  });
});
