import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { WebcamPanel } from '@/components/webcam-panel';
import { RESERVED_WORDS } from '@/lib/cems';
import {
  WEBCAM_NETWORK,
  CAMERA_DEAD_AFTER_MINUTES,
  absence,
  WINDY_ADD_URL,
  WINDY_CREDIT,
  WINDY_HOME_URL,
  WEBCAM_RADIUS_M,
  direction,
  distance,
  framesRequestUrl,
  parseFrames,
  watchForFrames,
  reportedMinutesAgo,
  reportedPhrase,
  shortTitle,
  showable,
  usable,
  type Webcam,
} from '@/lib/webcams';
import { renderComponent, rendersNothing } from './render-component';
import { requestReaders, walkImportGraph } from './import-graph';

// CAMP-190 — the rules that keep the pictures honest and the terms kept.
//
// Every fixture below is a row the database actually returned for
// `camp-bovec` on 04.10.2026, not an invention: titles, ids, distances
// and timestamps as they came.

const NOW = new Date('2026-10-04T19:35:00.000Z');
// What the API's `images.daylight.preview` returned for these cameras on
// 02.11.2026 — written out as DATA. The page must print what it is given;
// it is not allowed to produce this string itself, and the sentinels below
// go red if it ever starts to.
const apiImage = (ref: string) =>
  `https://imgproxy.windy.com/_/preview/plain/daylight/${ref}/original.jpg?v=2`;

