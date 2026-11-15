import { expect, test, type APIRequestContext } from './api-request';
import { axeViolations } from './axe';
import type { Page } from '@playwright/test';
import { countryName as countryNameOf } from '@/lib/api';
import {
  search,
  unpackIndex,
  type PackedIndex,
  type SearchDoc,
} from '@/lib/search';
import { chunkUrl, type SearchIndex } from '@/lib/search-chunks';

// CAMP-67 — the search, against the index the site actually ships.
//
// 🔴 The unit tests prove the algorithm on three invented documents. This
// file proves it on the real one, because the interesting failures are
// the ones that only appear at a thousand entries: a fuzzy band wide
// enough to match everything, a place name that a dozen campsites share,
// a tiebreak that is not a tiebreak. Nothing here names a campsite —
// every subject is resolved from the index, so a re-import cannot make
// the suite fail for the wrong reason.

// CAMP-129: the index is a table of contents plus one file per country.
// This assembles the whole thing the way the page does, so the suite
// still reasons about the complete corpus.
async function index(request: APIRequestContext): Promise<SearchDoc[]> {
  const toc = await contents(request);
  const docs: SearchDoc[] = [];
  for (const chunk of toc.chunks) {
    const res = await request.get(chunkUrl(chunk.id));
    expect(res.ok(), `chunk ${chunk.id} is not served`).toBe(true);
    // CAMP-107: the file is packed. Unpacked with the same function the
    // browser uses, so this suite tests the format the reader gets
    // rather than a second reading of it.
    const part = unpackIndex((await res.json()) as PackedIndex);
    // \ud83d\udd34 The table of contents is a promise about each file. A chunk
    // holding a different number than it advertised makes the page's
    // progress line wrong, and nothing else would notice.
    expect(part.length, `chunk ${chunk.id} does not hold what the index promised`)
      .toBe(chunk.count);
    docs.push(...part);
  }
  expect(docs.length, 'the index is empty').toBeGreaterThan(0);
  return docs;
}

async function contents(request: APIRequestContext): Promise<SearchIndex> {
  const res = await request.get('/data/search/index.json');
  expect(res.ok(), 'the search index is not served').toBe(true);
  const toc = (await res.json()) as SearchIndex;
  expect(toc.chunks.length, 'the index lists no files').toBeGreaterThan(0);
  return toc;
}

/**
 * How long the whole index may take to arrive, in a test.
 *
 * 🔴 Not the default 5 s, and the difference is not taste.
 *
 * The search used to be ONE file. CAMP-129 made it twenty-eight, and
 * `data-complete` waits for the last of them.
 *
 * Measured 25.09.2026 against a production `next start`, fetching all
 * 28 chunks (61 422 campsites, 3.29 MB) four at a time, the way the
 * page does — three runs on one machine:
 *
 *   4 040 ms   12 805 ms   811 ms (warm cache)
 *
 * The middle run is the point. It was taken while a 65 000-page build
 * was using the same machine, which is not an unfair test: it is what a
 * CI runner looks like with six browser projects in parallel. Nothing
 * was broken in that run — it was simply contended.
 *
 * The default is 5 s. `scripts/ci/check-flaky.mjs` turns ANY flake into
 * a red build, deliberately, so a limit the machine can cross while
 * working correctly is a red `main` waiting to happen.
 *
 * 20 s is not "make it pass". It is above the worst honest measurement
 * with room to spare, and the specs still fail in seconds rather than
 * hanging: a chunk that never arrives leaves the attribute at "false"
 * and the failure says exactly that.
 */
const COMPLETE_TIMEOUT = 20_000;

/** Swap one letter in the middle — the commonest real typo. */
function mistype(word: string): string {
  const i = Math.floor(word.length / 2);
  const wrong = word[i] === 'x' ? 'y' : 'x';
  return word.slice(0, i) + wrong + word.slice(i + 1);
}

