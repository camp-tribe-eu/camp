import { expect, test, type APIRequestContext } from './api-request';
import { API_BASE } from '@/lib/api';
import { BATHING_ATTRIBUTION, BATHING_SEASON } from '@/lib/bathing';
import { findForbiddenWords } from '@/lib/wording';

// CAMP-168 — the bathing water section, read out of the SERVED HTML.
//
// 🔴 EVERY ASSERTION HERE READS THE BYTES THE SERVER SENT.
//
// `request.get(path).text()` — not `page.locator`, not a class name, not
// an `sr-only` caption, and not the function that generated the string.
// A check that asserts a property it cannot see is the failure this
// repository has now found four times, including one that printed
// "✓ all checks passed" beside a sentence about a page whose every
// marker had been deleted. If the year is not in the HTML a crawler
// receives, this file must go red.
//
// 🔴 NO EXPECTED VALUE GROWS FROM THE FIELD IT CHECKS.
//
// The first version built every expected year from `fx.classified.season`
// — read out of the very payload the page was rendered from. With season
// `null`, `undefined`, `0` or `"banana"` the page said "Bathing water,
// null bathing season" and the heading regex, the isolated <dt> and the
// body assertions all agreed with it. The expectations below come from
// `BATHING_SEASON`, and the attribution from `BATHING_ATTRIBUTION`: a
// constant that a different unit test pins to the API's copy and to the
// service's own text.
//
// 🔴 It GATES ITSELF ON THE DATA and FAILS rather than skips. Run against
// a database with no bathing waters, every assertion below would pass
// over nothing — which is exactly how a suite comes to agree with a bug.

/** What the API says about one campsite's bathing water, as served. */
interface Served {
  path: string;
  bathingWater: { status: string; season: unknown; name: string } | null;
}

interface Fixtures {
  /** A campsite whose nearest bathing water carries a class. */
  classified: { path: string; status: string; name: string };
  /** One whose nearest bathing water the authorities did not classify. */
  unclassified: { path: string };
  /** One with no designated bathing water within the radius. */
  none: { path: string };
  /**
   * EVERY campsite in the fixture, with what the API served for it.
   * The three above are the first of each kind; the sweeps below run over
   * this so that one page reading correctly does not stand for the rest.
   */
  all: Served[];
}

let fx: Fixtures;

async function resolveFixtures(request: APIRequestContext): Promise<Fixtures> {
  // The same two-list approach as campsite.spec.ts: whole-list endpoints
  // first, full records only for the handful we choose. Nothing is named
  // — the subjects are whatever the data happens to contain, and the
  // first in list order wins so the choice is stable between runs.
  const markers: { slug: string; path: string }[] = (
    await (
      await request.get(
        `${API_BASE}/spots/map/points?bbox=-180,-85,180,85&limit=20000`,
      )
    ).json()
  ).markers;

  let classified: Fixtures['classified'] | null = null;
  let unclassified: Fixtures['unclassified'] | null = null;
  let none: Fixtures['none'] | null = null;
  const all: Served[] = [];

  for (const m of markers) {
    const res = await request.get(`${API_BASE}/spots${m.path.replace('/camping', '')}`);
    if (!res.ok()) continue;
    const { spot } = await res.json();
    const bw = spot.bathingWater;
    all.push({
      path: m.path,
      bathingWater: bw
        ? { status: bw.status, season: bw.season, name: bw.name }
        : null,
    });
    if (!bw) {
      none ??= { path: m.path };
    } else if (bw.status === 'not_classified') {
      unclassified ??= { path: m.path };
    } else {
      classified ??= { path: m.path, status: bw.status, name: bw.name };
    }
  }

  // 🔴 FAIL, not skip. A green run over a fixture with no bathing waters
  // would prove nothing while looking exactly like proof.
  expect(
    classified,
    'no campsite in this database has a classified bathing water nearby — ' +
      'this suite would prove nothing',
  ).not.toBeNull();
  expect(
    unclassified,
    'no campsite has an unclassified bathing water nearby — the branch ' +
      'that says so out loud is untested',
  ).not.toBeNull();
  expect(
    none,
    'every campsite has a bathing water nearby — the empty state, which ' +
      'is 69.8% of real pages, is untested',
  ).not.toBeNull();

  return {
    classified: classified!,
    unclassified: unclassified!,
    none: none!,
    all,
  };
}

