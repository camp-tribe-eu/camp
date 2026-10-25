import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './api-request';
import { axeViolations } from './axe';
import { visibleText } from '../unit/rendered-text';
import type { Page, Route } from '@playwright/test';
import { openHeaderNav } from './header-nav';

// CAMP-205 — /plan, як її зустрічає читач.
// CAMP-391 — і тепер вона справді питає планувальник.
//
// 🔴 ЩО ТУТ МОЖНА ДОВЕСТИ, А ЩО НІ — і це не прогалина тесту, а факт збірки.
// Форма питає API з БРАУЗЕРА, за адресою `NEXT_PUBLIC_API_BASE_URL`, яку Next
// вбудовує в бандл під час збірки. Збірка CI її не має (так само, як сторінки
// акаунта, tests/e2e/account.spec.ts), тож там форма чесно каже «планувальник
// не відповів» і не шле нічого. Тому цей файл має ТРИ частини:
//
//   · будь-яка збірка: виданий документ, поля, помилки, фокус, клавіатура —
//     те, що від API не залежить;
//   · збірка БЕЗ адреси API (CI): відмова названа, і в мережу не йде нічого;
//   · збірка ІЗ адресою (локально й де її задано): відповідь API підміняє
//     `page.route` ЗНЯТИМИ З СЕРВЕРА байтами (tests/unit/fixtures/plan-*.json,
//     ті самі, що читає plan-source.spec.ts і звіряє plan-response.spec.ts в
//     API). Це перевіряє те, чого не бачить жоден юніт-тест: що саме браузер
//     відправляє (метод, заголовок, тіло числами), і як намальована справжня
//     відповідь у справжній сторінці — розмітка, фокус, ширина, axe.
//
// Що НЕ доводиться жодною частиною тут: що браузер ДІСТАЄТЬСЯ до справжнього
// API (CORS, CSP, `connect-src`). Це прогнано руками з живим API й записано в
// описі PR — розмова з сервером без підміни.
//
// Частина читає HTML через `request`, а не через браузер, і це навмисно:
// речення про те, що планувальник робить і чого не знає, мусить бути в виданому
// документі, а не зʼявлятись після виконання бандла. Його бачать і краулер, і
// асистент, і читач із повільним зʼєднанням.
//
// Правила розмітки (підписи, aria-*, порядок помилок) перевіряє
// tests/unit/plan-view.spec.ts на виданому HTML; тут — те, чого розмітка
// без браузера не показує: фокус, клавіатура, мережа, сховища, ширина.

const VERDICT = 'This planner cuts a straight line into days.';

/** Адреса API, вбудована в збірку, яку зараз перевіряють; порожня — збірка без неї. */
const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

interface Captured {
  status: number;
  body: unknown;
}
const captured = (name: string): Captured =>
  JSON.parse(readFileSync(path.join(__dirname, '..', 'unit', 'fixtures', `${name}.json`), 'utf8'));

const place = (page: Page) => ({
  from: page.getByLabel('Starting point'),
  to: page.getByLabel('Destination'),
  days: page.getByLabel('Number of days'),
  submit: page.getByRole('button', { name: 'Check my trip' }),
  errors: page.getByTestId('plan-errors'),
  result: page.getByTestId('plan-result'),
});

/** Відкрити сторінку й дочекатись, поки форма оживе: до того поля вимкнені. */
async function open(page: Page) {
  await page.goto('/plan');
  await expect(place(page).from).toBeEnabled();
  return place(page);
}

/** Ліон → Барселона на сім днів: ті самі числа, з якими зняті файли. */
const LYON = '45.764, 4.8357';
const BARCELONA = '41.3874, 2.1686';

async function fillValid(
  f: ReturnType<typeof place>,
  over: Partial<Record<'from' | 'to' | 'days', string>> = {},
) {
  await f.from.fill(over.from ?? LYON);
  await f.to.fill(over.to ?? BARCELONA);
  await f.days.fill(over.days ?? '7');
}

/**
 * Підмінити відповідь API знятими байтами й записати, що браузер відправив.
 *
 * 🔴 Підмінюється лише НАШЕ API (його адреса з білда), і лише `POST /plan`:
 * сама сторінка — теж `/plan`, але GET і з іншого походження. Попередній
 * запит (OPTIONS, який браузер шле перед JSON-запитом через межу походження)
 * відповідає так, як відповів би сервер.
 */
