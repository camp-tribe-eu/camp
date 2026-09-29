import { expect, test, type APIRequestContext } from './api-request';
import { API_BASE } from '@/lib/api';
import { AIR_ATTRIBUTION } from '@/lib/air-quality';
import { findForbiddenWords } from '@/lib/wording';
import { everythingSaid, visibleText } from '../unit/rendered-text';

// CAMP-164 — the air quality section, read out of the SERVED HTML.
//
// 🔴 EVERY ASSERTION HERE READS THE BYTES THE SERVER SENT.
//
// `request.get(path).text()` — not `page.locator`, not a class name, not
// an `sr-only` caption, not the function that generated the string, and
// not JavaScript: the bytes a crawler and a reader without JavaScript are
// given. The text is taken through `visibleText`, which drops hidden
// elements, so a sentence that survives only in a hidden one is not a
// sentence the page said. If the wording is not in the HTML, this file
// must go red.
//
// 🔴 NO EXPECTED VALUE GROWS FROM THE FIELD IT CHECKS.
//
// What the fixture holds is designed in
// apps/api/test/fixtures/ci-seed-hourly-air-quality.sql and its table
// is repeated below as CONSTANTS TYPED HERE: the station names, the
// distances the seed places them at, the levels. Nothing is read out of
// the API payload to say what a page should print — the payload is only
// used to know which pages exist. "Fair (level 2 of 6)" is a string in
// this file, not `levelText(payload.band)`.
//
// The one place a distance is checked against something computed rather
// than designed is the radius, and it is checked against the number 20,
// which is written here and is not read from the code under test.
//
// 🔴 IT GATES ITSELF ON THE DATA AND FAILS rather than skips. Run against
// a database with no air quality rows, every assertion below would pass
// over nothing — which is how a suite comes to agree with a bug.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December',
];

interface Served {
  path: string;
  html: string;
  /** The air quality section, cut out of the served HTML. */
  section: string;
  /** What a reader is shown in it. */
  text: string;
  state: string;
}

let pages: Served[] = [];

/** The air section, cut out by its test id. It ends where the next section starts. */
function airSection(html: string, where: string): string {
  const at = html.indexOf('data-testid="air-quality"');
  expect(at, `${where}: the air quality section is not in the served HTML`).toBeGreaterThan(-1);
  expect(
    html.indexOf('data-testid="air-quality"', at + 1),
    `${where}: more than one air quality section`,
  ).toBe(-1);
  const rest = html.slice(at);
  const end = rest.indexOf('<section', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

async function resolvePages(request: APIRequestContext): Promise<Served[]> {
  // Whole-list endpoint first, then the pages themselves. Nothing is
  // named: the subjects are whatever the fixture holds.
  const markers: { path: string }[] = (
    await (
      await request.get(`${API_BASE}/spots/map/points?bbox=-180,-85,180,85&limit=20000`)
    ).json()
  ).markers;
  expect(markers.length, 'the fixture holds no campsites at all').toBeGreaterThan(20);

  const out: Served[] = [];
  for (const m of markers) {
    const res = await request.get(m.path);
    if (!res.ok()) continue;
    const html = await res.text();
    const section = airSection(html, m.path);
    out.push({
      path: m.path,
      html,
      section,
      text: visibleText(section),
      state: /data-state="([^"]+)"/.exec(section)?.[1] ?? '',
    });
  }
  return out;
}

test.beforeAll(async ({ request }) => {
  pages = await resolvePages(request);
});

const named = (station: string): Served[] => pages.filter((p) => p.text.includes(station));
const inState = (state: string): Served[] => pages.filter((p) => p.state === state);

/** The subject pages, found by the designed names. */
const S1 = 'CI fixture station 1 (reported)';
const S2 = 'CI fixture station 2 (partly modelled)';
const S3 = 'CI fixture station 3 (silent)';
const S4 = 'CI fixture station 4 (stale)';
const S5 = 'CI fixture station 5 (14.5 km)';
const S6 = 'CI fixture station 6 (15.5 km)';
const S7 = 'CI fixture station 7 (no particulate matter)';

