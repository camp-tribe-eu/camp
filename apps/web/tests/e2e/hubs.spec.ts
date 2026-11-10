import { expect, test, type APIRequestContext } from './api-request';
import { API_BASE, REGION_PER_PAGE } from '@/lib/api';

/**
 * Regions are resolved from the database, never named in the test.
 * A fixture pinned to "zelezniki" tests today's import, not the rule —
 * and the campsite specs already broke twice that way.
 */
interface Region {
  region: string;
  slug: string;
  spots: number;
  indexable: boolean;
  /** Which country hub it hangs off — needed to build any URL. */
  country: string;
}

/**
 * Regions are resolved from the database, never named in the test.
 * A fixture pinned to "zelezniki" tests today's import, not the rule —
 * and the campsite specs already broke twice that way.
 *
 * 🔴 Across every country, not just Slovenia. These tests asked
 * `/spots/si/regions` and built `/camping/si/…` URLs, which was harmless
 * while Slovenia was the only country — and then silently wrong: the
 * pagination tests kept skipping with "nothing paginates at the current
 * data volume" after Croatia arrived with eight paginated counties,
 * because Slovenia's admin-1 units are municipalities and no Slovenian
 * region will ever reach a page. A test that names a country is a test
 * about that country.
 */
/**
 * 🔴 ЧИТАЄТЬСЯ ОДИН РАЗ НА ПРОЦЕС, І ЦЕ НЕ ОПТИМІЗАЦІЯ, А ЛІКУВАННЯ.
 *
 * Кожен виклик обходить `/spots/countries` і потім `/spots/{країна}/regions`
 * по всіх 27 країнах — 28 запитів. Наш власний обмежувач частоти рахує їх
 * по IP, і коли CAMP-451 додала сюди ще три тести, помічник почав падати
 * «rs.map is not a function»: API віддавав 429, а тіло помилки — обʼєкт,
 * а не масив. Заміряно локально 10.11.2026.
 *
 * 🔴 ЧОМУ КЕШ ТУТ БЕЗПЕЧНИЙ, хоч «кешована обіцянка робить тест залежним
 * від порядку» — правило, яке в цьому проєкті вже коштувало прогонів
 * (CAMP-476). Різниця в тому, що тут дані ЛИШЕ ЧИТАЮТЬСЯ і однакові для
 * всіх тестів файла: жоден із них не підміняє відповідь API і не чекає
 * іншої. Якби колись знадобився тест на ІНШИЙ стан бази, він мусив би
 * скинути цей кеш — і цей абзац існує, щоб це було видно.
 */
let regionsCache: Promise<{ all: Region[]; thin: Region; fat: Region }> | null = null;

function regions(request: APIRequestContext) {
  if (regionsCache === null) {
    regionsCache = fetchRegions(request).catch((e: unknown) => {
      // Провал не кешується: одна тимчасова 429 не має класти весь файл.
      regionsCache = null;
      throw e;
    });
  }
  return regionsCache;
}

async function fetchRegions(request: APIRequestContext) {
  const countries: { country: string }[] = await (
    await request.get(`${API_BASE}/spots/countries`)
  ).json();

  const all: Region[] = [];
  for (const { country } of countries) {
    const rs: Omit<Region, 'country'>[] = await (
      await request.get(`${API_BASE}/spots/${country}/regions`)
    ).json();
    all.push(...rs.map((r) => ({ ...r, country })));
  }

  const thin = all.find((r) => !r.indexable);
  const fat = all.find((r) => r.indexable);
  if (!thin || !fat) {
    throw new Error('Need at least one indexable and one thin region in the data');
  }
  return { all, thin, fat };
}

/** The hub URL of a region, whichever country it belongs to. */
const hub = (r: Region) => `/camping/${r.country}/${r.slug}`;

// CAMP-71. The card's criterion is one sentence: "from the home page you
// can reach any campsite card in at most 4 clicks, without using the map
// and without JavaScript."
//
// So the test turns JavaScript off and actually walks it. Anything that
// depends on hydration — the map, a click-handler paginator, a filter that
// rewrites the list — is invisible here, which is exactly the point: it is
// also invisible to a crawler that does not run our scripts.