async function stubApi(
  page: Page,
  answer: () => { status: number; body: unknown } | 'abort',
) {
  const sent: Array<{ method: string; headers: Record<string, string>; body: unknown }> = [];
  const url = new URL('/plan', API).toString();
  await page.route(url, async (route: Route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST',
    };
    if (req.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    sent.push({ method: req.method(), headers: req.headers(), body: req.postDataJSON() });
    const a = answer();
    if (a === 'abort') {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: a.status,
      headers: { ...cors, 'content-type': 'application/json' },
      body: JSON.stringify(a.body),
    });
  });
  return sent;
}

// 🔴 У збірці з адресою API ЖОДЕН тест цього файла не питає справжній сервер:
// без цього кожен тест, що натискає кнопку, брав би з ліміту (10 за хвилину)
// машини, на якій його запустили, і залежав би від її бази. Типова відповідь —
// знятий план; тест, якому потрібна інша, ставить свою (пізніший `route`
// старшує). Без адреси API відповіді підмінювати нема чого: запиту немає.
test.beforeEach(async ({ page }) => {
  if (API !== '') await stubApi(page, () => captured('plan-ok'));
});

test.describe('the page', () => {
  test('🔴 says in the served HTML, before the form, what it does and what it does not know', async ({ request }) => {
    const res = await request.get('/plan');
    expect(res.status()).toBe(200);
    const html = await res.text();
    const said = visibleText(html);
    expect(said).toContain(VERDICT);
    expect(said.indexOf('Your trip')).toBeGreaterThan(said.indexOf(VERDICT));
    // Чого він не знає — до форми, а не під нею.
    expect(said).toContain('every distance is a straight line and there are no driving times');
    expect(said).toContain('we hold no data on pitch sizes');
    expect(said).toContain('It takes coordinates, not place names');
    // І старого речення немає.
    expect(said).not.toMatch(/does not calculate routes yet/i);
  });

  test('is noindex but followable, like /search', async ({ request }) => {
    const html = await (await request.get('/plan')).text();
    const robots = /<meta name="robots" content="([^"]+)"/i.exec(html)?.[1] ?? '';
    expect(robots).toContain('noindex');
    expect(robots).not.toContain('nofollow');
  });

  for (const from of ['/contact', '/tools']) {
    test(`🔴 the header on ${from} leads here`, async ({ page }) => {
      // Шапка одна на весь сайт, тож «вхід із /map» — це вхід із будь-якої
      // сторінки. Стартові сторінки тут ті, що не потребують API.
      await page.goto(from);
      // 🔴 CAMP-350: нижче 1200 px шапка веде через бургер. Спосіб
      // дістатись меню винесений у `openHeaderNav` після того, як та
      // сама помилка вилізла вдруге — у `guides.spec.ts`.
      const nav = await openHeaderNav(page);
      await nav.getByRole('link', { name: 'Plan a trip' }).click();
      await expect(page).toHaveURL(/\/plan$/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trip planner');
    });
  }
});