/** The API's answer for a list of cameras, as the page receives it. */
const framesFor = (cams: Webcam[]) =>
  Object.fromEntries(cams.map((c) => [c.ref, apiImage(c.ref)]));

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
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW, frames: framesFor(REAL) });
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
        `<a[^>]*href="${c.detailUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>(?:(?!</a>)[\\s\\S])*?<img[^>]*src="${apiImage(c.ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
      );
      expect(anchor.test(html), `the frame for ${c.ref} is not inside its link`).toBe(true);
    }
  });

  // 🔴 THE CREDIT IS TWO LINKS, NOT ONE LINE OF TEXT. Their terms
  // ("Courtesy") give this markup:
  //
  //   Webcams provided by <a href="https://www.windy.com/">windy.com</a>
  //   &mdash; <a href="https://www.windy.com/webcams/add">add a webcam</a>
  //
  // We printed "Webcams provided by windy.com" with no anchor at all and
  // no "add a webcam". The assertions read the RENDERED credit block, not
  // the constant, so a component that stops using the constant goes red.
  test('the credit their terms dictate is rendered, word for word, with BOTH links', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW });
    const block = /<p[^>]*data-boilerplate="webcam-credit"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(block, 'no credit block in the rendered panel').not.toBeNull();
    const credit = block?.[1] ?? '';
    // Word for word, spelled out here so that editing the constant alone
    // cannot make the test agree with a wrong credit.
    expect(WINDY_CREDIT).toBe('Webcams provided by windy.com — add a webcam');
    expect(text(credit).startsWith('Webcams provided by windy.com — add a webcam')).toBe(true);
    const links = [...credit.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(
      (m) => [m[1], text(m[2])],
    );
    expect(links).toEqual([
      ['https://www.windy.com/', 'windy.com'],
      ['https://www.windy.com/webcams/add', 'add a webcam'],
    ]);
    expect(WINDY_HOME_URL).toBe('https://www.windy.com/');
    expect(WINDY_ADD_URL).toBe('https://www.windy.com/webcams/add');
  });

  // 🔴 Their other condition: "Link every image with us" — to the webcam
  // page (`urls.detail`) or the player. Checked on the rendered HTML:
  // every <img> sits inside an <a> whose href is that camera's own
  // `detailUrl`, and none is left over once the anchors are removed.
  test('🔴 no picture is left outside a link to its own Windy page', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW, frames: framesFor(REAL) });
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const pictured = anchors.filter((a) => /<img\b/.test(a[2]));
    expect(pictured.map((a) => a[1])).toEqual(REAL.map((c) => c.detailUrl));
    expect(html.replace(/<a\b[\s\S]*?<\/a>/g, '')).not.toMatch(/<img\b/);
    expect([...html.matchAll(/<img\b/g)]).toHaveLength(REAL.length);
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
  test('🔴 the service that asks Windy reads the DAYLIGHT frame, never the current one', () => {
    const svc = readFileSync(
      join(process.cwd(), '..', 'api', 'src', 'webcams', 'frames.ts'),
      'utf8',
    );
    expect(svc).toMatch(/\.images\s*\?\.daylight\?\.preview/);
    expect(svc).not.toMatch(/images\??\.current/);
  });

  // 🔴 THE SENTINEL FOR "WE DO NOT BUILD THE ADDRESS". Windy's terms allow
  // image URLs only as the API provided them. The fixture's address is
  // deliberately UNRELATED to the camera's id: the only way the page can
  // print it is to take it from the data it was given, and the only way
  // it can print one containing the id is to have assembled it.
  test('🔴 the picture address is the one the API gave, not one built from the id', () => {
    const given = 'https://imgproxy.windy.com/_/preview/plain/daylight/OPAQUE-7f3a/original.jpg?v=2';
    const c = cam({ ref: '1690466401' });
    const html = renderComponent(WebcamPanel, { webcams: [c], now: NOW, frames: { [c.ref]: given } });
    const srcs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toEqual([given]);
    expect(html, 'the id leaked into an address — it is being assembled').not.toContain(
      `/${c.ref}/`,
    );
  });

  // 🔴 THE PAGE CARRIES NO PICTURE ADDRESS AT ALL. Windy says an address
  // is valid for 15 minutes; this HTML is read for days. Whatever the
  // component is given as `webcams`, the markup it produces before the
  // frames arrive has no <img> and no host, so nothing in the built page
  // can be dead in a quarter of an hour.
  test('🔴 without frames the markup holds no picture and no picture address', () => {
    const html = renderComponent(WebcamPanel, { webcams: REAL, now: NOW });
    expect(html).not.toMatch(/<img/);
    expect(html).not.toMatch(/imgproxy|original\.jpg|\/plain\//);
    // …and every card still says what it is and still links to Windy.
    expect(text(html)).toContain('View this camera on windy.com');
    for (const c of REAL) expect(html).toContain(`href="${c.detailUrl}"`);
    expect(html).toContain('data-count="3"');
  });

  test('🔴 a camera the API gave no frame for keeps its card, its link and no picture', () => {
    const html = renderComponent(WebcamPanel, {
      webcams: REAL,
      now: NOW,
      frames: { [REAL[0].ref]: apiImage(REAL[0].ref) },
    });
    expect([...html.matchAll(/<img\b/g)]).toHaveLength(1);
    expect([...html.matchAll(/View this camera on windy\.com/g)]).toHaveLength(2);
    for (const c of REAL) expect(html).toContain(`href="${c.detailUrl}"`);
  });

  test('the frames are read from the API answer one entry at a time', () => {
    const asked = ['1', '2', '3'];
    expect(parseFrames({ frames: { '1': apiImage('1'), '2': 'http://x/y.jpg', '3': 7, '9': apiImage('9') } }, asked))
      .toEqual({ '1': apiImage('1') });
    for (const bad of [null, undefined, 'x', 42, {}, { frames: null }, { frames: 'a' }, { frames: [] }]) {
      expect(parseFrames(bad, asked)).toEqual({});
    }
    expect(framesRequestUrl(['1', '2'], 'https://api.example')).toBe(
      'https://api.example/webcams/frames?refs=1,2',
    );
  });

  // 🔴 THE CLIENT'S BEHAVIOUR, WITHOUT A BROWSER. The component's effect
  // is one call to `watchForFrames`, which takes its fetch and its
  // observer as arguments — so each promise the page makes about WHEN it
  // asks Windy's frames, and what happens when that goes wrong, is run
  // here against fakes.
  test.describe('watchForFrames', () => {
    const ok = (frames: unknown) => async () => ({ ok: true, json: async () => ({ frames }) });
    const flush = () => new Promise((r) => setTimeout(r, 0));

    test('asks NOTHING until the reader is near the panel, then exactly once', async () => {
      const urls: string[] = [];
      let near: () => void = () => {};
      const got: Array<Record<string, string>> = [];
      watchForFrames({} as Element, ['1', '2'], (f) => got.push(f), {
        fetchImpl: async (u) => {
          urls.push(u);
          return ok({ '1': apiImage('1') })();
        },
        observe: (_el, onNear) => {
          near = onNear;
          return () => {};
        },
      }, 'https://api.example');
      await flush();
      expect(urls, 'asked before the reader got near').toEqual([]);
      near();
      await flush();
      expect(urls).toEqual(['https://api.example/webcams/frames?refs=1,2']);
      expect(got).toEqual([{ '1': apiImage('1') }]);
    });

    test('with no observer in the browser it asks at once', async () => {
      const urls: string[] = [];
      watchForFrames({} as Element, ['7'], () => {}, {
        fetchImpl: async (u) => { urls.push(u); return ok({})(); },
      }, '');
      await flush();
      expect(urls).toEqual(['/webcams/frames?refs=7']);
    });

    test('🔴 a refusal, an outage and a garbage answer each leave the cards, with no picture', async () => {
      const cases: Array<[string, () => Promise<{ ok: boolean; json: () => Promise<unknown> }>]> = [
        ['429/503', async () => ({ ok: false, json: async () => ({}) })],
        ['network error', async () => { throw new Error('offline'); }],
        ['not json', async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })],
        ['wrong shape', ok('nonsense')],
      ];
      for (const [label, fetchImpl] of cases) {
        const got: Array<Record<string, string>> = [];
        watchForFrames(null, ['1'], (f) => got.push(f), { fetchImpl }, '');
        await flush();
        expect(got, label).toEqual([{}]);
      }
    });

    test('a reader who has left is not written to, and the observer is released', async () => {
      let released = false;
      let near: () => void = () => {};
      const got: unknown[] = [];
      const stop = watchForFrames({} as Element, ['1'], (f) => got.push(f), {
        fetchImpl: ok({ '1': apiImage('1') }),
        observe: (_el, onNear) => {
          near = onNear;
          return () => { released = true; };
        },
      }, '');
      near();
      stop();
      await flush();
      expect(got).toEqual([]);
      expect(released).toBe(true);
    });
  });

  // 🔴 The client part cannot be rendered by the unit harness (hooks), so
  // its three promises are read from the source: it asks only through
  // `watchForFrames`, it opens the picture at once (a lazy image
  // fetched late is a dead address), and it never marks a request as
  // uncacheable — which would make every page in its import graph look
  // dynamic to the static-page guards.
  test('the client asks through one function, loads at once, and reads no request', () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'webcam-panel.tsx'),
      'utf8',
    );
    expect(src).toMatch(/watchForFrames\(/);
    expect(src).not.toMatch(/loading="lazy"|loading='lazy'/);
    expect(src).toMatch(/IntersectionObserver/);
    expect(src).not.toMatch(/no-store|force-dynamic|headers\(\)|cookies\(\)/);
    expect(src.match(/\bfetch\(/g)).toHaveLength(1);
  });

  // 🔴 THE PAGE STAYS STATIC. The panel now makes a request of its own —
  // from the reader's browser, after the page has been served — and that
  // must never turn into the page reading a request. The same walk the
  // campsite-page guard in report-problem.spec.tsx makes, with the anchor
  // that matters here: it has to REACH the panel and the lib, or a clean
  // result says nothing about them.
  test('🔴 the campsite page still reads no request, panel and frame client included', () => {
    const SRC = join(process.cwd(), 'src');
    const page = join(SRC, 'app', 'camping', '[country]', '[region]', '[slug]', 'page.tsx');
    const seen = walkImportGraph(SRC, [page]);
    const names = [...seen].map((f) => f.slice(SRC.length + 1));
    expect(names).toContain('components/webcam-panel.tsx');
    expect(names).toContain('lib/webcams.ts');
    expect(requestReaders(SRC, seen)).toEqual([]);
  });

  // 🔴 The same sentinel, over the SOURCE. A fixture test cannot see a
  // helper that is defined and never called, or a second place that
  // assembles the address. The path shape and the file name are what an
  // assembled address needs; the host alone is allowed to be NAMED (the
  // API refuses any other host), but never in a template literal or a
  // concatenation. Migrations are excluded: they hold SQL, not a builder.
  test('🔴 no runtime source assembles a Windy image address', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = join(dir, e.name);
        if (e.isDirectory()) return e.name === 'migrations' || e.name === 'node_modules' ? [] : walk(full);
        return /\.(ts|tsx|mjs|js)$/.test(e.name) && !/\.(spec|test)\./.test(e.name) ? [full] : [];
      });
    const root = join(process.cwd(), '..', '..');
    const files = [
      ...walk(join(root, 'apps', 'web', 'src')),
      ...walk(join(root, 'apps', 'api', 'src')),
      join(root, 'scripts', 'windy', 'fetch-webcams.mjs'),
    ];
    expect(files.length, 'the walk found nothing — the path is wrong').toBeGreaterThan(50);
    const assembles = (t: string) =>
      /\/plain\/|original\.jpg/.test(t) ||
      /`[^`]*imgproxy[^`]*\$\{/.test(t) ||
      /`[^`]*\$\{[^`]*imgproxy/.test(t) ||
      /imgproxy[^'"`\n]*['"`]\s*\+/.test(t) ||
      /\+\s*['"`][^'"`\n]*imgproxy/.test(t);
    const offenders = files.filter((f) => assembles(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(root, ''))).toEqual([]);

    // The detector itself can be fooled by nothing it is meant to catch.
    for (const bad of [
      "const u = `https://imgproxy.windy.com/_/${size}/x`;",
      "const u = 'https://imgproxy.windy.com/_/preview/plain/daylight/' + id;",
      "const base = 'https://imgproxy.windy.com/'; const u = base + id + '/original.jpg'",
    ]) {
      expect(assembles(bad), bad).toBe(true);
    }
    expect(assembles("export const FRAME_HOST = 'imgproxy.windy.com';")).toBe(false);
  });

  // 🔴 The two places that must name ONE host: the API's allow-list and
  // the CSP `img-src`. A frame on a host the CSP does not name is a
  // picture blocked in every reader's browser while 2 000 unit tests pass.
  test('the host a frame may have is the one the CSP allows', () => {
    const root = join(process.cwd(), '..', '..');
    const svc = readFileSync(join(root, 'apps', 'api', 'src', 'webcams', 'frames.ts'), 'utf8');
    const host = /export const FRAME_HOST = '([^']+)'/.exec(svc)?.[1];
    expect(host).toBe('imgproxy.windy.com');
    const csp = readFileSync(join(root, 'apps', 'web', 'scripts', 'security-headers.mjs'), 'utf8');
    expect(csp).toContain(`"img-src 'self' data: blob: https://${host}"`);
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
test.describe('CAMP-156: твердження про покриття називає свою мережу', () => {
  // 🔴 Назва джерела стояла ЛИШЕ там, де камери є: `WINDY_CREDIT`
  // друкується під картками. А речення про покриття живе рівно в тому
  // стані, де карток немає — тож читачеві нізвідки було дізнатись, про
  // яку мережу йдеться. Твердження, джерела якого не названо, читач
  // перевірити не може, а покриття Windy по ЄС нерівномірне.

  test('🔴 «камер поруч немає» каже, у ЧИЇЙ мережі їх немає', () => {
    const out = text(renderComponent(WebcamPanel, { webcams: [], now: NOW }));
    expect(absence([], NOW)).toBe('none');
    expect(out, 'речення про покриття не називає мережі').toContain(WEBCAM_NETWORK);
    // І не просто згадує назву десь поруч, а саме звужує твердження.
    expect(out).toContain('the one network we look in');
    expect(
      out,
      'читач має знати, що камера може існувати й не бути в цій мережі',
    ).toContain('not be listed with them');
  });

  test('🔴 і «камери замовкли» — теж', () => {
    const STALE = new Date(NOW.getTime() + (CAMERA_DEAD_AFTER_MINUTES + 60) * 60_000);
    expect(absence(REAL, STALE)).toBe('stale');
    const out = text(renderComponent(WebcamPanel, { webcams: REAL, now: STALE }));
    expect(out, 'у цьому стані теж немає карток, отже й кредиту').toContain(WEBCAM_NETWORK);
    expect(out).toContain('none of them has reported');
  });

  test('🔴 сама назва не може бути порожньою', () => {
    // 🔴 Матриця показала, що без цього випадку константу можна було
    // зробити порожнім рядком і всі тести лишались зеленими:
    // `toContain('')` істинне завжди, а сторінка казала «on , the one
    // network we look in». Перевірка, зелена за побудовою.
    //
    // Питаємо ВЛАСТИВІСТЬ, а не рядок: назва джерела виглядає як назва
    // джерела. Перейменування мережі це переживе, порожнеча — ні.
    expect(WEBCAM_NETWORK).toMatch(/^\S+\.\S+$/);
  });

  test('🔴 у порожньому стані НЕМАЄ кредиту Windy', () => {
    // 🔴 Рецензія знайшла найтоншу з трьох: `'windy.com'` — ПІДРЯДОК
    // `WINDY_CREDIT = 'Webcams provided by windy.com'`, і той теж
    // імпортований у цей компонент. Мутація `{WEBCAM_NETWORK}` →
    // `{WINDY_CREDIT}` лишала всі 31 зеленими, а сторінка друкувала
    // «No public webcam within 25 km of this campsite is listed on
    // Webcams provided by windy.com» — тобто ліцензійний кредит саме
    // там, де їхнього вмісту не показано жодного.
    //
    // Кредит належить рівно туди, де є картки. Питаємо це прямо.
    const STALE = new Date(NOW.getTime() + (CAMERA_DEAD_AFTER_MINUTES + 60) * 60_000);
    const states: [string, { webcams: Webcam[]; now: Date }][] = [
      ['немає камер', { webcams: [], now: NOW }],
      ['камери замовкли', { webcams: REAL, now: STALE }],
    ];
    for (const [label, props] of states) {
      const out = text(renderComponent(WebcamPanel, props));
      expect(out, label).not.toContain(WINDY_CREDIT);
    }
    // І навпаки: там, де картки є, кредит мусить бути.
    expect(text(renderComponent(WebcamPanel, { webcams: REAL, now: NOW }))).toContain(
      WINDY_CREDIT,
    );
  });

  test('🔴 кредит Windy — дослівний, бо так вимагають їхні умови', () => {
    // 🔴 Успадкований дефект, який рецензія знайшла дорогою: мутація
    // `'Webcams by windy.com'` лишала всі 31 зеленими. Літерал існує
    // рівно в одному місці репозиторію, тож дослівності не тримало
    // ніщо — а це умова ліцензії, не стиль.
    //
    // 02.11.2026: їхній текст — «Webcams provided by windy.com — add a
    // webcam» з ДВОМА посиланнями; сторож на дві адреси й на видимий
    // текст у відрендереній розмітці стоїть вище, у `what the terms
    // require of every frame we show`.
    expect(WINDY_CREDIT).toBe('Webcams provided by windy.com — add a webcam');
  });

  test('🔴 назва мережі — це той самий хост, куди ходить імпортер', () => {
    // 🔴 `WEBCAM_NETWORK = 'example.org'` лишало всі 31 зеленими:
    // константа не була прив'язана ні до чого. Радіус має свого
    // сторожа (`scripts/ci/check-webcam-radius.mjs`), назва мережі — ні.
    //
    // Єдина сторона, яка справді знає, чия це мережа, — скрипт, що
    // ходить по дані. Беремо хост звідти.
    const fetcher = readFileSync(
      join(process.cwd(), '..', '..', 'scripts', 'windy', 'fetch-webcams.mjs'),
      'utf8',
    );
    const api = /export const API = '([^']+)'/.exec(fetcher)?.[1];
    expect(api).toBeTruthy();
    const host = new URL(api as string).hostname; // api.windy.com
    expect(host.endsWith(`.${WEBCAM_NETWORK}`) || host === WEBCAM_NETWORK).toBe(true);
  });

  test('🔴 назва мережі не зашита в компонент рядком', () => {
    // 🔴 ЦЕ ЧИТАЄ ВИХІДНИЙ ТЕКСТ, і без цього два тести вище мали дірку:
    // зашитий літерал `windy.com` проходив би `toContain(WEBCAM_NETWORK)`
    // непомітно, бо константа теж `windy.com`. Та сама пастка, що й з
    // інтервалом у CAMP-301 — там її показала матриця.
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'webcam-panel.tsx'),
      'utf8',
    );
    expect(src, 'назва мережі має приїжджати з lib/webcams, а не стояти текстом')
      .not.toMatch(/['"`][^'"`]*windy\.com/);
    // 🔴 `toContain('WEBCAM_NETWORK')` задовольнявся САМИМ рядком
    // import — під мутацією, що прибирає константу з розмітки, він
    // лишався зеленим. Рахуємо вживання у JSX: їх двоє, по одному на
    // кожен порожній стан.
    expect(src.match(/\{WEBCAM_NETWORK\}/g) ?? []).toHaveLength(2);
  });
});

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
    expect(absence(REAL, STALE_CLOCK)).toBe('stale');

    expect(
      stale,
      'a campsite with three listed cameras is being told the network does not cover it',
    ).not.toContain('No public webcam');
    expect(stale).toContain('none of them has reported for more than a day');
    expect(stale, 'the sentence must name whose reading is old').toContain('our last reading');
  });

  test('…and a campsite with no camera at all still says exactly that', () => {
    const out = text(renderComponent(WebcamPanel, { webcams: [], now: NOW }));
    expect(absence([], NOW)).toBe('none');
    expect(out).toContain('No public webcam within 25 km');
    expect(out, 'nothing was listed, so there is no reading of ours to be old')
      .not.toContain('our last reading');
  });

  // 🔴 AND A FOURTH, WHICH I DID NOT SEE UNTIL REVIEW COUNTED THEM.
  //
  // `absence()` used to read the RAW list while the panel rendered
  // `showable()`. So rows dropped for anything other than age — an
  // `http://` link we may not use, a camera that has never reported at
  // all — came out as "none of them has reported for more than a day.
  // That is how old our last reading of them is", which is untrue in
  // both directions: there is no reading of ours to be old, and the
  // network is not to blame either.
  //
  // Only `stale` entitles the page to talk about the age of what we
  // hold. Everything else means we have nothing honest to say, and the
  // panel says nothing.
  test('🔴 rows we cannot use are not reported as rows that went quiet', () => {
    const neverReported = [cam({ lastFrameAt: null }), cam({ ref: 'b', lastFrameAt: null })];
    expect(showable(neverReported, NOW)).toHaveLength(0);
    expect(
      absence(neverReported, NOW),
      'a camera that never reported is being called one whose reading is old',
    ).toBe('unknown');
    expect(rendersNothing(WebcamPanel, { webcams: neverReported, now: NOW })).toBe(true);

    // The same for a link the terms do not let us use.
    const badLink = [cam({ detailUrl: 'http://windy.com/webcams/1690466401' })];
    expect(showable(badLink, NOW)).toHaveLength(0);
    expect(absence(badLink, NOW)).toBe('unknown');

    // And a genuinely old camera still gets the sentence that is true
    // of it, so the branch above has not swallowed the real case.
    expect(absence(REAL, STALE_CLOCK)).toBe('stale');
    expect(
      text(renderComponent(WebcamPanel, { webcams: REAL, now: STALE_CLOCK })),
    ).toContain('none of them has reported');

    // A mixture is not an absence at all: one usable camera means cards.
    const mixed = [cam({ lastFrameAt: null }), cam({ ref: 'c' })];
    expect(absence(mixed, NOW), 'one usable camera should mean the panel is not empty').toBeNull();
    expect(showable(mixed, NOW)).toHaveLength(1);
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
      expect(absence(notLooked, NOW)).toBe('unknown');
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
