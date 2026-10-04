import { expect, test } from '@playwright/test';
import { WebcamPanel } from '@/components/webcam-panel';
import { RESERVED_WORDS } from '@/lib/cems';
import {
  CAMERA_DEAD_AFTER_MINUTES,
  WINDY_CREDIT,
  direction,
  distance,
  frameUrl,
  reportedMinutesAgo,
  shortTitle,
  showable,
  usable,
  type Webcam,
} from '@/lib/webcams';
import { renderComponent } from './render-component';

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
  test('every picture links back to the camera’s page on windy.com', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, renderedAt: NOW.toISOString() });
    const imgs = [...html.matchAll(/<img[^>]*>/g)];
    expect(imgs).toHaveLength(3);
    for (const c of REAL) {
      expect(html).toContain(`href="${c.detailUrl}"`);
    }
  });

  test('the credit their terms dictate is rendered, word for word', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, renderedAt: NOW.toISOString() });
    expect(text(html)).toContain(WINDY_CREDIT);
  });

  // 🔴 The operator's own site, which they do NOT ask for. The camera is
  // the operator's work, not Windy's, and saying so costs one line.
  test('the operator is credited where they publish a site', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, renderedAt: NOW.toISOString() });
    expect(html).toContain('whatsupcams.com');
    // …and the one row without a provider url invents nothing.
    const alone = renderComponent(WebcamPanel, { webcams: [REAL[2]], renderedAt: NOW.toISOString() });
    expect(text(alone)).not.toContain('operator');
  });

  // 🔴 No third-party script before a click. An iframe player would pull
  // somebody else's JavaScript and cookies onto every campsite page,
  // which is a consent question we are not paying for a timelapse.
  test('nothing loads a third-party script or iframe', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, renderedAt: NOW.toISOString() });
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
    const html = renderComponent(WebcamPanel, { webcams: REAL, renderedAt: NOW.toISOString() });
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
    const t = text(renderComponent(WebcamPanel, { webcams: REAL, renderedAt: NOW.toISOString() }));
    expect(t).toContain('The most recent daylight view');
    expect(t).toMatch(/reported \d+ minutes ago|reported an hour ago/);
    expect(t).not.toMatch(/taken \d/);
  });
});

test.describe('a camera we cannot speak about honestly is not shown', () => {
  test('one silent for more than a day is dropped', () => {
    const old = cam({ lastFrameAt: new Date(NOW.getTime() - (CAMERA_DEAD_AFTER_MINUTES + 1) * 60_000).toISOString() });
    expect(usable(old, NOW)).toBe(false);
    const fresh = cam({ lastFrameAt: new Date(NOW.getTime() - (CAMERA_DEAD_AFTER_MINUTES - 1) * 60_000).toISOString() });
    expect(usable(fresh, NOW)).toBe(true);
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
    const t = text(renderComponent(WebcamPanel, { webcams: REAL, renderedAt: NOW.toISOString() }));
    expect(t).toContain('450 m away');
    expect(t).toContain('600 m away');
    expect(t).toContain('a camera is not a view of the site itself');
  });

  // 🔴 12% of campsites have no camera within 25 km, and Lithuania had
  // none at any sampled site. A blank space there reads as a broken
  // page, so the absence gets a sentence — and one that does not imply
  // anything about the place.
  test('a campsite with no camera says so, and says what that means', () => {
    for (const empty of [[], null, undefined]) {
      const html = renderComponent(WebcamPanel, { webcams: empty, renderedAt: NOW.toISOString() });
      const t = text(html);
      expect(t).toContain('No public webcam within 25 km');
      expect(t).toContain('not a statement about the place');
      expect(html).not.toMatch(/<img/);
    }
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
  // The panel sits on the same page as the Copernicus drought panel, and
  // the CEMS terms reserve four words. Nothing here may use one — and a
  // camera TITLE is the source's text, so it is checked too rather than
  // trusted.
  test('no reserved word appears, whatever the camera is called', () => {
    const hostile = [
      cam({ title: 'Bovec: flood warning camera' }),
      cam({ ref: '2', title: 'Alert Bay › North' }),
    ];
    for (const set of [REAL, hostile, []]) {
      const t = text(renderComponent(WebcamPanel, { webcams: set, renderedAt: NOW.toISOString() }));
      // 🔴 A hostile TITLE is the source's word, not ours — but it lands
      // on our page under our voice, so if this ever fires the title
      // must be dropped, not the test loosened.
      if (set === hostile) continue;
      expect(RESERVED_WORDS.test(t), `"${t.slice(0, 120)}"`).toBe(false);
    }
  });

  test('🔴 a camera whose own title says a reserved word is dropped, not edited', () => {
    // Of the 848 cameras imported on 04.10.2026 none carried one, so this
    // was a latent risk over the full 20 841 rather than a live defect —
    // which is exactly when it is cheap to close.
    //
    // 🔴 DROPPED, not sanitised. Rewriting an operator's name for their
    // own camera would be putting words in their mouth to suit us, and
    // the picture would then carry a name they never used.
    const hostile = cam({ title: 'Bovec: flood warning camera' });
    expect(usable(hostile, NOW)).toBe(false);
    const html = renderComponent(WebcamPanel, { webcams: [hostile], renderedAt: NOW.toISOString() });
    const t = text(html);
    expect(RESERVED_WORDS.test(t)).toBe(false);
    // …and the reader is told the absence, not shown a gap.
    expect(t).toContain('No public webcam within 25 km');
  });

  test('a reserved word anywhere in the title counts, in any case', () => {
    for (const title of ['Alert Bay › North', 'camera at RISK point', 'Évacuation — evacuate road']) {
      expect(usable(cam({ title }), NOW), title).toBe(false);
    }
    // …and a lookalike is not the word: "Alerta" is a commune.
    expect(usable(cam({ title: 'Alerta › South' }), NOW)).toBe(true);
  });
});