test.describe('the index the site ships', () => {
  test('is served, and no single file is too big for a phone', async ({
    request,
  }) => {
    const toc = await contents(request);
    // The build fails past 1.5 MB (see the route). This is the same
    // limit asserted from the outside, so the two cannot drift \u2014 and
    // now it is asserted on every file, not on the one that used to be.
    for (const chunk of toc.chunks) {
      const res = await request.get(chunkUrl(chunk.id));
      expect(res.ok(), `chunk ${chunk.id} is not served`).toBe(true);
      const bytes = Buffer.byteLength(await res.text());
      expect(bytes, `${chunk.id} is ${bytes} bytes`).toBeLessThan(1_500_000);
    }
  });

  // \ud83d\udd34 The table of contents is the only thing the page fetches
  // before it can do anything, so it is the only file whose size is a
  // hard latency floor. It was 5 KB when this was written.
  test('the table of contents itself is tiny', async ({ request }) => {
    const res = await request.get('/data/search/index.json');
    expect(Buffer.byteLength(await res.text())).toBeLessThan(50_000);
  });

  test('every entry points at a page that exists', async ({ request }) => {
    const docs = await index(request);
    // A sample rather than all thousand: enough to catch a broken path
    // shape, cheap enough to run in every browser.
    const step = Math.max(1, Math.floor(docs.length / 8));
    for (let i = 0; i < docs.length; i += step) {
      const res = await request.get(docs[i].path);
      expect(res.status(), `${docs[i].path} answers ${res.status()}`).toBe(200);
    }
  });
});

test.describe('🔴 the card, on real data', () => {
  test('a query with a typo finds the right campsite', async ({ request }) => {
    const docs = await index(request);

    // A name long enough for the fuzzy band to apply, and distinctive
    // enough that only one campsite carries it.
    const subject = docs.find((d) => {
      const first = d.name.split(' ').find((w) => w.length >= 7);
      if (!first) return false;
      return docs.filter((o) => o.name.includes(first)).length === 1;
    });
    expect(subject, 'no distinctive long name in the index').toBeTruthy();

    const word = subject!.name.split(' ').find((w) => w.length >= 7)!;
    const hits = search(docs, mistype(word));
    expect(
      hits.map((h) => h.doc.path),
      `"${mistype(word)}" did not find "${subject!.name}"`,
    ).toContain(subject!.path);
  });

  test('an accented name is found without the accent', async ({ request }) => {
    const docs = await index(request);
    // 145 of our named campsites carry one; the index is folded, so
    // typing plain letters has to reach them.
    const accented = docs.find((d) => /[čćšžđ]/i.test(d.name));
    expect(accented, 'no accented name in the index').toBeTruthy();

    const plain = accented!.name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/gi, 'd');
    expect(search(docs, plain).map((h) => h.doc.path)).toContain(
      accented!.path,
    );
  });

  test('a place name orders the answer by distance, not by name', async ({
    request,
  }) => {
    const docs = await index(request);

    // A place that several campsites are near — that is the only case
    // where an ordering can be wrong in a visible way.
    const counts = new Map<string, number>();
    for (const d of docs) {
      for (const n of d.near) counts.set(n.name, (counts.get(n.name) ?? 0) + 1);
    }
    const place = [...counts.entries()]
      .filter(([name, n]) => n >= 3 && name.length >= 5)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(place, 'no place is shared by three campsites').toBeTruthy();

    const hits = search(docs, place!);
    expect(hits.length).toBeGreaterThan(2);

    const metres = hits.map((h) => h.metres).filter((m) => m !== undefined);
    expect(metres.length, 'no distances came back').toBeGreaterThan(2);

    // Ascending, which is the criterion.
    for (let i = 1; i < metres.length; i++) {
      expect(
        metres[i]!,
        `results for "${place}" are not ordered by distance`,
      ).toBeGreaterThanOrEqual(metres[i - 1]!);
    }

    // 🔴 And it is genuinely NOT alphabetical — otherwise the test above
    // would pass on a list that happened to be sorted both ways.
    const names = hits.map((h) => h.doc.name);
    const alphabetical = [...names].sort((a, b) => a.localeCompare(b));
    expect(
      names,
      'distance order happens to equal alphabetical order — pick another place',
    ).not.toEqual(alphabetical);
  });
});