test.beforeAll(async ({ request }) => {
  fx = await resolveFixtures(request);
});

test.describe('the season is in the served HTML', () => {
  test('a classified campsite prints the year and the word season', async ({
    request,
  }) => {
    const html = await (await request.get(fx.classified.path)).text();
    const section = bathingSection(html);

    expect(section).toContain(`${BATHING_SEASON} bathing season`);
    // 🔴 In the HEADING, not only in the body — a reader who reads one
    // line of this section must read the year. The whole heading, pinned
    // to the constant: `[^<]*2025 bathing season` would still match
    // "Bathing water, 2025 bathing season" preceded by anything.
    expect(html).toMatch(
      new RegExp(
        `<h2[^>]*id="bathing-water-heading"[^>]*>Bathing water, ${BATHING_SEASON} bathing season</h2>`,
      ),
    );
    expect(stripTags(section)).toContain('whole bathing season');
    expect(stripTags(section)).toContain('rather than a particular day');
    // The sentence about the calendar names the year too.
    expect(stripTags(section)).toContain(
      `The ${BATHING_SEASON} season is the most recent one published`,
    );
    expectNoBrokenYear(stripTags(section), fx.classified.path);
  });

  // 🔴 SEPARATELY FROM THE HEADING, and this test exists because the
  // first version of it did not.
  //
  // Asserting `section` contains "2025 bathing season" passes as long as
  // ANY part of the section says it — so deleting the year from the
  // definition-list label left the suite green while the label a reader
  // actually skims had lost its year. Mutation found it. The assertion
  // now isolates that one <dt> out of the served HTML and reads it.
  test('the classification label itself carries the year', async ({
    request,
  }) => {
    const section = bathingSection(await (await request.get(fx.classified.path)).text());
    const dt = /<dt[^>]*>((?:(?!<\/dt>)[\s\S])*Official classification(?:(?!<\/dt>)[\s\S])*)<\/dt>/.exec(
      section,
    );
    expect(dt, 'no "Official classification" label in the served HTML').not.toBeNull();
    expect(stripTags(dt![1])).toBe(
      `Official classification, ${BATHING_SEASON} bathing season`,
    );
  });

  test('the class itself is in the markup, beside the named water', async ({
    request,
  }) => {
    const html = await (await request.get(fx.classified.path)).text();
    const section = bathingSection(html);
    const label =
      fx.classified.status[0].toUpperCase() + fx.classified.status.slice(1);
    expect(section).toContain(label);
    // Without the name of the place that was sampled and the distance to
    // it, the class is a floating adjective attached to a campsite.
    expect(section).toContain(escapeHtml(fx.classified.name));
    expect(section).toMatch(/from this campsite/);
  });

  // 🔴 NO WORD IN THE SECTION MAY READ AS THE STATE OF THE WATER TODAY.
  test('nothing in the section claims a present-tense reading', async ({
    request,
  }) => {
    const html = await (await request.get(fx.classified.path)).text();
    const text = stripTags(bathingSection(html));
    expect(text).not.toMatch(/\btoday\b/i);
    expect(text).not.toMatch(/\bcurrently\b/i);
    expect(text).not.toMatch(/\bright now\b/i);
    expect(text).not.toMatch(/\bwater quality is\b/i);
  });
});

// 🔴 THE PAYLOAD ITSELF, against a constant — not against itself.
//
// The page is built from this JSON. Every page-level assertion above is
// pinned to BATHING_SEASON, so a null season fails there; this one fails
// at the API, one step earlier, and says which step.
test.describe('the season the API serves', () => {
  test('every bathing water names a four-digit season, and it is the published one', () => {
    const served = fx.all.filter((s) => s.bathingWater !== null);
    // The sweep must have something to sweep.
    expect(served.length, 'no campsite in the fixture has a bathing water').toBeGreaterThan(
      10,
    );
    for (const { path, bathingWater } of served) {
      const season = bathingWater!.season;
      expect(typeof season, `${path}: season is ${JSON.stringify(season)}`).toBe(
        'number',
      );
      expect(String(season), path).toMatch(/^\d{4}$/);
      expect(season, path).toBe(BATHING_SEASON);
    }
  });
});

