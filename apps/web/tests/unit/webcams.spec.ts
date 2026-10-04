import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { WebcamPanel } from '@/components/webcam-panel';
import { RESERVED_WORDS } from '@/lib/cems';
import {
  CAMERA_DEAD_AFTER_MINUTES,
  absence,
  WINDY_CREDIT,
  WEBCAM_RADIUS_M,
  direction,
  distance,
  frameUrl,
  reportedMinutesAgo,
  reportedPhrase,
  shortTitle,
  showable,
  usable,
  type Webcam,
} from '@/lib/webcams';
import { renderComponent, rendersNothing } from './render-component';

// CAMP-190 — the rules that keep the pictures honest and the terms kept.
//
// Every fixture below is a row the database actually returned for
// `camp-bovec` on 04.10.2026, not an invention: titles, ids, distances
// and timestamps as they came.

const NOW = new Date('2026-10-04T19:35:00.000Z');
const cam = (over: Partial<Webcam> = {}): Webcam => ({
  ref: '1690466401',
  title: 'Bovec: Live webcam - airport - View to Kanin',
  categories: ['mountain'],
  detailUrl: 'https://windy.com/webcams/1690466401',
  providerUrl: 'https://www.whatsupcams.com/en/webcams/Slovenia/Goriska/Bovec/live-webcam-bovec-airport',
  lastFrameAt: '2026-10-04T19:23:01.000Z',
  metres: 465,
  ...over,
});

const REAL: Webcam[] = [
  cam(),
  cam({ ref: '1690466432', title: 'Bovec: airport webcam - Skydive', lastFrameAt: '2026-10-04T19:29:37.000Z' }),
  cam({ ref: '1689851105', title: 'Bovec', metres: 591, lastFrameAt: '2026-10-04T18:10:57.000Z', providerUrl: null }),
];

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test.describe('what the terms require of every frame we show', () => {
  // 🔴 Their condition for using the image at all: each one links back to
  // their page for that camera. A frame without it is a frame we may not
  // display, so this is a licence test, not a style one.
  test('every picture is INSIDE its link back to windy.com', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW });
    expect([...html.matchAll(/<img[^>]*>/g)]).toHaveLength(3);

    // 🔴 CONTAINMENT, not "the href appears somewhere on the page".
    //
    // The first version counted three <img> and grepped for each href
    // anywhere in the HTML. Review moved the <img> OUT of the anchor and
    // put the link on the title instead — 20 of 20 tests still passed,
    // over a page where no picture was linked at all. Their terms make
    // the link the condition of showing the image, so the test has to
    // ask the question the licence asks.
    for (const c of REAL) {
      const anchor = new RegExp(
        // 🔴 `[\\s\\S]`, DOUBLED. This is a template literal, so a single
        // `[\s\S]` is handed to RegExp as `[sS]` — a class of two letters.
        // The quantifier is lazy, so it matched zero characters and the
        // test passed on today's markup by luck, never once asking the
        // `(?!</a>)` question it exists to ask. CodeQL named it; it is
        // the same collapse that made the `webcams_title_sayable` CHECK
        // constraint inert, and a licence test that cannot fail is worth
        // exactly nothing.
        `<a[^>]*href="${c.detailUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>(?:(?!</a>)[\\s\\S])*?<img[^>]*src="[^"]*${c.ref}[^"]*"`,
      );
      expect(anchor.test(html), `the frame for ${c.ref} is not inside its link`).toBe(true);
    }
  });

  test('the credit their terms dictate is rendered, word for word', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW });
    expect(text(html)).toContain(WINDY_CREDIT);
  });

  // 🔴 The operator's own site, which they do NOT ask for. The camera is
  // the operator's work, not Windy's, and saying so costs one line.
  test('the operator is credited where they publish a site', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW });
    expect(html).toContain('whatsupcams.com');
    // …and the one row without a provider url invents nothing.
    const alone = renderComponent(WebcamPanel, { webcams: [REAL[2]], now: NOW });
    expect(text(alone)).not.toContain('operator');
  });

  // 🔴 No third-party script before a click. An iframe player would pull
  // somebody else's JavaScript and cookies onto every campsite page,
  // which is a consent question we are not paying for a timelapse.
  test('nothing loads a third-party script or iframe', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW });
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<script/i);
  });
});