test.describe('the fixture has a subject for every state — or this suite proves nothing', () => {
  test('every state the page can be in has at least one page', () => {
    for (const state of ['reported', 'mixed', 'modelled', 'no-fresh-data', 'no-data']) {
      expect(inState(state).length, `no campsite renders the "${state}" state`).toBeGreaterThan(0);
    }
    for (const s of [S1, S2, S3, S4, S5, S7]) {
      expect(named(s).length, `no page names ${s}`).toBeGreaterThan(0);
    }
  });

  test('every campsite page has exactly one state, out of the five', () => {
    expect(pages.length).toBeGreaterThan(20);
    for (const p of pages) {
      expect(['reported', 'mixed', 'modelled', 'no-fresh-data', 'no-data'], p.path).toContain(p.state);
    }
    // The five are exhaustive: every page is counted once.
    const total = ['reported', 'mixed', 'modelled', 'no-fresh-data', 'no-data']
      .map((s) => inState(s).length)
      .reduce((a, b) => a + b, 0);
    expect(total).toBe(pages.length);
  });

  // 🔴 NEVER BLANK, and never a broken value.
  test('no page renders an empty section or a value that is not one', () => {
    for (const p of pages) {
      expect(p.text.length, `${p.path}: an empty air quality section`).toBeGreaterThan(80);
      expect(p.text, p.path).toContain('Air quality');
      expect(p.text, `${p.path}: a broken value`).not.toMatch(/\b(?:undefined|NaN|null)\b|\[object/);
    }
  });
});

// ---------------------------------------------------------------------
// 1. A model is not a reading.
// ---------------------------------------------------------------------

test.describe('display requirement 1: a modelled value renders differently from a measurement', () => {
  test('a reported reading names its station, kind, distance and hour, and says it was reported', () => {
    const p = named(S1).find((x) => x.text.includes('3.2 km'))!;
    expect(p, 'no page shows station 1 at the 3.2 km the seed places it').toBeDefined();
    expect(p.state).toBe('reported');
    expect(p.text).toContain('Nearest station');
    expect(p.text).toContain('CI fixture station 1 (reported) — background station, 3.2 km from this campsite');
    expect(p.text).toContain('Fair (level 2 of 6)');
    expect(p.text).toMatch(/European Air Quality Index, \d{2}:00 UTC, \d{1,2} [A-Z][a-z]+ 20\d\d/);
    expect(p.text).toContain('Reported by the station');
    // A reading nobody modelled never says "model" anywhere.
    expect(p.text).not.toMatch(/modelled|\bmodel\b/i);
  });

  test('the 1 km model says, in words, that it is a model and not a measurement', () => {
    const modelled = inState('modelled');
    expect(modelled.length, 'the fixture holds three model values, one of them stale').toBe(2);
    for (const p of modelled) {
      expect(p.text, p.path).toContain('Modelled index for this location');
      expect(p.text, p.path).toContain('Modelled estimate, not a measurement');
      expect(p.text, p.path).toContain('a forecast model downscaled from Copernicus CAMS, not a reading');
      // …and it is NOT dressed as a report.
      expect(p.text, p.path).not.toContain('Reported by the station');
      expect(p.text, p.path).not.toContain('Nearest station');
      expect(p.text, p.path).not.toMatch(/reported to the EEA/i);
    }
    // The two the seed designed: Moderate beside station 6, Good elsewhere.
    expect(modelled.map((p) => /(Good|Moderate) \(level [13] of 6\)/.exec(p.text)?.[1]).sort()).toEqual([
      'Good',
      'Moderate',
    ]);
  });

  test('the model and the reading are told apart in the markup a reader is given', () => {
    const model = inState('modelled')[0];
    const reading = named(S1)[0];
    expect(model.section).toContain('data-basis="modelled"');
    expect(reading.section).toContain('data-basis="reported"');
    expect(model.section).not.toContain('data-basis="reported"');
    expect(reading.section).not.toContain('data-basis="modelled"');
  });

  test('a mixed hour marks the modelled pollutant and only that one', () => {
    const p = named(S2).find((x) => x.text.includes('5.4 km'))!;
    expect(p, 'no page shows station 2 at the 5.4 km the seed places it').toBeDefined();
    expect(p.state).toBe('mixed');
    const items = [...p.section.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => visibleText(m[1]));
    expect(items).toEqual([
      'PM10 — 23 µg/m³, Fair',
      'NO2 — 40 µg/m³, Moderate — modelled estimate',
    ]);
    expect(p.text).toContain('Partly modelled: 1 of 2 pollutants is a modelled estimate, not measurements');
    expect(p.text).toContain('Moderate (level 3 of 6)');
    expect(p.text).toContain('CI fixture station 2 (partly modelled) — traffic station, 5.4 km');
    // The pollutant that sets the level is the modelled one, and the page says so.
    expect(p.text).toContain('The level is set by NO2, which is a modelled estimate.');
    expect(p.text).toContain('The EEA fills the gap with a model');
  });

  test('every mixed page marks a modelled pollutant, and no reported page marks one', () => {
    for (const p of inState('mixed')) expect(p.text, p.path).toContain('modelled estimate');
    for (const p of inState('reported')) expect(p.text, p.path).not.toMatch(/modelled/i);
  });
});

// ---------------------------------------------------------------------
// 2. The wording.
// ---------------------------------------------------------------------

test.describe('display requirement 2: "as reported to the EEA, not formally verified"', () => {
  test('every reported and mixed page says exactly that, in its own element', () => {
    const reading = [...inState('reported'), ...inState('mixed')];
    expect(reading.length).toBeGreaterThan(3);
    for (const p of reading) {
      const el = /data-testid="air-wording"[^>]*>([\s\S]*?)<\/p>/.exec(p.section);
      expect(el, `${p.path}: no wording element`).not.toBeNull();
      expect(visibleText(el![1]), p.path).toBe('As reported to the EEA, not formally verified.');
    }
  });

  // 🔴 NOT under a model: "reported to the EEA" is false of something
  // nobody reported.
  test('no modelled page and no page without a value says it was reported', () => {
    for (const p of [...inState('modelled'), ...inState('no-fresh-data'), ...inState('no-data')]) {
      expect(p.text, p.path).not.toContain('As reported to the EEA');
    }
    for (const p of inState('modelled')) expect(p.text, p.path).toContain('Not formally verified.');
  });

  test('no page says "the air quality is …"', () => {
    for (const p of pages) {
      expect(p.text, p.path).not.toMatch(/air quality is|air is (?:good|clean|safe|fine)|the air (?:here )?is/i);
    }
  });
});

// ---------------------------------------------------------------------
// 3. No fresh data.
// ---------------------------------------------------------------------

/** "10:00 UTC, 28 September 2026" → epoch ms. */
function parseHour(label: string): number {
  const m = /(\d{2}):00 UTC, (\d{1,2}) ([A-Z][a-z]+) (\d{4})/.exec(label);
  expect(m, `not an hour label: ${label}`).not.toBeNull();
  return Date.UTC(Number(m![4]), MONTHS.indexOf(m![3]), Number(m![2]), Number(m![1]));
}

test.describe('display requirement 3: a station missing from the current hour says "no fresh data"', () => {
  test('a station with no reading says so, and every page beside it does too', () => {
    const silent = named(S3);
    expect(silent.length, 'station 3 is the silent one').toBeGreaterThan(5);
    for (const p of silent) {
      expect(p.state, p.path).toBe('no-fresh-data');
      expect(p.text, p.path).toContain('No fresh data.');
      expect(p.text, p.path).toContain('has not reported to the EEA recently');
      expect(p.text, p.path).toMatch(/CI fixture station 3 \(silent\) \(background station, \d+(?:\.\d)? (?:km|m) away\)/);
      // Not a word about the air: no level, no basis, no reading.
      expect(p.text, p.path).not.toMatch(/\(level \d of 6\)|Reported by the station|As reported/);
    }
  });

  test('the silent station is described where the seed put it: 8.0 km from its campsite', () => {
    expect(named(S3).some((p) => p.text.includes('background station, 8.0 km away'))).toBe(true);
  });

  // 🔴 THE FIXTURE'S OWN TRAP. If the query skipped a station that has no
  // reading and fell through to the model, campsite pages beside station 3
  // would print a model value and nothing would say the station is silent.
  test('a silent station does not hand its campsites to the model', () => {
    for (const p of named(S3)) {
      expect(p.text, p.path).not.toContain('Modelled');
      expect(p.state, p.path).not.toBe('modelled');
    }
  });

  test('a reading that is too old says so, with its hour, and prints no level', () => {
    const stale = named(S4);
    expect(stale.length).toBeGreaterThan(0);
    const now = Date.now();
    for (const p of stale) {
      expect(p.state, p.path).toBe('no-fresh-data');
      expect(p.text, p.path).toContain('No fresh data.');
      const at = /is from (\d{2}:00 UTC, \d{1,2} [A-Z][a-z]+ \d{4}), more than 4 hours ago/.exec(p.text);
      expect(at, `${p.path}: no hour and budget in "${p.text}"`).not.toBeNull();
      // The seed writes it 30 h before the hour it ran in. Read back from
      // the page and compared with the clock, not with the payload.
      const ageH = (now - parseHour(at![1])) / 3_600_000;
      expect(ageH, p.path).toBeGreaterThan(29);
      expect(ageH, p.path).toBeLessThan(40);
      expect(p.text, p.path).not.toMatch(/\(level \d of 6\)/);
    }
  });

  test('a model that has not been refreshed says so, and prints no level', () => {
    const stale = pages.filter((p) => p.text.includes('Our last read of the EEA’s modelled index'));
    expect(stale.length, 'the seed holds one stale model value').toBe(1);
    const p = stale[0];
    expect(p.state).toBe('no-fresh-data');
    expect(p.text).toContain('No fresh data.');
    expect(p.text).toMatch(/is from \d{2}:00 UTC, \d{1,2} [A-Z][a-z]+ \d{4}, more than 4 hours ago/);
    expect(p.text).not.toMatch(/\(level \d of 6\)|Modelled estimate/);
  });

  test('a place with no station and no model value says so in its own words', () => {
    const none = inState('no-data');
    expect(none.length).toBeGreaterThan(5);
    for (const p of none) {
      expect(p.text, p.path).toContain(
        'No air-quality data for this location: no monitoring station lies within 15 km and the EEA’s modelled index does not cover this spot.',
      );
      expect(p.text, p.path).not.toContain('Read from the EEA on');
    }
  });

  test('three different reasons, three different sentences, one phrase', () => {
    const whys = new Set(
      inState('no-fresh-data').map((p) =>
        p.text.includes('has not reported to the EEA recently')
          ? 'silent'
          : p.text.includes('is from') && p.text.includes('nearest station')
            ? 'stale-station'
            : 'stale-model',
      ),
    );
    expect([...whys].sort()).toEqual(['silent', 'stale-model', 'stale-station']);
    for (const p of inState('no-fresh-data')) expect(p.text, p.path).toContain('No fresh data.');
  });
});

// ---------------------------------------------------------------------
// The radius, checked against a number written here.
// ---------------------------------------------------------------------

test.describe('the radius', () => {
  // 🔴 Independent of the code under test: 15 is typed here, and the
  // distances are read back from what the page prints.
  test('no page names a station more than 15 km away', () => {
    let seen = 0;
    for (const p of pages) {
      for (const m of p.text.matchAll(/(\d+(?:\.\d)?) (km|m) (?:from this campsite|away)/g)) {
        seen += 1;
        const km = m[2] === 'km' ? Number(m[1]) : Number(m[1]) / 1000;
        expect(km, `${p.path}: ${m[0]}`).toBeLessThanOrEqual(15);
      }
    }
    expect(seen, 'no distance was printed anywhere').toBeGreaterThan(20);
  });

  test('a station 14.5 km away is inside it, and shown', () => {
    expect(named(S5).some((p) => p.text.includes('background station, 14.5 km from this campsite'))).toBe(true);
    const p = named(S5).find((x) => x.text.includes('14.5 km'))!;
    expect(p.state).toBe('reported');
    expect(p.text).toContain('Good (level 1 of 6)');
  });

  // The other side of the same edge. Station 6 is 15.5 km from its
  // campsite; if the radius were 20 km it would be named at 15.5 km.
  test('a station 15.5 km away is outside it, and the campsite gets the model instead', () => {
    for (const p of named(S6)) {
      const m = /CI fixture station 6 \(15\.5 km\) \(?[^,]*, (\d+(?:\.\d)?) km/.exec(p.text);
      if (m) expect(Number(m[1]), p.path).toBeLessThanOrEqual(15);
    }
    // The seed put the Moderate model value on exactly that campsite.
    const beside = inState('modelled').filter((p) => p.text.includes('Moderate (level 3 of 6)'));
    expect(beside).toHaveLength(1);
    expect(beside[0].text).not.toContain('CI fixture station');
  });

  test('a station with no particulate matter says so', () => {
    const p = named(S7).find((x) => x.text.includes('4.0 km'))!;
    expect(p, 'no page shows station 7 at the 4.0 km the seed places it').toBeDefined();
    expect(p.text).toContain('This index includes no particulate matter (PM2.5 or PM10).');
    expect(p.text).toContain('industrial station');
    for (const q of pages.filter((x) => x.state === 'reported' && !x.text.includes(S7))) {
      expect(q.text, q.path).not.toContain('no particulate matter');
    }
  });
});

// ---------------------------------------------------------------------
// The attribution the licence requires.
// ---------------------------------------------------------------------

test.describe('the attribution the licence requires', () => {
  // 🔴 In EVERY state, including the two that hold no value: "no station
  // lies within 15 km" is a claim made on the EEA's roster.
  test('every page names the EEA, its licence and the EEA’s own sentence', () => {
    for (const p of pages) {
      expect(p.text, p.path).toContain('European Environment Agency');
      expect(p.text, p.path).toContain('CC BY 4.0');
      expect(p.section, p.path).toContain('creativecommons.org/licenses/by/4.0/');
      expect(p.section, p.path).toContain('https://airindex.eea.europa.eu/AQI/index.html');
      expect(p.text, p.path).toContain(AIR_ATTRIBUTION);
    }
  });

  // 🔴 The constant, and ALSO the literal: the constant is what the page
  // renders, so asserting against it alone would agree with a retyped
  // string that was retyped in both places.
  test('the sentence is the EEA’s, word for word', () => {
    const literal =
      'The European Air Quality Index was developed jointly by the European Commission’s Directorate General for Environment and the European Environment Agency to inform citizens and public authorities about the recent air quality status across Europe.';
    expect(AIR_ATTRIBUTION).toBe(literal);
    for (const p of pages) expect(p.text, p.path).toContain(literal);
  });

  // The date is where a reader sees how old what they are looking at is.
  test('every page that holds a value says when the EEA’s file was read, and it is today', () => {
    const now = Date.now();
    const withValue = pages.filter((p) => ['reported', 'mixed', 'modelled'].includes(p.state));
    expect(withValue.length).toBeGreaterThan(5);
    for (const p of withValue) {
      const m = /Read from the EEA on (\d{1,2}) ([A-Z][a-z]+) (\d{4}), (\d{2}):(\d{2}) UTC\./.exec(p.text);
      expect(m, `${p.path}: no read date`).not.toBeNull();
      const at = Date.UTC(Number(m![3]), MONTHS.indexOf(m![2]), Number(m![1]), Number(m![4]), Number(m![5]));
      // The seed ran a moment before the build, a moment before this.
      expect(Math.abs(now - at) / 3_600_000, p.path).toBeLessThan(12);
    }
  });

  test('a page that holds no value names no date it does not have', () => {
    for (const p of inState('no-data')) expect(p.text, p.path).not.toContain('Read from the EEA on');
  });

  // The text that is identical on every page is marked as boilerplate for
  // scripts/seo/check-duplicate-pages.mjs. Asserted on the served HTML
  // because the guard only fails on a pair that happens to sit at its
  // edge — CAMP-168 shipped red for exactly that reason.
  test('marks the text that is identical on every page as boilerplate — and not the text that varies', () => {
    for (const p of pages) {
      expect(p.section, p.path).toContain(`data-boilerplate="air-attribution">${AIR_ATTRIBUTION}</span>`);
      // What varies is NOT marked.
      expect(p.section, p.path).not.toMatch(/data-boilerplate="[^"]*"[^>]*>[^<]*Read from the EEA/);
      expect(p.section, p.path).not.toMatch(
        /data-boilerplate="[^"]*"[^>]*>[^<]*(?:fixture station|\d+(?:\.\d)? (?:km|m) (?:from this campsite|away))/,
      );
    }
    for (const p of [...inState('reported'), ...inState('mixed')]) {
      expect(p.section, p.path).toMatch(/data-boilerplate="air-wording"[^>]*>As reported to the EEA/);
      for (const label of ['Nearest station', 'Basis', 'Pollutants']) {
        expect(p.section, `${p.path}: ${label}`).toMatch(
          new RegExp(`data-boilerplate="air-label"[^>]*>\\s*${label}\\s*</dt>`),
        );
      }
    }
    // The states whose whole text is one constant sentence are the ones
    // that made CAMP-168's guard red; each carries its marker.
    for (const p of pages) {
      expect(p.section, p.path).toMatch(/data-boilerplate="air-heading"[^>]*>Air quality<\/h2>/);
    }
    for (const p of inState('no-data')) {
      expect(p.section, p.path).toMatch(/data-boilerplate="air-no-data"[^>]*>No air-quality data for this location/);
    }
    for (const p of inState('no-fresh-data')) {
      expect(p.section, p.path).toMatch(/data-boilerplate="air-no-fresh-data"[^>]*>No fresh data\.<\/strong>/);
      // …and the sentence that says WHICH station, WHICH hour, is not.
      expect(p.section, p.path).not.toMatch(/data-boilerplate="[^"]*"[^>]*>[^<]*(?:has not reported|is from)/);
    }
  });
});

test.describe('what else the served HTML must not do', () => {
  test('no level is painted', () => {
    for (const p of pages) {
      expect(p.section, p.path).not.toMatch(
        /class="[^"]*\b(?:bg|text|border)-(?:red|green|amber|yellow|orange|rose|lime|emerald|warn|danger)/,
      );
    }
  });

  test('our own words use none of the alarm or verdict words', () => {
    for (const p of pages) {
      for (const chunk of everythingSaid(p.section)) {
        expect(findForbiddenWords(chunk), p.path).toEqual([]);
      }
    }
  });

  test('the section sits between the bathing water and the weather', () => {
    const p = pages.find((x) => x.state === 'reported')!;
    const bathing = p.html.indexOf('data-testid="bathing-water"');
    const air = p.html.indexOf('data-testid="air-quality"');
    const weather = p.html.indexOf('Weather on site');
    expect(bathing).toBeGreaterThan(-1);
    expect(air).toBeGreaterThan(bathing);
    expect(weather).toBeGreaterThan(air);
  });
});