test.describe('the form', () => {
  test('every field can be found by its label and starts empty — and there is no vehicle to choose', async ({ page }) => {
    const f = await open(page);
    for (const field of [f.from, f.to, f.days]) await expect(field).toBeVisible();
    await expect(f.from).toHaveValue('');
    await expect(f.to).toHaveValue('');
    await expect(f.days).toHaveValue('');
    await expect(f.result).toContainText('Nothing asked yet');
    await expect(page.getByLabel('Vehicle', { exact: true })).toHaveCount(0);
  });

  test('🔴 an empty submit explains itself, takes focus, and lists every problem', async ({ page }) => {
    const f = await open(page);
    await f.submit.click();

    await expect(f.errors).toBeVisible();
    await expect(f.errors).toHaveAttribute('role', 'alert');
    await expect(f.errors).toBeFocused();
    await expect(f.errors.getByRole('link')).toHaveText([
      'Enter where the trip starts, as latitude and longitude, for example 46.0569, 14.5058.',
      'Enter where the trip ends, as latitude and longitude, for example 43.5081, 16.4402.',
      'Enter how many days the trip lasts.',
    ]);
    for (const field of [f.from, f.to, f.days]) {
      await expect(field).toHaveAttribute('aria-invalid', 'true');
    }
    // Нічого не «відповіло»: панель досі порожня.
    await expect(f.result).toContainText('Nothing asked yet');
    await expect(f.result).not.toContainText('did not answer');
  });

  test('🔴 an error link moves focus to its field, and fixing it removes that error only', async ({ page }) => {
    const f = await open(page);
    await f.submit.click();
    await f.errors.getByRole('link', { name: 'Enter how many days the trip lasts.' }).click();
    await expect(f.days).toBeFocused();

    await page.keyboard.type('7');
    await expect(f.errors.getByRole('link')).toHaveCount(2);
    await expect(f.days).not.toHaveAttribute('aria-invalid', 'true');
    await expect(f.from).toHaveAttribute('aria-invalid', 'true');
  });

  test('each kind of bad number says what is wrong with it', async ({ page }) => {
    const f = await open(page);
    await fillValid(f);
    for (const [typed, message] of [
      ['7.5', 'Use a whole number of days, for example 7.'],
      ['0', 'Days must be between 1 and 60.'],
      ['61', 'Days must be between 1 and 60.'],
      ['', 'Enter how many days the trip lasts.'],
    ] as const) {
      await f.days.fill(typed);
      await f.submit.click();
      await expect(f.errors.getByRole('link')).toHaveText([message]);
      await expect(page.locator('#plan-days-error')).toContainText(message);
    }
  });

  test('🔴 a place NAME is refused with the reason: nothing looks names up, and the hint says so', async ({ page }) => {
    const f = await open(page);
    await fillValid(f, { from: 'Ljubljana' });
    await f.submit.click();
    await expect(f.errors.getByRole('link')).toHaveText([
      'Write where the trip starts as two numbers, latitude then longitude, for example 46.0569, 14.5058. A place name is not looked up.',
    ]);
    await expect(f.from).toHaveAttribute('aria-invalid', 'true');
    await expect(f.errors).toBeFocused();
    // Підказка під полем — та сама правда, і вона прикріплена до поля.
    const described = await f.from.getAttribute('aria-describedby');
    expect(described).toContain('plan-places-hint');
    await expect(page.locator('#plan-places-hint')).toContainText('Place names are not looked up yet');
  });

  test('🔴 coordinates written the way maps copy them are read: comma, semicolon, space, degree signs, the real minus', async ({ page }) => {
    const f = await open(page);
    for (const typed of ['46.0569,14.5058', '46.0569 14.5058', '46.0569; 14.5058', '46.0569°, 14.5058°']) {
      await f.from.fill(typed);
      await f.to.fill('43.5081, 16.4402');
      await f.days.fill('7');
      await f.submit.click();
      await expect(f.errors, typed).toHaveCount(0);
    }
    await f.from.fill('−38.7223, −9.1393');
    await f.submit.click();
    await expect(f.errors).toHaveCount(0);
  });

  test('🔴 it works from the keyboard: type, Tab between the fields, Enter sends', async ({ page }) => {
    const f = await open(page);
    await f.from.focus();
    await page.keyboard.type('46.3683, 14.1146');
    await page.keyboard.press('Tab');
    await expect(f.to).toBeFocused();
    await page.keyboard.type('44.1194, 15.2314');
    await page.keyboard.press('Tab');
    await expect(f.days).toBeFocused();
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');

    // Відправилось: панель вийшла зі стану «ще нічого» — які б слова в ній не були.
    await expect(f.result).not.toContainText('Nothing asked yet');
    await expect(f.errors).toHaveCount(0);
    // І все, що людина набрала, на місці.
    await expect(f.from).toHaveValue('46.3683, 14.1146');
    await expect(f.to).toHaveValue('44.1194, 15.2314');
    await expect(f.days).toHaveValue('10');
  });

  test('🔴 the answer never describes a request other than the one in the form', async ({ page }) => {
    const f = await open(page);
    await fillValid(f);
    await f.submit.click();
    await expect(f.result).not.toContainText('Nothing asked yet');

    await f.to.fill('43.5081, 16.4402');
    await expect(f.result).toContainText('Nothing asked yet');
    await expect(f.result).not.toContainText('What you asked for');
  });

  test('🔴 with no JavaScript the verdict is still served and the form says it is inert', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    const res = await page.goto('/plan');
    expect(res?.status()).toBe(200);

    await expect(page.getByTestId('planner-status')).toContainText(VERDICT);
    await expect(page.getByLabel('Starting point')).toBeDisabled();
    await expect(page.getByLabel('Number of days')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Check my trip' })).toBeDisabled();
    await expect(page.getByTestId('plan-loading')).toBeVisible();
    await context.close();
  });
});

// ── Збірка БЕЗ адреси API: так в CI ─────────────────────────────────────