test.describe('the frame we choose, and why it is never the current one', () => {
  // 🔴 Measured 04.10.2026 at 18:10 UTC: the Bovec camera's `current`
  // preview was 1 233 bytes and, opened, a flat grey rectangle. Its
  // `daylight` frame was the valley. A grey rectangle on a campsite page
  // reads as a broken site, not as nightfall — and a static page cannot
  // know whether the sun is up when somebody reads it.
  test('🔴 every image asks for the daylight frame, never the current one', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW });
    for (const m of html.matchAll(/<img[^>]*src="([^"]+)"/g)) {
      expect(m[1]).toContain('/daylight/');
      expect(m[1]).not.toContain('/current/');
    }
  });

  test('the url is built from the camera id and nothing else', () => {
    expect(frameUrl('123')).toBe(
      'https://imgproxy.windy.com/_/preview/plain/daylight/123/original.jpg?v=2',
    );
    // A ref that could break out of the path is encoded, not interpolated.
    expect(frameUrl('a/../b')).not.toContain('/../');
  });

  // 🔴 The API gives a timestamp for the CAMERA, not for this frame. A
  // clock on the picture would be one we invented.
  test('the picture carries no time of its own', () => {
    const t = text(renderComponent(WebcamPanel, { webcams: REAL, now: NOW }));
    expect(t).toContain('The most recent daylight view');
    expect(t).not.toMatch(/taken \d/);
  });

  // 🔴 "11 minutes ago" IS NOT A FACT ABOUT A STATIC PAGE.
  //
  // These pages are generated once (`dynamicParams = false`) and read
  // for days, so a server-rendered relative phrase is frozen at build
  // time. Review found the literal string in the HTML — and the test
  // above USED TO ASSERT IT, inside a test named "no time of its own".
  //
  // So the phrase may only come from a clock that keeps running, which
  // is what `'use client'` plus the tick in the component is for. This
  // test holds the component to that rather than to the string.
  test('🔴 the elapsed phrase comes from a running clock, not the build', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'src', 'components', 'webcam-panel.tsx'),
      'utf8',
    );
    expect(src.startsWith("'use client'"), 'a server-rendered page would freeze the phrase').toBe(true);
    expect(src).toMatch(/setInterval\(/);
    expect(src).toMatch(/setNow\(new Date\(\)\)/);
    // And the phrase itself must be a function of the clock it is given.
    expect(reportedPhrase(reportedMinutesAgo(REAL[0].lastFrameAt, NOW) as number)).toContain('minutes ago');
    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    expect(reportedPhrase(reportedMinutesAgo(REAL[0].lastFrameAt, later) as number)).toContain('hours ago');
  });
});