// ---------------------------------------------------------------------
// In a browser: the clock.
// ---------------------------------------------------------------------

test.describe('in a browser', () => {
  const path = () => named(S1).find((p) => p.text.includes('3.2 km'))!.path;

  /**
   * Every console error and warning — which is where a hydration mismatch
   * would show. One is excluded BY URL and by name: every campsite page
   * prefetches /owner/claim, which does not exist yet, and the browser
   * logs the 404. It is there on the home page's neighbours too and has
   * nothing to do with this section; excluding it by URL keeps every
   * other resource that fails, and every message, in the count.
   */
  function watch(page: import('@playwright/test').Page) {
    const bad: string[] = [];
    page.on('console', (m) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      if (m.location().url.includes('/owner/claim')) return;
      bad.push(m.text());
    });
    page.on('pageerror', (e) => bad.push(e.message));
    return bad;
  }

  test('a fresh reading is still shown, and the console is clean', async ({ page }) => {
    const bad = watch(page);
    await page.goto(path());
    const section = page.locator('[data-testid="air-quality"]');
    await expect(section).toHaveAttribute('data-state', 'reported');
    await expect(section).toContainText('As reported to the EEA, not formally verified.');
    await page.waitForTimeout(500);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  // 🔴 THE POINT OF THE CLIENT COMPONENT. The page was built with a fresh
  // reading; the same page opened in a browser whose clock is five hours
  // on must NOT keep calling it fresh.
  test('the same page opened five hours later says "no fresh data", and the console is clean', async ({ page }) => {
    const bad = watch(page);
    await page.clock.install({ time: new Date(Date.now() + 5 * 3_600_000) });
    await page.goto(path());
    const section = page.locator('[data-testid="air-quality"]');
    await expect(section).toHaveAttribute('data-state', 'no-fresh-data');
    await expect(section).toContainText('No fresh data.');
    await expect(section).toContainText('more than 4 hours ago');
    await expect(section).not.toContainText('Fair (level 2 of 6)');
    await expect(section).not.toContainText('As reported to the EEA');
    // …with the attribution still there.
    await expect(section).toContainText(AIR_ATTRIBUTION);
    await page.waitForTimeout(500);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  test('an hour later it is still fresh: the page does not over-eager', async ({ page }) => {
    await page.clock.install({ time: new Date(Date.now() + 1 * 3_600_000) });
    await page.goto(path());
    await expect(page.locator('[data-testid="air-quality"]')).toHaveAttribute('data-state', 'reported');
  });

  test('a page left open turns stale by itself as the clock runs on', async ({ page }) => {
    await page.clock.install({ time: new Date(Date.now() + 1 * 3_600_000) });
    await page.goto(path());
    const section = page.locator('[data-testid="air-quality"]');
    await expect(section).toHaveAttribute('data-state', 'reported');
    // Four hours pass in a browser that has not been reloaded.
    await page.clock.fastForward('04:00:00');
    await expect(section).toHaveAttribute('data-state', 'no-fresh-data');
  });

  test('a model value turns stale too', async ({ page }) => {
    const model = inState('modelled')[0].path;
    await page.clock.install({ time: new Date(Date.now() + 6 * 3_600_000) });
    await page.goto(model);
    const section = page.locator('[data-testid="air-quality"]');
    await expect(section).toHaveAttribute('data-state', 'no-fresh-data');
    await expect(section).toContainText('Our last read of the EEA’s modelled index');
  });

  test('a silent station stays silent whatever the clock says', async ({ page }) => {
    const silent = named(S3)[0].path;
    await page.clock.install({ time: new Date(Date.now() + 60 * 3_600_000) });
    await page.goto(silent);
    await expect(page.locator('[data-testid="air-quality"]')).toHaveAttribute('data-state', 'no-fresh-data');
    await expect(page.locator('[data-testid="air-quality"]')).toContainText('has not reported to the EEA recently');
  });

  // The served HTML is the page without JavaScript.
  test('without JavaScript the section is there and says the same', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(path());
    const section = page.locator('[data-testid="air-quality"]');
    await expect(section).toContainText('Reported by the station');
    await expect(section).toContainText('As reported to the EEA, not formally verified.');
    await context.close();
  });
});