test.describe('the page', () => {
  // 🔴 The state a reader meets first. Before this existed the page
  // showed nothing at all while 654 KB downloaded — no results, no
  // explanation, no indication anything was happening. It was invisible
  // until the index grew enough for a browser to notice.
  test('says it is loading before it can answer', async ({ page }) => {
    // Hold the index so the loading state is certain rather than a race.
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/data/search/index.json', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto('/search');
    await expect(page.getByTestId('search-loading')).toBeVisible();

    release!();
    await expect(page.getByTestId('search')).toHaveAttribute(
      'data-complete',
      'true',
      { timeout: COMPLETE_TIMEOUT },
    );
  });

  test('finds a campsite as the reader types', async ({ page, request }) => {
    const docs = await index(request);
    const subject = docs.find((d) => d.name.length > 6)!;

    await page.goto('/search');
    // 🔴 Wait for COMPLETE, not for ready and not for loading to be
    // absent.
    //
    // CAMP-129 split the index into one file per country, so `ready`
    // now means "the first file landed and the box answers" — true
    // while twenty-seven countries are still arriving. A spec that
    // resolves its subject from the whole corpus and then types it
    // needs every file, and `data-complete` is the attribute that says
    // so. Waiting for `ready` here would fail whenever the subject
    // happened to live in a chunk that had not arrived: a flake keyed
    // on network timing, which is the worst kind.
    //
    // The whole index is fetched before a search can answer anything, so
    // typing before it lands tests nothing except the download. This
    // waited for `search-loading` to be hidden — and `toBeHidden` is also
    // satisfied by an element that is not in the DOM yet, which is true
    // in the instant before React renders. It waited for nothing, and
    // failed on tablet about one run in ten until the flaky guard said so.
    await expect(page.getByTestId('search')).toHaveAttribute(
      'data-complete',
      'true',
      { timeout: COMPLETE_TIMEOUT },
    );
    await page.getByTestId('search-input').fill(subject.name);
    await expect(page.getByTestId('search-results')).toBeVisible();
    await expect(page.getByTestId('search-results')).toContainText(
      subject.name,
    );
  });

  test('a search is a link somebody can send', async ({ page, request }) => {
    const docs = await index(request);
    const subject = docs.find((d) => d.name.length > 6)!;

    await page.goto(`/search?q=${encodeURIComponent(subject.name)}`);
    await expect(page.getByTestId('search-input')).toHaveValue(subject.name);
    await expect(page.getByTestId('search')).toHaveAttribute(
      'data-complete',
      'true',
      { timeout: COMPLETE_TIMEOUT },
    );
    await expect(page.getByTestId('search-results')).toContainText(
      subject.name,
    );
  });

  test('says so plainly when nothing matches', async ({ page }) => {
    await page.goto('/search?q=zzzzqqqqxxxx');
    await expect(page.getByTestId('search')).toHaveAttribute(
      'data-complete',
      'true',
      { timeout: COMPLETE_TIMEOUT },
    );
    await expect(page.getByTestId('search-count')).toContainText('Nothing');
    await expect(page.getByTestId('search-results')).toHaveCount(0);
  });

  // 🔴 A search-results page is thin, infinite, and duplicates the pages
  // it points at. Google's own guidance keeps it out of the index — but
  // `follow`, so the links out of it still count.
  test('is noindex but followable', async ({ request }) => {
    const html = await (await request.get('/search')).text();
    const robots = /<meta name="robots" content="([^"]+)"/i.exec(html)?.[1];
    expect(robots).toContain('noindex');
    expect(robots).toContain('follow');
    expect(robots).not.toContain('nofollow');
  });
});