// 🔴 THE GUARD WORKS IN BOTH DIRECTIONS.
//
// The first version asserted only that an UNclassified page does not say
// "Classified by…". Nothing asserted that a classified page DOES say it,
// or that it does not say "no classification" — so replacing the
// conditional with `notClassifiedSentence(bw)` alone, or making
// `isClassified` return false, turned nothing red while every classified
// page printed "Official classification — Excellent" and, two lines
// below, that the authorities had published no classification.
//
// Swept over EVERY campsite in the fixture that has a bathing water, not
// the first of each kind: one page reading correctly is not the rest.
test.describe('a classified page says it is classified; an unclassified one says it is not', () => {
  test('every classified page says who classified it, and never that nobody did', async ({
    request,
  }) => {
    const classified = fx.all.filter(
      (s) => s.bathingWater && s.bathingWater.status !== 'not_classified',
    );
    expect(classified.length, 'no classified page to check').toBeGreaterThan(5);
    for (const { path, bathingWater } of classified) {
      const section = bathingSection(await (await request.get(path)).text());
      const text = stripTags(section);
      expect(text, path).toContain('Classified by the national authorities');
      expect(text, path).toContain(
        `for the ${BATHING_SEASON} bathing season, as published by the European Environment Agency`,
      );
      // The contradiction, in both of the words it has used.
      expect(text, path).not.toMatch(/no classification/i);
      expect(text, path).not.toContain('Not classified');
      // And the class itself is the one in the payload, in the element
      // that carries it.
      const status = stripTags(
        between(section, 'data-testid="bathing-status"', '</dd>').replace(
          /^[^>]*>/,
          '',
        ),
      );
      expect(status, path).toBe(
        bathingWater!.status[0].toUpperCase() + bathingWater!.status.slice(1),
      );
    }
  });

  test('every unclassified page says nobody classified it, and never that somebody did', async ({
    request,
  }) => {
    const unclassified = fx.all.filter(
      (s) => s.bathingWater?.status === 'not_classified',
    );
    expect(unclassified.length, 'no unclassified page to check').toBeGreaterThan(5);
    for (const { path } of unclassified) {
      const section = bathingSection(await (await request.get(path)).text());
      const text = stripTags(section);
      expect(text, path).toContain('The authorities published no classification');
      expect(text, path).toContain(`for the ${BATHING_SEASON} bathing season.`);
      expect(text, path).not.toMatch(/Classified by/);
      const status = stripTags(
        between(section, 'data-testid="bathing-status"', '</dd>').replace(
          /^[^>]*>/,
          '',
        ),
      );
      expect(status, path).toBe('Not classified');
    }
  });
});

test.describe('the wording gate (CAMP-162), on the bytes we serve', () => {
  test('no forbidden word appears in the rendered section', async ({
    request,
  }) => {
    for (const path of [
      fx.classified.path,
      fx.unclassified.path,
      fx.none.path,
    ]) {
      const text = stripTags(bathingSection(await (await request.get(path)).text()));
      expect(findForbiddenWords(text), `${path}: ${text}`).toEqual([]);
    }
  });
});

test.describe('it never renders empty', () => {
  test('a campsite with no bathing water nearby says so', async ({ request }) => {
    const html = await (await request.get(fx.none.path)).text();
    const section = bathingSection(html);
    expect(stripTags(section)).toContain('No bathing water officially designated');
    expect(stripTags(section)).toContain('2 km');
    // 🔴 And it refuses the inference a silent page would invite.
    expect(stripTags(section)).toContain('not a statement about the water nearby');
  });

  test('a campsite whose water was not classified says that', async ({
    request,
  }) => {
    const html = await (await request.get(fx.unclassified.path)).text();
    const text = stripTags(bathingSection(html));
    expect(text).toContain('Not classified');
    expect(text).toContain('no classification');
    // The year is still there: "not classified" is an answer about a
    // season, not a permanent property of the water.
    expect(text).toContain(`${BATHING_SEASON} bathing season`);
    expectNoBrokenYear(text, fx.unclassified.path);
    // 🔴 And the page does NOT also say it was classified. It did, in
    // the first version — "Not classified" above, "Classified by the
    // national authorities" two lines below — and nothing but opening
    // the page in a browser showed it.
    expect(text).not.toMatch(/Classified by the national authorities/);
  });

  test('the section exists on all three kinds of page', async ({ request }) => {
    for (const path of [
      fx.classified.path,
      fx.unclassified.path,
      fx.none.path,
    ]) {
      const html = await (await request.get(path)).text();
      expect(html, path).toContain('data-testid="bathing-water"');
    }
  });
});