if (API === '') {
  test.describe('a build with no API address (CI)', () => {
    test('🔴 the form says the planner did not answer, keeps what was typed, and sends NOTHING anywhere', async ({ page }) => {
      // Панель каже «did not answer», а не «ваші дані пішли на сервер»: у цій
      // збірці вони нікуди не йдуть, і це твердження про браузер, тож його
      // перевіряє браузер: унікальні числа, і після відправки — жоден запит
      // їх не несе, жодне сховище не має.
      const needle = '47.123456, 8.654321';
      const seen: string[] = [];
      const posts: string[] = [];
      page.on('request', (r) => {
        seen.push(`${r.url()} ${r.postData() ?? ''}`);
        if (r.method() !== 'GET') posts.push(`${r.method()} ${r.url()}`);
      });

      const f = await open(page);
      await fillValid(f, { from: needle });
      await f.submit.click();
      await expect(f.result).toContainText('The planner did not answer.');
      await expect(f.result).toContainText('still in the form');
      await expect(f.result).not.toContainText('sent to our server');
      await expect(f.from).toHaveValue(needle);
      await page.waitForLoadState('networkidle');

      expect(seen.filter((s) => s.includes('47.123456')), 'введені числа потрапили в запит').toEqual([]);
      expect(posts, 'після відправки пішов не-GET запит').toEqual([]);

      const stored = await page.evaluate(() => {
        const dump = (s: Storage) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`).join('\n');
        return [dump(localStorage), dump(sessionStorage), document.cookie].join('\n');
      });
      expect(stored.includes('47.123456'), 'введене потрапило у сховище чи cookie').toBe(false);
      expect(page.url()).not.toContain('47.123456');
    });
  });
}

// ── Збірка ІЗ адресою API: відповідь підмінено знятими байтами ─────────

if (API !== '') {
  test.describe('a build with an API address: the recorded answers, in the real page', () => {
    test('🔴 a valid request goes out as JSON with numbers, and the plan comes back as a plan', async ({ page }) => {
      const plan = captured('plan-ok');
      const sent = await stubApi(page, () => plan);
      const f = await open(page);
      await fillValid(f);
      await f.submit.click();

      await expect(f.result).toContainText('7 days, 6 nights.');
      expect(sent).toHaveLength(1);
      expect(sent[0].method).toBe('POST');
      expect(sent[0].headers['content-type']).toBe('application/json');
      // Рівно три ключі, числа, а не рядки — те, чого API вимагає.
      expect(sent[0].body).toEqual({
        from: { lat: 45.764, lon: 4.8357 },
        to: { lat: 41.3874, lon: 2.1686 },
        days: 7,
      });

      // Намальовано з відповіді: сім днів у порядку, шість ночівель, остання ніч — кінець.
      await expect(f.result.getByRole('heading', { level: 4 })).toHaveText([
        'Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7',
      ]);
      await expect(f.result.getByRole('link', { name: 'Blue Bayou' })).toHaveAttribute(
        'href',
        '/camping/fr/herault/blue-bayou',
      );
      await expect(f.result).toContainText('Every distance here is a straight line, not a road.');
      await expect(f.result).toContainText('to your destination.');
      // Ранжування — з відповіді.
      await expect(f.result).toContainText('How close it is to where the day should end: 75%');
      // Джерело й дата стоять поруч із записом зі зірками.
      await expect(f.result).toContainText('DATAtourisme. Last updated by the source on 7 September 2026.');
      await expect(f.errors).toHaveCount(0);
    });

    test('🔴 it works from the keyboard against the recorded plan: Enter sends, and the plan appears', async ({ page }) => {
      const sent = await stubApi(page, () => captured('plan-ok'));
      const f = await open(page);
      await f.from.focus();
      await page.keyboard.type(LYON);
      await page.keyboard.press('Tab');
      await page.keyboard.type(BARCELONA);
      await page.keyboard.press('Tab');
      await page.keyboard.type('7');
      await page.keyboard.press('Enter');
      await expect(f.result).toContainText('7 days, 6 nights.');
      expect(sent).toHaveLength(1);
    });

    test('🔴 the answer never describes a request other than the one in the form — and a changed field asks nothing by itself', async ({ page }) => {
      const sent = await stubApi(page, () => captured('plan-ok'));
      const f = await open(page);
      await fillValid(f);
      await f.submit.click();
      await expect(f.result).toContainText('7 days, 6 nights.');

      await f.days.fill('9');
      await expect(f.result).toContainText('Nothing asked yet');
      await expect(f.result).not.toContainText('7 days');
      expect(sent, 'редагування само спитало сервер').toHaveLength(1);

      await f.submit.click();
      await expect(f.result).toContainText('7 days, 6 nights.');
      expect(sent).toHaveLength(2);
      expect(sent[1].body).toMatchObject({ days: 9 });
    });

    test('🔴 «ланцюжка немає», коло, поза ЄС, ліміт і збій — кожне своїми словами, і жодне не вдає плану', async ({ page }) => {
      const states: Array<[string, () => Captured | 'abort', string]> = [
        ['no chain', () => captured('plan-no-chain'), 'No plan found.'],
        ['round trip', () => captured('plan-round-trip'), 'No plan for a round trip.'],
        ['outside the Union', () => captured('plan-outside-union'), 'The start is outside the European Union.'],
        ['throttled', () => captured('plan-throttled'), 'Too many plans in a minute.'],
        ['network failure', () => 'abort', 'The planner did not answer.'],
        ['a server error', () => ({ status: 503, body: { code: 'planner_busy' } }), 'The planner did not answer.'],
      ];
      let next = 0;
      await stubApi(page, () => states[next][1]());
      const f = await open(page);
      await fillValid(f);
      for (const [i, [name, , sentence]] of states.entries()) {
        next = i;
        await f.submit.click();
        await expect(f.result, name).toContainText(sentence);
        await expect(f.result, name).not.toContainText('Day 1');
        await expect(f.result, name).not.toContainText('A night at');
        // Людині лишається її форма, щоб виправити й спробувати знову.
        await expect(f.from, name).toHaveValue(LYON);
        await expect(f.days, name).toHaveValue('7');
        // Редагування скидає відповідь, і можна питати знову.
        await f.days.fill('7');
      }
    });

    test('🔴 the longest campsite name fits a phone: no sideways scrolling', async ({ page }) => {
      // Назва кемпінгу — довільний текст з OSM. 120 літер без пробілу
      // розтягли сторінку до 1890px у першій версії (див. plan-view.tsx).
      const plan = JSON.parse(JSON.stringify(captured('plan-ok')));
      plan.body.days[0].night.name = 'W'.repeat(120);
      await stubApi(page, () => plan);
      await page.setViewportSize({ width: 375, height: 812 });
      const f = await open(page);
      await fillValid(f);
      await f.submit.click();
      await expect(f.result).toContainText('7 days, 6 nights.');

      const overflow = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        view: document.documentElement.clientWidth,
      }));
      expect(overflow.scroll, 'сторінка ширша за екран').toBeLessThanOrEqual(overflow.view);
      const box = await page.locator('#plan-result-heading').locator('..').boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(overflow.view);
    });

    for (const scheme of ['light', 'dark'] as const) {
      test(`🔴 no accessibility violations in ${scheme} mode: the plan, and each refusal`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        const files = ['plan-ok', 'plan-no-chain', 'plan-round-trip', 'plan-outside-union', 'plan-throttled'];
        let next = 0;
        await stubApi(page, () => captured(files[next]));
        const f = await open(page);
        await fillValid(f);
        for (const [i, name] of files.entries()) {
          next = i;
          await f.submit.click();
          await expect(f.result, name).not.toContainText('Asking the planner');
          await expect(f.result, name).not.toContainText('Nothing asked yet');
          expect(await axeViolations(page), name).toEqual([]);
          await f.days.fill('7');
        }
      });
    }

    test('the console stays clean through a plan', async ({ page }) => {
      const problems: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      await stubApi(page, () => captured('plan-ok'));

      const f = await open(page);
      await f.submit.click();
      await fillValid(f);
      await f.submit.click();
      await expect(f.result).toContainText('7 days, 6 nights.');
      await f.days.fill('9');
      await expect(f.result).toContainText('Nothing asked yet');
      expect(problems).toEqual([]);
    });
  });
}

test.describe('accessibility (any build)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`🔴 no violations in ${scheme} mode: empty, with errors, and after a send`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const f = await open(page);
      expect(await axeViolations(page), 'empty').toEqual([]);

      await f.submit.click();
      await expect(f.errors).toBeVisible();
      expect(await axeViolations(page), 'with errors').toEqual([]);

      await fillValid(f);
      await f.submit.click();
      await expect(f.result).not.toContainText('Nothing asked yet');
      await expect(f.result).not.toContainText('Asking the planner');
      expect(await axeViolations(page), 'after a send').toEqual([]);
    });
  }

  test('🔴 the phone width: no sideways scrolling with errors on screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const f = await open(page);
    await f.submit.click();
    await expect(f.errors).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      view: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, 'сторінка ширша за екран').toBeLessThanOrEqual(overflow.view);
  });
});