test.describe('the 404 page keeps the promise it makes', () => {
  // 🔴 The gap CAMP-73 left open: its card asked for a search box and
  // there was no search to point at. There is now, and it is a plain GET
  // form — so it works on the one page where JavaScript is most likely
  // to be the reason the reader is lost.
  test('offers a search that works without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/camping/xx/nowhere/nothing-here');
    const box = page.getByTestId('notfound-search');
    await expect(box).toBeVisible();

    await box.fill('bled');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search\?q=bled/);

    await context.close();
  });
});

// ── CAMP-455: the results as cards, in tabs, on the centre line ─────────
//
// 🔴 EVERYTHING BELOW IS READ OFF THE RENDERED PAGE — boxes measured in
// the browser, text read from the DOM the reader is looking at. A class
// name on an element says what somebody intended; `getBoundingClientRect`
// says where the pixels are. The subjects are resolved from the index the
// page itself loads, so a re-import cannot fail the suite for the wrong
// reason, and each assertion that depends on a size of data names the
// number it found.

/** The country with most campsites in the index, and how many. */
function biggestCountry(docs: SearchDoc[]): { code: string; n: number } {
  const counts = new Map<string, number>();
  for (const d of docs) counts.set(d.country, (counts.get(d.country) ?? 0) + 1);
  const [code, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { code, n };
}

async function openComplete(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId('search')).toHaveAttribute(
    'data-complete',
    'true',
    { timeout: COMPLETE_TIMEOUT },
  );
}