test.describe('the attribution the licence requires', () => {
  // 🔴 Rendered, on every state including the empty one, with the season
  // where there is one — not held in a constant nobody checks.
  test('names the EEA and its licence in the HTML', async ({ request }) => {
    for (const path of [
      fx.classified.path,
      fx.unclassified.path,
      fx.none.path,
    ]) {
      const section = bathingSection(await (await request.get(path)).text());
      expect(section, path).toContain('European Environment Agency');
      expect(section, path).toContain('CC BY 4.0');
      expect(section, path).toContain(
        'creativecommons.org/licenses/by/4.0/',
      );
      // 🔴 The constant, not a spelling typed into this file. The
      // service's own text is "Bathing waters … Member states
      // authorities."; a retyped "bathing waters … Member States" is not
      // verbatim, and the licence makes acknowledgement a condition.
      expect(stripTags(section), path).toContain(BATHING_ATTRIBUTION);
    }
  });

  test('carries the season where there is a classification', async ({
    request,
  }) => {
    const section = bathingSection(
      await (await request.get(fx.classified.path)).text(),
    );
    // Exact, so neither a missing year nor a broken one can hide inside a
    // longer string that merely contains the attribution.
    expect(attributionText(section)).toBe(
      `${BATHING_ATTRIBUTION} ${BATHING_SEASON} bathing season.`,
    );
  });

  // The other half: where there is no classification there is no season
  // to name, and the attribution says nothing about one.
  test('names no season where there is no bathing water', async ({
    request,
  }) => {
    const section = bathingSection(
      await (await request.get(fx.none.path)).text(),
    );
    expect(attributionText(section)).toBe(BATHING_ATTRIBUTION);
  });
});

test.describe('no colour carries the meaning', () => {
  // A green badge on Excellent and a red one on Poor is the forbidden
  // vocabulary rendered in CSS: red means danger to every reader alive,
  // and the EEA has not said this water is dangerous.
  test('the class is not painted', async ({ request }) => {
    const section = bathingSection(
      await (await request.get(fx.classified.path)).text(),
    );
    expect(section).not.toMatch(
      /class="[^"]*\b(?:bg|text|border)-(?:red|green|amber|yellow|orange)-/,
    );
  });
});

/** The bathing water section, cut out of the served HTML by its testid. */
function bathingSection(html: string): string {
  const start = html.indexOf('data-testid="bathing-water"');
  expect(start, 'the bathing water section is not in the served HTML').toBeGreaterThan(
    -1,
  );
  // To the end of the section element. The next `<section` that follows
  // is the weather block, so cutting there is enough and keeps this
  // helper from needing a parser.
  const rest = html.slice(start);
  const end = rest.indexOf('<section', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The year a page prints must be a year. Checked in addition to being
 * pinned to BATHING_SEASON, so a failure names what went wrong instead of
 * only which literal was missing.
 */
function expectNoBrokenYear(text: string, where: string): void {
  expect(text, `${where}: a season that is not a year`).not.toMatch(
    /\b(?:null|undefined|NaN)\b/,
  );
  expect(text, `${where}: a season that is not a year`).not.toMatch(
    /\b(?!\d{4}\b)\w+ bathing season\b(?<!whole bathing season)/,
  );
}

/** The text inside the attribution span, tags removed. */
function attributionText(section: string): string {
  const m = /<span data-testid="bathing-attribution">([\s\S]*?)<\/span>/.exec(
    section,
  );
  expect(m, 'no attribution span in the served HTML').not.toBeNull();
  return stripTags(m![1]);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function between(s: string, from: string, to: string): string {
  const a = s.indexOf(from);
  if (a === -1) return '';
  const b = s.indexOf(to, a);
  return s.slice(a, b === -1 ? undefined : b);
}
