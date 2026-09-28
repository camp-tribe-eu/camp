import { expect, test, type APIRequestContext } from './api-request';
import { API_BASE } from '@/lib/api';
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
// 🔴 It GATES ITSELF ON THE DATA and FAILS rather than skips. Run against
// a database with no bathing waters, every assertion below would pass
// over nothing — which is exactly how a suite comes to agree with a bug.

interface Fixtures {
  /** A campsite whose nearest bathing water carries a class. */
  classified: { path: string; status: string; season: number; name: string };
  /** One whose nearest bathing water the authorities did not classify. */
  unclassified: { path: string; season: number };
  /** One with no designated bathing water within the radius. */
  none: { path: string };
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

  for (const m of markers) {
    if (classified && unclassified && none) break;
    const res = await request.get(`${API_BASE}/spots${m.path.replace('/camping', '')}`);
    if (!res.ok()) continue;
    const { spot } = await res.json();
    const bw = spot.bathingWater;
    if (!bw) {
      none ??= { path: m.path };
    } else if (bw.status === 'not_classified') {
      unclassified ??= { path: m.path, season: bw.season };
    } else {
      classified ??= {
        path: m.path,
        status: bw.status,
        season: bw.season,
        name: bw.name,
      };
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

  return { classified: classified!, unclassified: unclassified!, none: none! };
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

    expect(section).toContain(`${fx.classified.season} bathing season`);
    // 🔴 In the HEADING, not only in the body — a reader who reads one
    // line of this section must read the year.
    expect(html).toMatch(
      new RegExp(
        `<h2[^>]*id="bathing-water-heading"[^>]*>[^<]*${fx.classified.season} bathing season`,
      ),
    );
    expect(stripTags(section)).toContain('whole bathing season');
    expect(stripTags(section)).toContain('rather than a particular day');
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
    expect(stripTags(dt![1])).toContain(`${fx.classified.season} bathing season`);
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
    expect(text).toContain(`${fx.unclassified.season} bathing season`);
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
      expect(stripTags(section), path).toContain(
        'Member States authorities',
      );
    }
  });

  test('carries the season where there is a classification', async ({
    request,
  }) => {
    const section = bathingSection(
      await (await request.get(fx.classified.path)).text(),
    );
    const attribution = between(
      section,
      'data-testid="bathing-attribution"',
      '</span>',
    );
    expect(attribution).toContain(`${fx.classified.season} bathing season`);
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function between(s: string, from: string, to: string): string {
  const a = s.indexOf(from);
  if (a === -1) return '';
  const b = s.indexOf(to, a);
  return s.slice(a, b === -1 ? undefined : b);
}