test.describe('hub crawl path', () => {
  test.use({ javaScriptEnabled: false });

  test('🔴 home → campsite in 4 clicks with no JavaScript', async ({
    page,
  }) => {
    let clicks = 0;

    await page.goto('/');
    // By destination, not by wording: the home page's copy is CAMP-41's
    // to change, and a test pinned to a phrase breaks on a rewrite while
    // the path it is actually asserting still works.
    await page.locator('main a[href="/camping"]').first().click();
    clicks++;
    await expect(page).toHaveURL(/\/camping$/);

    await page.getByRole('link', { name: /Slovenia/i }).first().click();
    clicks++;
    await expect(page).toHaveURL(/\/camping\/si$/);

    // Whichever region the country page lists first — the claim is about
    // the path, not about a particular place.
    const firstRegion = page.locator('main ul li a').first();
    const regionHref = await firstRegion.getAttribute('href');
    await firstRegion.click();
    clicks++;
    await expect(page).toHaveURL(new RegExp(`${regionHref}$`));

    await page.locator('main ul li a').first().click();
    clicks++;

    await expect(page).toHaveURL(new RegExp(`${regionHref}/[a-z0-9-]+$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(clicks).toBeLessThanOrEqual(4);
  });

  test('a thin region is still reachable from its country', async ({
    page,
    request,
  }) => {
    // Thin regions are noindex, but they must stay linked — otherwise
    // their campsites hang off the sitemap alone and the four-click claim
    // holds only for the big regions.
    const { thin } = await regions(request);
    await page.goto(`/camping/${thin.country}`);

    // 🔴 НЕ `toBeVisible()` НА ГОЛОМУ ЛОКАТОРІ. Після CAMP-451 сторінка
    // країни веде на той самий регіон кількома шляхами — плиткою, тікером
    // найбільших регіонів і лічильником — і строгий режим Playwright падав
    // на «resolved to 3 elements». Це не дефект сторінки: три шляхи до
    // регіону більш «linked», ніж один.
    //
    // Але `.first()` тут був би гіршим за падіння: якби видимим лишився
    // лише третій, тест червонів би на першому й звинувачував сторінку в
    // тому, чого немає. Тому твердження каже те, що справді потрібно —
    // посилання існує, і принаймні одне з них читач бачить.
    const links = page.locator(`a[href="${hub(thin)}"]`);
    expect(
      await links.count(),
      'тонкий регіон зник із країни: жодного посилання',
    ).toBeGreaterThan(0);
    await expect(
      links.filter({ visible: true }).first(),
      'посилання на тонкий регіон є в розмітці, але жодне не видиме',
    ).toBeVisible();
  });

  test('pagination works as plain links', async ({ page, request }) => {
    // Data-driven on purpose. Before deduplication Bovec held 33 sites and
    // paginated; after it holds 20, and no Slovenian region reaches the
    // page size. Hard-coding a region here would make this test a claim
    // about a dataset rather than about the paginator, and it would break
    // again on the next import.
    const { all } = await regions(request);
    const paged = all.find((r) => r.spots > REGION_PER_PAGE);
    test.skip(
      !paged,
      `No region currently exceeds ${REGION_PER_PAGE} campsites, so nothing paginates.`,
    );

    await page.goto(hub(paged!));
    await page
      .getByRole('navigation', { name: 'Pagination' })
      // 🔴 `exact`, because a region with twelve pages makes "2" match
      // "12" as well. It passed for a year on regions that never had
      // more than nine pages, and broke the day France arrived — a test
      // that was right about behaviour and wrong about scale.
      .getByRole('link', { name: '2', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${hub(paged!)}/page/2$`));
    await expect(page.locator('main ul li a').first()).toBeVisible();

    // 🔴 CAMP-451, «Спосіб перевірки»: «перехід на останню сторінку
    // віддає 200 і непорожній список».
    //
    // Твердження живе ТУТ, а не в окремому тесті, і це не ліньки. Свій
    // тест мусив би мати свій `test.skip` на той самий випадок «нічого
    // не пагінується» — і сторож бюджету пропусків упіймав мене на
    // 39 проти 38: «тест, що відмовився бігти, не відрізнити від тесту,
    // що пройшов». Регіон із пагінацією вже знайдено рядком вище.
    const last = Math.ceil(paged!.spots / REGION_PER_PAGE);
    expect(last, 'остання сторінка порахувалась у 1 — пагінації немає').toBeGreaterThan(1);

    const url = `${hub(paged!)}/page/${last}`;
    const res = await request.get(url);
    expect(res.status(), `${url} → ${res.status()}`).toBe(200);

    // 🔴 200 САМ ПО СОБІ НІЧОГО НЕ ДОВОДИТЬ: порожня остання сторінка
    // теж віддасть 200. Тому рахуються картки у відданому HTML.
    const cards = ((await res.text()).match(/class="ct-card"/g) ?? []).length;
    expect(
      cards,
      `${url}: ${paged!.spots} місць, сторінка ${last} з ${last}, карток ${cards}`,
    ).toBeGreaterThan(0);
  });

  test('a region that fits on one page shows no paginator', async ({
    page,
    request,
  }) => {
    const { all } = await regions(request);
    const small = all.find((r) => r.spots <= REGION_PER_PAGE)!;
    await page.goto(hub(small));
    await expect(
      page.getByRole('navigation', { name: 'Pagination' }),
    ).toHaveCount(0);
  });
});