test.describe('🔴 CAMP-455: the page the reader sees', () => {
  test('the box is on the centre line at every width', async ({ page }) => {
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await openComplete(page, '/search');
      const box = await page.getByTestId('search-input').boundingBox();
      expect(box, `no box at ${width}`).not.toBeNull();
      const centre = box!.x + box!.width / 2;
      expect(
        Math.abs(centre - width / 2),
        `at ${width}px the box centre is ${centre}, the page centre ${width / 2}`,
      ).toBeLessThanOrEqual(2);
      // Narrower than the page on a wide screen — Fuse's box is 912 of
      // 1500 (screenshot 442/03), and ours never passes 910.
      expect(
        box!.width,
        `at ${width}px the box is ${box!.width} wide`,
      ).toBeLessThanOrEqual(910);
      if (width >= 1440) {
        expect(
          box!.width,
          `at ${width}px the box is ${box!.width} wide, not the full page`,
        ).toBeLessThan(width * 0.7);
      }
    }
  });

  // 🔴 THE TEXT, NOT THE BOX. A block element is always centred in its
  // parent by its own margins, whatever its text-align says, so the
  // bounding box of a left-aligned heading sits on the centre line too.
  // The first version of this test measured the box and stayed green with
  // `text-center` deleted. A Range over the element's contents gives one
  // rectangle per LINE of text, hugging the letters — and every one of
  // them has to be centred.
  test('the heading and the lead are centred with the box, line by line', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openComplete(page, '/search');
    // One rectangle per text NODE, and a paragraph made of two nodes gives
    // two rectangles on the same line — so they are merged by their top
    // edge into one span per visual line before anything is compared.
    const lines = async (selector: string): Promise<{ x: number; w: number }[]> =>
      page.locator(selector).first().evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const byTop = new Map<number, { l: number; r: number }>();
        for (const r of range.getClientRects()) {
          if (r.width === 0) continue;
          const key = Math.round(r.top);
          const cur = byTop.get(key);
          byTop.set(key, {
            l: Math.min(cur?.l ?? r.left, r.left),
            r: Math.max(cur?.r ?? r.right, r.right),
          });
        }
        return [...byTop.values()].map((v) => ({ x: v.l, w: v.r - v.l }));
      });
    for (const [name, selector] of [
      ['h1', 'main h1'],
      ['lead', 'main h1 + p'],
    ] as const) {
      const rects = await lines(selector);
      expect(rects.length, `no text lines found in the ${name}`).toBeGreaterThan(0);
      for (const r of rects) {
        expect(
          Math.abs(r.x + r.w / 2 - 720),
          `a line of the ${name} (${Math.round(r.x)}..${Math.round(r.x + r.w)}) is off the centre line`,
        ).toBeLessThanOrEqual(2);
      }
    }
  });

  test('three tabs, each with its own count, and the first one selected', async ({
    page,
    request,
  }) => {
    const docs = await index(request);
    const { code } = biggestCountry(docs);
    await openComplete(
      page,
      `/search?q=${encodeURIComponent(countryNameOf(code))}`,
    );
    // The roles a screen reader announces, not just three buttons.
    await expect(
      page.getByRole('tablist', { name: 'Result type' }),
    ).toBeVisible();
    await expect(page.getByRole('tabpanel')).toBeVisible();
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toContainText('Campsites (');
    await expect(tabs.nth(1)).toContainText('Regions (');
    await expect(tabs.nth(2)).toContainText('Countries (');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false');
  });

  test('the Regions tab lists a region with the count the index holds', async ({
    page,
    request,
  }) => {
    const docs = await index(request);
    // The region with most campsites: the one a count can be wrong about.
    const byRegion = new Map<string, number>();
    for (const d of docs) {
      const k = `${d.country}/${d.region}`;
      byRegion.set(k, (byRegion.get(k) ?? 0) + 1);
    }
    const [key, n] = [...byRegion.entries()].sort((a, b) => b[1] - a[1])[0];
    const [country, region] = key.split('/');
    const title = region
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    await openComplete(page, `/search?q=${encodeURIComponent(title)}`);
    await page.getByTestId('search-tab-regions').click();
    await expect(page.getByTestId('search-panel')).toHaveAttribute(
      'data-tab',
      'regions',
    );

    const card = page
      .getByTestId('search-card-region')
      .and(page.locator(`[href="/camping/${country}/${region}"]`));
    await expect(card, `no region card for ${key}`).toBeVisible();
    // The denominator is named: n campsites of the index in this region.
    await expect(card).toContainText(
      `${n.toLocaleString('en-GB')} ${n === 1 ? 'campsite' : 'campsites'}`,
    );
  });

  test('the Countries tab links to the country page', async ({
    page,
    request,
  }) => {
    const docs = await index(request);
    const { code } = biggestCountry(docs);
    await openComplete(
      page,
      `/search?q=${encodeURIComponent(countryNameOf(code))}&tab=countries`,
    );
    await expect(page.getByTestId('search-tab-countries')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(
      page
        .getByTestId('search-card-country')
        .and(page.locator(`[href="/camping/${code}"]`)),
    ).toBeVisible();
  });

  test('the tab is in the address, and the address opens on that tab', async ({
    page,
    request,
  }) => {
    const docs = await index(request);
    const { code } = biggestCountry(docs);
    await openComplete(
      page,
      `/search?q=${encodeURIComponent(countryNameOf(code))}`,
    );
    expect(page.url()).not.toContain('tab=');
    await page.getByTestId('search-tab-regions').click();
    await expect.poll(() => page.url()).toContain('tab=regions');
    await page.reload();
    await expect(page.getByTestId('search-tab-regions')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('arrow keys move between the tabs', async ({ page, request }) => {
    const docs = await index(request);
    const { code } = biggestCountry(docs);
    await openComplete(
      page,
      `/search?q=${encodeURIComponent(countryNameOf(code))}`,
    );
    await page.getByTestId('search-tab-campsites').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('search-tab-regions')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('search-tab-regions')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('search-tab-campsites')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('an empty tab says which kind is empty, and draws no cards', async ({
    page,
  }) => {
    await openComplete(page, '/search?q=zzzzqqqqxxxx&tab=countries');
    await expect(page.getByTestId('search-count')).toContainText(
      'No countries match',
    );
    await expect(page.getByTestId('search-results-countries')).toHaveCount(0);
  });

  // 🔴 «3–4 в ряд». Columns are counted by the distinct left edges of the
  // cards the browser laid out, not read from a stylesheet.
  for (const [width, columns] of [
    [1440, 4],
    [1024, 3],
    [768, 2],
    [375, 1],
  ] as const) {
    test(`${columns} card column${columns === 1 ? '' : 's'} at ${width}px`, async ({
      page,
      request,
    }) => {
      const docs = await index(request);
      const { code, n } = biggestCountry(docs);
      expect(
        n,
        'the biggest country has too few campsites to fill a row',
      ).toBeGreaterThanOrEqual(4);
      await page.setViewportSize({ width, height: 900 });
      await openComplete(
        page,
        `/search?q=${encodeURIComponent(countryNameOf(code))}`,
      );
      const cards = page.getByTestId('search-card-campsite');
      const count = await cards.count();
      expect(
        count,
        'fewer than 4 cards to count columns on',
      ).toBeGreaterThanOrEqual(4);
      const lefts = new Set<number>();
      for (let i = 0; i < Math.min(count, 8); i++) {
        const b = await cards.nth(i).boundingBox();
        lefts.add(Math.round(b!.x));
      }
      expect(
        lefts.size,
        `at ${width}px the cards sit in ${lefts.size} columns`,
      ).toBe(columns);
    });
  }

  test('each campsite card carries a flag, the country, the name and a working link', async ({
    page,
    request,
  }) => {
    const docs = await index(request);
    const { code } = biggestCountry(docs);
    await openComplete(
      page,
      `/search?q=${encodeURIComponent(countryNameOf(code))}`,
    );
    const first = page.getByTestId('search-card-campsite').first();
    await expect(first).toBeVisible();
    await expect(first.locator('img.ct-flag')).toHaveAttribute(
      'src',
      `/flags/${code}.svg`,
    );
    await expect(first).toContainText(countryNameOf(code));
    const href = await first.getAttribute('href');
    expect(href).toMatch(new RegExp(`^/camping/${code}/`));
    expect((await page.request.get(href!)).status()).toBe(200);
  });

  test('the countries under the box are flag cards', async ({ page }) => {
    await openComplete(page, '/search');
    const tiles = page.locator('a.ct-tile');
    expect(
      await tiles.count(),
      'no country cards under the box',
    ).toBeGreaterThan(0);
    // The flags are lazy, so a card below the fold has not asked for its
    // image yet: scroll to each one before asking whether it arrived.
    for (let i = 0; i < (await tiles.count()); i++) {
      await tiles.nth(i).scrollIntoViewIfNeeded();
    }
    // Every card has a flag image that actually loaded.
    await expect
      .poll(async () =>
        tiles.evaluateAll(
          (els) =>
            els.filter((el) => {
              const img = el.querySelector('img.ct-flag') as HTMLImageElement | null;
              return !img || !img.complete || img.naturalWidth === 0;
            }).length,
        ),
      )
      .toBe(0);
    const broken = await tiles.evaluateAll(
      (els) =>
        els.filter((el) => {
          const img = el.querySelector('img.ct-flag') as HTMLImageElement | null;
          return !img || !img.complete || img.naturalWidth === 0;
        }).length,
    );
    expect(broken, 'country cards without a loaded flag').toBe(0);
  });
});

// 🔴 A new widget with roles and states is exactly what an a11y scan is
// for, and /search had no scan at all. Light and dark, on every tab,
// with results on screen (an empty page proves nothing about cards).
test.describe('🔴 CAMP-455: accessibility of the results', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const tab of ['campsites', 'regions', 'countries'] as const) {
      test(`axe finds nothing on the ${tab} tab, ${scheme} theme`, async ({
        page,
        request,
      }) => {
        const docs = await index(request);
        const { code } = biggestCountry(docs);
        await page.emulateMedia({ colorScheme: scheme });
        await openComplete(
          page,
          `/search?q=${encodeURIComponent(countryNameOf(code))}&tab=${tab}`,
        );
        // Cards on screen, or the scan has nothing to look at.
        await expect(page.getByTestId('search-panel')).toHaveAttribute(
          'data-tab',
          tab,
        );
        await expect(
          page.locator('[data-testid^="search-card-"]').first(),
        ).toBeVisible();
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  }
});
