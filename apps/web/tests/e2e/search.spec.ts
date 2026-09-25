import { expect, test, type APIRequestContext } from './api-request';
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
    await expect(page.getByTestId('search')).toHaveAttribute('data-complete', 'true');
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
    await expect(page.getByTestId('search')).toHaveAttribute('data-complete', 'true');
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
    await expect(page.getByTestId('search')).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('search-results')).toContainText(
      subject.name,
    );
  });

  test('says so plainly when nothing matches', async ({ page }) => {
    await page.goto('/search?q=zzzzqqqqxxxx');
    await expect(page.getByTestId('search')).toHaveAttribute('data-complete', 'true');
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