test.describe('a camera we cannot speak about honestly is not shown', () => {
  // 🔴 THE THRESHOLD WRITTEN OUT, not taken from the constant.
  //
  // Both fixtures used to be built from `CAMERA_DEAD_AFTER_MINUTES`, so
  // they moved with it: review raised 24 hours to 100 DAYS and all 20
  // tests passed. The test proved the operator was `<=` and nothing
  // about the number — and the free direction was the unsafe one.
  test('a day is the line, and it is a day', () => {
    expect(CAMERA_DEAD_AFTER_MINUTES).toBe(24 * 60);
  });

  test('one silent for more than a day is dropped', () => {
    const hoursAgo = (h: number) =>
      cam({ lastFrameAt: new Date(NOW.getTime() - h * 3_600_000).toISOString() });
    expect(usable(hoursAgo(23), NOW), '23 hours').toBe(true);
    expect(usable(hoursAgo(25), NOW), '25 hours').toBe(false);
    expect(usable(hoursAgo(24 * 7), NOW), 'a week').toBe(false);
  });

  // 🔴 No timestamp is NOT a pass. Every active camera we measured had
  // one; a row without it is a row we can say nothing true about.
  test('one with no time at all is dropped, not assumed fresh', () => {
    expect(usable(cam({ lastFrameAt: null }), NOW)).toBe(false);
    expect(usable(cam({ lastFrameAt: 'soon' }), NOW)).toBe(false);
  });

  // A clock reading "-4 minutes" would otherwise print as fresh for ever.
  test('a timestamp in the future is not freshness', () => {
    expect(reportedMinutesAgo(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBeNull();
    expect(usable(cam({ lastFrameAt: new Date(NOW.getTime() + 60_000).toISOString() }), NOW)).toBe(false);
  });

  test('a distance that is not a distance is dropped', () => {
    expect(usable(cam({ metres: -1 }), NOW)).toBe(false);
    expect(usable(cam({ metres: NaN }), NOW)).toBe(false);
  });

  test('one we cannot link back to is dropped, because the link is the licence', () => {
    expect(usable(cam({ detailUrl: 'http://windy.com/x' }), NOW)).toBe(false);
    expect(usable(cam({ detailUrl: '' }), NOW)).toBe(false);
  });

  test('showable keeps them nearest first and breaks ties the same way twice', () => {
    const shuffled = [REAL[2], REAL[1], REAL[0]];
    const a = showable(shuffled, NOW).map((c) => c.ref);
    const b = showable([...shuffled].reverse(), NOW).map((c) => c.ref);
    expect(a).toEqual(b);
    expect(a[a.length - 1]).toBe('1689851105');
  });
});

test.describe('the panel never claims the camera shows the campsite', () => {
  test('every card prints its distance', () => {
    const t = text(renderComponent(WebcamPanel, { webcams: REAL, now: NOW }));
    expect(t).toContain('450 m away');
    expect(t).toContain('600 m away');
    // 🔴 And the floor. `Math.round(m / 50) * 50` printed "0 m away" for
    // anything under 25 m — review measured 0, 12 and 24 all giving
    // `0 m`. "0 m away" reads as a camera pointed at the pitch, which is
    // the one thing this panel may never say.
    expect(distance(0)).toBe('under 50 m');
    expect(distance(12)).toBe('under 50 m');
    expect(distance(24)).toBe('under 50 m');
    expect(distance(25), 'the first rounded step must still round').toBe('50 m');
    expect(t).toContain('a camera is not a view of the site itself');
  });

  // 🔴 12% of campsites have no camera within 25 km, and Lithuania had
  // none at any sampled site. A blank space there reads as a broken
  // page, so the absence gets a sentence — and one that does not imply
  // anything about the place.
  // 🔴 TWO RADII, AND THIS TEST CANNOT TELL THEM APART — said plainly,
  // because the comment that used to stand here claimed the opposite.
  //
  // `WEBCAM_RADIUS_M` is declared in `apps/web/src/lib/webcams.ts` AND
  // in `apps/api/src/webcams/nearby.ts`, where the SQL uses it. Review
  // set the API's to 10 000: all 756 unit tests stayed green while the
  // page went on printing "within 25 km". It could not be otherwise —
  // the expectation below is built from the same constant the component
  // renders, so it only ever agrees with itself.
  //
  // What this test IS for: the sentence quotes the constant rather than
  // a typed-in "25 km". That the two constants agree is checked where
  // both files can be read at once —
  // `scripts/ci/check-webcam-radius.mjs`, which fails on exactly the
  // edit review made.
  test('the sentence quotes the radius the query actually uses', () => {
    expect(WEBCAM_RADIUS_M).toBe(25_000);
    const t = text(renderComponent(WebcamPanel, { webcams: [], now: NOW }));
    expect(t).toContain(distance(WEBCAM_RADIUS_M));
  });

  // 🔴 `[]` ONLY. `null` and `undefined` mean we have not imported the
  // catalogue, and this test used to loop over all three — which is how
  // the claim ended up on every page before the import had run. See
  // "a catalogue we have not imported" below.
  test('a campsite with no camera says so, and says what that means', () => {
    const html = renderComponent(WebcamPanel, { webcams: [], now: NOW });
    const t = text(html);
    expect(t).toContain('No public webcam within 25 km');
    expect(t).toContain('not a statement about the place');
    expect(html).not.toMatch(/<img/);
  });

  test('the direction comes from the source’s own title, or not at all', () => {
    expect(direction("Saint-Medard-d'Aunis › West: La Plaine")).toBe('west');
    expect(direction('Bovec › North-east')).toBe('north-east');
    expect(direction('Bovec')).toBeNull();
    // Not a compass word — we do not guess what it meant.
    expect(direction('Bovec › Panorama: x')).toBeNull();
  });

  test('the title loses the scaffolding and keeps the place', () => {
    expect(shortTitle('Bovec: Live webcam - airport - View to Kanin')).toBe('Live webcam - airport - View to Kanin');
    expect(shortTitle('Bovec')).toBe('Bovec');
    expect(shortTitle("Saint-Medard-d'Aunis › West: La Plaine d'Aunis")).toBe("La Plaine d'Aunis");
  });

  test('distances read as a person says them', () => {
    expect(distance(465)).toBe('450 m');
    expect(distance(1653)).toBe('1.7 km');
    expect(distance(25_000)).toBe('25 km');
    expect(distance(-1)).toBe('');
  });
});

test.describe('the words beside the pictures', () => {
  // 🔴 THE RULE LIVES UPSTREAM NOW, and this file says so rather than
  // pretending to enforce it.
  //
  // A camera whose own name carries a reserved word is dropped by
  // `scripts/windy/fetch-webcams.mjs` on import and refused by the
  // `webcams` table's CHECK constraint. Checking it again here meant
  // importing the CEMS word list into the shipped lib, which put thirty
  // pages inside the coverage guard's graph.
  //
  // So what this file can honestly assert is that the panel prints no
  // reserved word for the rows that CAN exist.
  test('no reserved word appears for any row the database can hold', () => {
    for (const set of [REAL, []]) {
      const t = text(renderComponent(WebcamPanel, { webcams: set, now: NOW }));
      expect(RESERVED_WORDS.test(t), `"${t.slice(0, 120)}"`).toBe(false);
    }
  });

  test('…and the panel adds no word of its own beyond the source’s', () => {
    const t = text(renderComponent(WebcamPanel, { webcams: REAL, now: NOW }));
    // Everything the panel says that is not a camera title or a number.
    for (const phrase of ['Webcams nearby', 'away', 'The most recent daylight view', WINDY_CREDIT]) {
      expect(t).toContain(phrase);
      expect(RESERVED_WORDS.test(phrase)).toBe(false);
    }
  });
});

// CAMP-190 — the panel is empty for TWO reasons and may only say the
// true one.
//
// 🔴 Found by review, and it was false on every page in Europe.
//
// These pages are built once and read for days; `usable()` is judged on
// the READER's clock and `CAMERA_DEAD_AFTER_MINUTES` is one day. So 25
// hours after an import, every campsite fell to the empty branch and
// told the reader "No public webcam within 25 km of this campsite" —
// blaming the camera network for our own stale import, over a place
// with four working cameras.
//
// Every test passed, because every test handed the panel a `now` sitting
// beside its fixture timestamps. These two do not.
test.describe('an empty panel says which kind of empty it is', () => {
  /** A day and an hour after the frames in REAL. */
  const STALE_CLOCK = new Date(NOW.getTime() + (CAMERA_DEAD_AFTER_MINUTES + 60) * 60_000);

  test('🔴 cameras that have gone quiet do not become "no camera here"', () => {
    const fresh = text(renderComponent(WebcamPanel, { webcams: REAL, now: NOW }));
    expect(fresh, 'the fixture is already stale — this test proves nothing')
      .not.toContain('No public webcam');

    const stale = text(renderComponent(WebcamPanel, { webcams: REAL, now: STALE_CLOCK }));
    // The rows are still there. Only our reading of them is old.
    expect(showable(REAL, STALE_CLOCK), 'the clock is not late enough to hide them').toHaveLength(0);
    expect(absence(REAL)).toBe('stale');

    expect(
      stale,
      'a campsite with three listed cameras is being told the network does not cover it',
    ).not.toContain('No public webcam');
    expect(stale).toContain('none of them has reported for more than a day');
    expect(stale, 'the sentence must name whose reading is old').toContain('our last reading');
  });

  test('…and a campsite with no camera at all still says exactly that', () => {
    const out = text(renderComponent(WebcamPanel, { webcams: [], now: NOW }));
    expect(absence([])).toBe('none');
    expect(out).toContain('No public webcam within 25 km');
    expect(out, 'nothing was listed, so there is no reading of ours to be old')
      .not.toContain('our last reading');
  });

  // 🔴 AND THE THIRD EMPTY, WHICH WAS LIVE ON EVERY PAGE IN EUROPE.
  //
  // `[]` used to mean both "we looked and there is nothing within
  // 25 km" and "we have not imported the catalogue". The webcam table is
  // empty until `scripts/windy/fetch-webcams.mjs` runs — measured on the
  // live API on 05.10.2026 — so every campsite was told
  //
  //   "No public webcam within 25 km of this campsite. That is what the
  //    camera network covers, not a statement about the place."
  //
  // over a continent where 88% of campsites have one (CAMP-189). It is
  // a claim about COVERAGE, made before we had looked.
  //
  // The API now answers `null` until the import has run, and the panel
  // says nothing at all. Saying nothing is not the failure the "never
  // empty" rule was written against: that rule is about campsites
  // without a camera, not about us without data.
  test('🔴 a catalogue we have not imported makes NO claim about coverage', () => {
    for (const notLooked of [null, undefined]) {
      expect(absence(notLooked)).toBe('unknown');
      expect(
        rendersNothing(WebcamPanel, { webcams: notLooked, now: NOW }),
        'the panel spoke about a camera network it has not read',
      ).toBe(true);
    }
    // And the distinction is real on the other side: an imported
    // catalogue that found nothing still says so.
    expect(rendersNothing(WebcamPanel, { webcams: [], now: NOW })).toBe(false);
  });
});