test.describe('hub indexing rules', () => {
  test('🔴 a thin region is noindex, but still followed', async ({
    request,
  }) => {
    // Below the threshold there is nothing for a reader to choose
    // between, so the hub adds nothing over the campsite's own page.
    const { thin } = await regions(request);
    const html = await (await request.get(hub(thin))).text();
    expect(html).toMatch(/<meta name="robots" content="noindex[,\s]*follow/i);
  });

  test('a region above the threshold is indexable', async ({ request }) => {
    // 🔴 Only observable in a public build: when the whole site is closed
    // (CAMP-90) every page is noindex and the threshold makes no visible
    // difference. Skipped rather than weakened — the rule is asserted in
    // CI's public-build job by check-indexing.mjs --expect public.
    test.skip(
      process.env.NEXT_PUBLIC_SITE_MODE !== 'public',
      'The indexing threshold is invisible while the whole site is closed.',
    );
    const { fat } = await regions(request);
    const html = await (await request.get(hub(fat))).text();
    expect(html).not.toMatch(/content="noindex/i);
  });

  test('page 2 never competes with the region itself', async ({ request }) => {
    const { all } = await regions(request);
    const paged = all.find((r) => r.spots > REGION_PER_PAGE);
    test.skip(!paged, 'Nothing paginates at the current data volume.');

    // Asserting on a 404 would pass for the wrong reason — Next's
    // not-found page is noindex too.
    const res = await request.get(`${hub(paged!)}/page/2`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toMatch(
      /<meta name="robots" content="noindex/i,
    );
  });

  test('every hub declares a canonical', async ({ request }) => {
    const { fat } = await regions(request);
    for (const url of ['/camping', `/camping/${fat.country}`, hub(fat)]) {
      const html = await (await request.get(url)).text();
      expect(html, url).toMatch(/<link rel="canonical"/i);
    }
  });
});

/**
 * CAMP-451, «Спосіб перевірки», пункт 1: «Усі регіони країни мають
 * картку: число карток = число регіонів у базі, обидва надрукувати».
 *
 * 🔴 ОБИДВА ЧИСЛА ДРУКУЮТЬСЯ НАВМИСНО. «Усі на місці» над порожнім
 * переліком істинне й нічого не варте; а коли воно впаде, перше
 * питання буде «скільки ж їх мало бути» — і відповідь має бути в
 * звіті, а не в наступному прогоні.
 */
test.describe('🔴 CAMP-451 — картки регіонів на сторінці країни', () => {
  test('кожен регіон країни має картку', async ({ page, request }, testInfo) => {
    const { all } = await regions(request);
    // Країна з найбільшою кількістю регіонів: там найлегше загубити
    // хвіст переліку, і там це найдорожче.
    const byCountry = new Map<string, number>();
    for (const r of all) byCountry.set(r.country, (byCountry.get(r.country) ?? 0) + 1);
    const [country, expected] = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0];
    expect(expected, 'у жодної країни немає регіонів').toBeGreaterThan(0);

    await page.goto(`/camping/${country}`);
    const cards = page.locator('a.ct-rtile');
    const drawn = await cards.count();

    const summary = `${country}: регіонів у базі ${expected}, карток на сторінці ${drawn}`;
    console.log(summary);
    testInfo.annotations.push({ type: 'замір', description: summary });

    expect(drawn, summary).toBe(expected);
  });

  /**
   * 🔴 МУТАЦІЯ, ЯКУ ПРОСИТЬ КАРТКА: «прибрати фото з картки — тест на
   * однакову висоту карток має почервоніти». Висота рядка карток — це
   * те, що читач бачить як охайність: одна картка без зображення
   * ламає рядок, і жоден тест про текст цього не бачить.
   */
  test('🔴 картки регіонів одного рядка однакової висоти', async ({
    page,
    request,
  }, testInfo) => {
    const { all } = await regions(request);
    const country = all[0]?.country;
    expect(country, 'у базі немає жодного регіону').toBeTruthy();

    await page.goto(`/camping/${country}`);
    const cards = page.locator('a.ct-rtile');
    const n = await cards.count();
    expect(n, 'карток регіонів немає зовсім').toBeGreaterThan(1);

    const boxes = await cards.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          top: Math.round(r.top),
          height: Math.round(r.height),
          hasImage: el.querySelector('img, svg, .ct-flag') !== null,
        };
      }),
    );

    // Кожна картка несе зображення — інакше рядок ламається ще до того,
    // як ми порівняємо висоти.
    const blind = boxes.filter((b) => !b.hasImage).length;
    expect(blind, `карток без зображення: ${blind} з ${n}`).toBe(0);

    // Рядки визначаються по верхньому краю; у кожному — одна висота.
    const rows = new Map<number, number[]>();
    for (const b of boxes) rows.set(b.top, [...(rows.get(b.top) ?? []), b.height]);
    const summary = `${country}: карток ${n}, рядків ${rows.size}`;
    testInfo.annotations.push({ type: 'замір', description: summary });

    for (const [top, heights] of rows) {
      expect(
        [...new Set(heights)],
        `рядок ${top}: висоти ${heights.join(', ')} — ${summary}`,
      ).toHaveLength(1);
    }
  });
});
