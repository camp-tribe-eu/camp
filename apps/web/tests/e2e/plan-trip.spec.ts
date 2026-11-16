import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from './api-request';
import { axeViolations } from './axe';
import { visibleText } from '../unit/rendered-text';
import type { Page, Route } from '@playwright/test';

// CAMP-456 — /plan: назви місць, проміжні точки, зворотний шлях, габарити,
// збереження в браузері, посилання «поділитися», `?to=<slug>`, селект за темою,
// липка форма. Усе читається в справжньому браузері, на справжній відданій
// сторінці — не на константі й не на класі.
//
// 🔴 ЯКІ ЧАСТИНИ ТУТ ЗАЛЕЖАТЬ ВІД АДРЕСИ API, А ЯКІ НІ (як і в plan.spec.ts:
// адресу Next вбудовує в бандл під час збірки, і збірка CI її не має):
//
//   · будь-яка збірка: проміжні точки, зворотний шлях, перевірка днів, збереження,
//     посилання, селект, липка форма, `?to=` із недовіреним вмістом, вміст
//     виданого документа;
//   · збірка БЕЗ адреси (CI): пошук за назвою чесно каже, що недоступний, і
//     не шле нічого; координати працюють;
//   · збірка ІЗ адресою: відповіді `/places/*` і `/plan` підміняє `page.route`
//     ЗНЯТИМИ З СЕРВЕРА байтами (tests/unit/fixtures/places-*.json, plan-*.json).
//     Що браузер ДІСТАЄТЬСЯ до справжнього API (CORS, CSP) — прогнано руками з
//     живим API й записано в описі PR.

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/**
 * 🔴 ТЕСТИ, ЯКИМ ПОТРІБНА (АБО ЗАВАЖАЄ) АДРЕСА API, РЕЄСТРУЮТЬСЯ УМОВНО, А НЕ
 * ПРОПУСКАЮТЬСЯ. `test.skip` у CI рахує сторож `check-e2e-skips.mjs`: тест, що
 * відмовився бігти, не відрізнити від тесту, що пройшов, і бюджет пропусків
 * міряє саме це. Збірка CI адреси API не має, тож тести з підміненими
 * відповідями там просто не існують; а тест «без адреси» не існує в збірці з нею.
 * Так само зроблено в plan.spec.ts (`if (API === '') test.describe(…)`).
 */
const withApi: typeof test = ((...args: unknown[]) => {
  if (API !== '') (test as unknown as (...a: unknown[]) => void)(...args);
}) as typeof test;
const withoutApi: typeof test = ((...args: unknown[]) => {
  if (API === '') (test as unknown as (...a: unknown[]) => void)(...args);
}) as typeof test;

interface Captured {
  status: number;
  body: unknown;
}
const captured = (name: string): Captured =>
  JSON.parse(readFileSync(path.join(__dirname, '..', 'unit', 'fixtures', `${name}.json`), 'utf8'));

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, POST',
};

/** Підмінити відповіді API: `POST /plan`, `POST /places/suggest`, `GET /places/campsite/:slug`. */
async function stubApi(
  page: Page,
  over: {
    suggest?: (q: string) => Captured | Promise<Captured> | 'abort';
    campsite?: (slug: string) => Captured | 'abort';
  } = {},
) {
  const plans: Array<{ from: { lat: number; lon: number }; to: { lat: number; lon: number }; days: number }> = [];
  const suggests: Array<{ url: string; body: unknown }> = [];
  const campsites: string[] = [];
  const fulfil = (route: Route, c: Captured) =>
    route.fulfill({
      status: c.status,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(c.body),
    });
  await page.route(new URL('/plan', API).toString(), async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    plans.push(req.postDataJSON());
    return fulfil(route, captured('plan-ok'));
  });
  await page.route(new URL('/places/suggest', API).toString(), async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = req.postDataJSON() as { q: string };
    suggests.push({ url: req.url(), body });
    const answer = await (over.suggest?.(body.q) ?? captured('places-suggest-none'));
    if (answer === 'abort') return route.abort('failed');
    return fulfil(route, answer);
  });
  await page.route(new URL('/places/campsite/*', API).toString(), async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const slug = decodeURIComponent(new URL(req.url()).pathname.split('/').pop() ?? '');
    campsites.push(slug);
    const answer = over.campsite?.(slug) ?? captured('places-campsite-unknown');
    if (answer === 'abort') return route.abort('failed');
    return fulfil(route, answer);
  });
  return { plans, suggests, campsites };
}

const form = (page: Page) => ({
  from: page.getByLabel('Starting point', { exact: true }),
  to: page.getByLabel('Destination', { exact: true }),
  days: page.getByLabel('Number of days'),
  submit: page.getByRole('button', { name: 'Check my trip' }),
  errors: page.getByTestId('plan-errors'),
  result: page.getByTestId('plan-result'),
  add: page.getByTestId('add-via'),
  via: page.getByTestId('via-row'),
  roundTrip: page.getByTestId('round-trip'),
  save: page.getByTestId('save-trip'),
  share: page.getByTestId('share-trip'),
  shareUrl: page.getByTestId('share-url'),
  saveName: page.locator('#plan-save-name'),
  saved: page.getByTestId('saved-item'),
  message: page.getByTestId('keep-message'),
  notice: page.getByTestId('plan-notice'),
  options: page.getByTestId('place-option'),
  status: page.getByTestId('place-status').first(),
});

async function open(page: Page, url = '/plan') {
  await page.goto(url);
  const f = form(page);
  await expect(f.from).toBeEnabled();
  return f;
}

const A = '46.0, 14.0';
const B = '45.0, 15.0';
const C = '44.0, 16.0';

/** Помилки консолі й необроблені винятки сторінки — для тестів, що стверджують «чисто». */
function watchConsole(page: Page) {
  const bad: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') bad.push(m.text());
  });
  page.on('pageerror', (e) => bad.push(String(e)));
  return bad;
}

// ── Виданий документ ──────────────────────────────────────────────────

test.describe('the served page', () => {
  test('🔴 the disclaimer is in the served HTML, before the form, and names the legal page', async ({ request }) => {
    const html = await (await request.get('/plan')).text();
    const node = /<p\b[^>]*data-testid="plan-disclaimer"[^>]*>([\s\S]*?)<\/p>/.exec(html);
    expect(node, 'застереження немає в виданому HTML').not.toBeNull();
    const said = visibleText(node![1]);
    for (const part of [
      'For your information only.',
      'CampTribe is not a navigation app.',
      'you use this at your own discretion and risk',
    ]) {
      expect(said, part).toContain(part);
    }
    expect(node![1]).toContain('href="/legal/disclaimer"');
    const all = visibleText(html);
    expect(all.indexOf('For your information only.')).toBeLessThan(all.indexOf('Your trip'));
  });

  test('🔴 the page no longer says the planner stores nothing about a trip you keep: it names the browser', async ({ request }) => {
    const html = visibleText(await (await request.get('/plan')).text());
    expect(html).toContain('A saved trip stays in this browser only.');
    expect(html).not.toContain('your two points and the number of days were sent to our server. We do not store them.');
  });
});

// ── Дні: 111 — видима помилка ─────────────────────────────────────────

test.describe('days', () => {
  test('🔴 111 days is a visible error that names the limit — not silently accepted', async ({ page }) => {
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('111');
    await f.submit.click();
    await expect(f.errors).toBeVisible();
    await expect(f.errors.getByRole('link')).toHaveText(['Days must be between 1 and 60.']);
    await expect(f.days).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#plan-days-error')).toContainText('Days must be between 1 and 60.');
    await expect(f.result).toContainText('Nothing asked yet');
  });

  test('🔴 fewer days than legs is a visible error on the days field, and it goes away with the leg', async ({ page }) => {
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('2');
    await f.add.click();
    await f.via.first().getByLabel('Stop 1', { exact: true }).fill(B);
    await f.roundTrip.click();
    await f.submit.click();
    await expect(f.errors.getByRole('link')).toHaveText([
      'This trip has 3 legs, so it needs at least 3 days: one per leg.',
    ]);
    await f.roundTrip.click();
    await expect(f.errors).toHaveCount(0);
    await f.submit.click();
    await expect(f.errors).toHaveCount(0);
  });
});

// ── Проміжні точки ────────────────────────────────────────────────────

test.describe('stops on the way', () => {
  withApi('🔴 add, fill, reorder with the buttons, remove — and the order on screen is the order of the legs sent', async ({ page }) => {
    const api = await stubApi(page);
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('9');
    await f.add.click();
    await f.add.click();
    await expect(f.via).toHaveCount(2);
    await f.via.nth(0).getByLabel('Stop 1', { exact: true }).fill(B);
    await f.via.nth(1).getByLabel('Stop 2', { exact: true }).fill('43.0, 17.0');

    // Кнопки: перша нікуди «вгору», остання нікуди «вниз».
    await expect(page.getByRole('button', { name: 'Move stop 1 up' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Move stop 2 down' })).toBeDisabled();
    await page.getByRole('button', { name: 'Move stop 1 down' }).click();
    await expect(f.via.nth(0).locator('input')).toHaveValue('43.0, 17.0');
    await expect(f.via.nth(1).locator('input')).toHaveValue(B);
    // Підписи йдуть за позицією, а не за тим, чия це точка.
    await expect(f.via.nth(0).getByLabel('Stop 1', { exact: true })).toHaveValue('43.0, 17.0');

    await f.submit.click();
    await expect(f.result).toContainText('Leg 3:');
    // Порядок перегонів у запитах — той самий, що на екрані: A → 43/17 → B → C.
    await expect.poll(() => api.plans.length).toBe(3);
    // Перегони йдуть паралельно, тож порядок ПРИХОДУ запитів нічого не значить;
    // значить набір пар: A → 43/17 → B → C, у порядку проміжних точок на екрані.
    const legs = api.plans.map((l) => `${l.from.lat}>${l.to.lat}`).sort();
    expect(legs).toEqual(['43>45', '45>44', '46>43']);
    expect(api.plans.reduce((s, l) => s + l.days, 0)).toBe(9);

    // Видалити: зникає саме названа, решта на місці.
    await page.getByRole('button', { name: 'Remove stop 1' }).click();
    await expect(f.via).toHaveCount(1);
    await expect(f.via.nth(0).locator('input')).toHaveValue(B);
    // І результат зник разом зі зміною форми.
    await expect(f.result).toContainText('Nothing asked yet');
  });

  test('🔴 drag-and-drop by the handle reorders, and the dragged stop takes its text with it', async ({ page }) => {
    // Події перетягування подаються самі (dragstart → dragover → drop з одним DataTransfer),
    // а не рухом миші: нативний drag-and-drop у Playwright надійний лише в Chromium, а те, що
    // ми перевіряємо, — наші обробники, і вони однакові в усіх браузерах.
    const f = await open(page);
    await f.add.click();
    await f.add.click();
    await f.via.nth(0).getByLabel('Stop 1', { exact: true }).fill(B);
    await f.via.nth(1).getByLabel('Stop 2', { exact: true }).fill('43.0, 17.0');
    const dt = await page.evaluateHandle(() => new DataTransfer());
    await f.via.nth(0).getByTestId('via-handle').dispatchEvent('dragstart', { dataTransfer: dt });
    await f.via.nth(1).dispatchEvent('dragover', { dataTransfer: dt });
    await f.via.nth(1).dispatchEvent('drop', { dataTransfer: dt });
    await expect(f.via.nth(0).locator('input')).toHaveValue('43.0, 17.0');
    await expect(f.via.nth(1).locator('input')).toHaveValue(B);
    // Скинути на себе — нічого не міняє.
    await f.via.nth(1).getByTestId('via-handle').dispatchEvent('dragstart', { dataTransfer: dt });
    await f.via.nth(1).dispatchEvent('drop', { dataTransfer: dt });
    await expect(f.via.nth(1).locator('input')).toHaveValue(B);
  });

  test('🔴 the add button stops at five and says why', async ({ page }) => {
    const f = await open(page);
    for (let i = 0; i < 5; i++) await f.add.click();
    await expect(f.via).toHaveCount(5);
    await expect(f.add).toBeDisabled();
    await expect(page.getByText('up to 5 stops between the start and the destination')).toBeVisible();
  });

  test('a stop that is neither a picked place nor numbers is an error on THAT stop, and the link goes to it', async ({ page }) => {
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('9');
    await f.add.click();
    await f.via.first().getByLabel('Stop 1', { exact: true }).fill('Nowhere');
    await f.submit.click();
    await expect(f.errors.getByRole('link')).toHaveCount(1);
    await f.errors.getByRole('link').click();
    await expect(f.via.first().getByLabel('Stop 1', { exact: true })).toBeFocused();
  });
});

// ── Зворотний шлях ────────────────────────────────────────────────────

test.describe('return to the start', () => {
  withApi('🔴 the checkbox adds a leg back: two requests, the second from the destination to the start, and the days shared', async ({ page }) => {
    const api = await stubApi(page);
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('14');
    await f.roundTrip.click();
    await f.submit.click();
    await expect(f.result).toContainText('Leg 2:');
    await expect.poll(() => api.plans.length).toBe(2);
    const there = api.plans.find((p) => p.from.lat === 46)!;
    const back = api.plans.find((p) => p.from.lat === 44)!;
    expect(there.to).toEqual({ lat: 44, lon: 16 });
    expect(back.to).toEqual({ lat: 46, lon: 14 });
    expect(there.days + back.days).toBe(14);
    // Дні наскрізні: від 1 до 14, а не двічі від 1 до 7 (відповідь — той самий знятий план).
    const said = await f.result.innerText();
    const days = [...said.matchAll(/\bDay (\d+)\b/g)].map((m) => Number(m[1]));
    expect(days.at(-1)).toBeGreaterThan(7);
    expect(days).toEqual([...days].sort((a, b) => a - b));
  });
});

// ── Габарити ──────────────────────────────────────────────────────────

test.describe('vehicle', () => {
  withApi('🔴 the numbers are checked, kept with the trip and never sent to the planner', async ({ page }) => {
    const api = await stubApi(page);
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('7');
    await page.getByLabel('Height, m').fill('9');
    await f.submit.click();
    await expect(f.errors.getByRole('link')).toHaveText(['Height must be between 1 and 4.5 metres.']);
    await page.getByLabel('Height, m').fill('3,1');
    await page.getByLabel('Length, m').fill('7.4');
    await page.getByLabel('Weight, t').fill('3.5');
    await page.getByLabel('Vehicle type').selectOption('motorhome');
    await f.submit.click();
    await expect(f.result).toContainText('Vehicle (not used by the planner)');
    await expect(f.result).toContainText('Motorhome, 3.1 m high, 7.4 m long, 3.5 t');
    expect(api.plans).toHaveLength(1);
    expect(Object.keys(api.plans[0]).sort()).toEqual(['days', 'from', 'to']);
  });
});

// ── Збереження в браузері ─────────────────────────────────────────────

test.describe('saving a trip in the browser', () => {
  const fillTrip = async (page: Page) => {
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('9');
    await f.add.click();
    await f.via.first().getByLabel('Stop 1', { exact: true }).fill(B);
    await f.roundTrip.click();
    await page.getByLabel('Height, m').fill('3.1');
    return f;
  };

  test('🔴 a saved trip survives a reload, and opening it brings back every field', async ({ page }) => {
    const f = await fillTrip(page);
    await f.saveName.fill('Alpine loop');
    await f.save.click();
    await expect(f.message).toContainText('Saved “Alpine loop” in this browser.');
    await expect(f.saved).toHaveCount(1);

    await page.reload();
    await expect(f.from).toBeEnabled();
    await expect(f.saved).toHaveCount(1);
    await expect(f.saved.first()).toContainText('Alpine loop');
    // Форма після перезавантаження порожня: збережене — у списку, а не підставлене мовчки.
    await expect(f.from).toHaveValue('');

    await page.getByRole('button', { name: 'Open Alpine loop' }).click();
    await expect(f.from).toHaveValue(A);
    await expect(f.to).toHaveValue(C);
    await expect(f.days).toHaveValue('9');
    await expect(f.via).toHaveCount(1);
    await expect(f.via.first().getByLabel('Stop 1', { exact: true })).toHaveValue(B);
    await expect(page.getByTestId('round-trip').locator('input')).toBeChecked();
    await expect(page.getByLabel('Height, m')).toHaveValue('3.1');
  });

  test('🔴 an empty name is not a reason to lose the trip: coordinates get a plain default', async ({ page }) => {
    const f = await fillTrip(page);
    await f.save.click();
    await expect(f.saved.first()).toContainText('My trip and back');
    await expect(f.message).toContainText('Saved “My trip and back” in this browser.');
  });

  test('🔴 nothing is written until the button is pressed, and deleting the last trip removes the key', async ({ page }) => {
    const f = await fillTrip(page);
    const key = () => page.evaluate(() => window.localStorage.getItem('camptribe.trips'));
    expect(await key()).toBeNull();
    await f.save.click();
    expect(await key()).not.toBeNull();
    await page.getByRole('button', { name: /^Delete / }).click();
    await expect(f.saved).toHaveCount(0);
    expect(await key()).toBeNull();
    await expect(page.getByTestId('saved-empty')).toBeVisible();
  });

  test('🔴 one corrupted record costs one record: the rest open, and the page says one could not be read', async ({ page }) => {
    const f = await fillTrip(page);
    await f.saveName.fill('First');
    await f.save.click();
    await f.saveName.fill('Second');
    await f.save.click();
    await expect(f.saved).toHaveCount(2);
    await page.evaluate(() => {
      const top = JSON.parse(window.localStorage.getItem('camptribe.trips')!);
      top.trips[0].draft.d = 7; // зіпсовано рівно один
      window.localStorage.setItem('camptribe.trips', JSON.stringify(top));
    });
    const bad = watchConsole(page);
    await page.reload();
    await expect(f.from).toBeEnabled();
    await expect(f.saved).toHaveCount(1);
    await expect(page.getByTestId('saved-dropped')).toContainText('One saved record in this browser could not be read');
    expect(bad).toEqual([]);
  });

  test('🔴 a storage that is not JSON does not break the page', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('camptribe.trips', '{not json'));
    const bad = watchConsole(page);
    const f = await open(page);
    await expect(f.saved).toHaveCount(0);
    await expect(page.getByTestId('saved-dropped')).toBeVisible();
    expect(bad).toEqual([]);
  });

  test('🔴 a browser that refuses to store says so instead of pretending', async ({ page }) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException('full', 'QuotaExceededError');
      };
    });
    const f = await fillTrip(page);
    await f.save.click();
    await expect(f.message).toContainText('would not let the page keep the trip');
    await expect(f.saved).toHaveCount(0);
  });

  test('🔴 a form with problems is not saved: the problems are shown instead', async ({ page }) => {
    const f = await open(page);
    await f.save.click();
    await expect(f.errors).toBeVisible();
    await expect(f.message).toContainText('Fix the problems listed above first.');
    expect(await page.evaluate(() => window.localStorage.getItem('camptribe.trips'))).toBeNull();
  });

  test('🔴 eleven trips do not fit: the eleventh is refused with the reason, the oldest is not dropped', async ({ page }) => {
    const f = await fillTrip(page);
    for (let i = 1; i <= 10; i++) {
      await f.saveName.fill(`Trip ${i}`);
      await f.save.click();
      await expect(f.saved).toHaveCount(i);
    }
    await f.saveName.fill('Trip 11');
    await f.save.click();
    await expect(f.message).toContainText('already holds 10 saved trips');
    await expect(f.saved).toHaveCount(10);
    await expect(f.saved.last()).toContainText('Trip 1');
  });
});

// ── Посилання «поділитися» ────────────────────────────────────────────

test.describe('the share link', () => {
  test('🔴 a link made in one browser rebuilds the plan in a clean one — and the server never sees the places', async ({ page, browser }) => {
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('9');
    await f.add.click();
    await f.via.first().getByLabel('Stop 1', { exact: true }).fill(B);
    await f.roundTrip.click();
    await page.getByLabel('Weight, t').fill('3.5');
    await page.getByLabel('Vehicle type').selectOption('campervan');
    await f.share.click();
    await expect(f.shareUrl).toBeVisible();
    const link = await f.shareUrl.inputValue();

    // Місця — у фрагменті, а не в запиті: ні «?», ні відкритого тексту.
    const url = new URL(link);
    expect(url.search).toBe('');
    expect(url.hash).toMatch(/^#t=[A-Za-z0-9_-]+$/);
    expect(link).not.toContain('46.0');

    // Чисте середовище: ні сховища, ні кукі.
    const clean = await browser.newContext();
    const other = await clean.newPage();
    const seen: string[] = [];
    other.on('request', (r) => seen.push(r.url()));
    const o = form(other);
    await other.goto(link);
    await expect(o.from).toBeEnabled();
    await expect(o.from).toHaveValue(A);
    await expect(o.to).toHaveValue(C);
    await expect(o.days).toHaveValue('9');
    await expect(o.via).toHaveCount(1);
    await expect(o.via.first().getByLabel('Stop 1', { exact: true })).toHaveValue(B);
    await expect(other.getByTestId('round-trip').locator('input')).toBeChecked();
    await expect(other.getByLabel('Weight, t')).toHaveValue('3.5');
    await expect(other.getByLabel('Vehicle type')).toHaveValue('campervan');
    await expect(o.notice).toContainText('Trip opened from a link.');
    // Жоден запит не несе ні фрагмента, ні відкритого тексту місць.
    expect(seen.filter((u) => u.includes('t=') && u.includes(url.pathname) && !u.includes('_next'))).toEqual([]);
    expect(seen.filter((u) => /46\.0|45\.0|44\.0/.test(u))).toEqual([]);
    await clean.close();
  });

  test('🔴 a link that is garbage opens an empty form with a notice, never a broken page', async ({ page }) => {
    const bad = watchConsole(page);
    for (const hash of ['#t=!!!', '#t=', '#x=1', `#t=${'A'.repeat(7000)}`, '#t=eyJ2IjoyfQ']) {
      await page.goto(`/plan${hash}`);
      const f = form(page);
      await expect(f.from).toBeEnabled();
      await expect(f.from).toHaveValue('');
      await expect(f.notice).toContainText('This link could not be read');
    }
    expect(bad).toEqual([]);
  });
});

// ── Route to here: `/plan?to=<slug>` ──────────────────────────────────

test.describe('/plan?to=<slug>', () => {
  withApi('🔴 puts the campsite in the destination, by its name and country, and says so', async ({ page }) => {
    const api = await stubApi(page, { campsite: () => captured('places-campsite-ok') });
    const f = await open(page, '/plan?to=city-camping-antwerp');
    await expect(f.to).toHaveValue('City Camping Antwerp (campsite), Belgium');
    await expect(f.notice).toContainText('Destination set to City Camping Antwerp.');
    // У dev React запускає ефект двічі (StrictMode), у збірці — раз; важить, що питали саме про цей slug.
    expect([...new Set(api.campsites)]).toEqual(['city-camping-antwerp']);
    // Старт порожній: фініш підставлено, решту людина обирає сама.
    await expect(f.from).toHaveValue('');
    // І це справжній вибір: форма приймає його як місце, а не як текст.
    await f.from.fill(A);
    await f.days.fill('3');
    await f.submit.click();
    await expect(f.errors).toHaveCount(0);
  });

  withApi('🔴 an unknown campsite is a notice, not a crash, and the destination stays empty', async ({ page }) => {
    await stubApi(page, { campsite: () => captured('places-campsite-unknown') });
    const bad = watchConsole(page);
    const f = await open(page, '/plan?to=no-such-camp');
    await expect(f.notice).toContainText('We could not find the campsite named in this link.');
    await expect(f.to).toHaveValue('');
    expect(bad.filter((m) => !/404/.test(m))).toEqual([]);
  });

  withApi('🔴 the parameter is untrusted: markup, a path, a huge string, an empty one — the form opens every time and nothing is asked for what is not a slug', async ({ page }) => {
    const api = await stubApi(page, { campsite: () => captured('places-campsite-unknown') });
    const bad = watchConsole(page);
    for (const to of ['', '<script>alert(1)</script>', '../../etc/passwd', 'UPPER', 'x'.repeat(5000), '%00', 'a b']) {
      await page.goto(`/plan?to=${encodeURIComponent(to)}`);
      await expect(form(page).from).toBeEnabled();
      await expect(form(page).to).toHaveValue('');
    }
    expect(api.campsites, 'на сервер пішло те, що не схоже на slug').toEqual([]);
    expect(bad).toEqual([]);
    // Розмітка з параметра не потрапляє на сторінку як розмітка.
    await page.goto(`/plan?to=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  });

  withoutApi('🔴 a build with no API address says the lookup is unavailable and the form still opens', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    const f = await open(page, '/plan?to=city-camping-antwerp');
    await expect(f.notice).toContainText('could not be looked up right now');
    await expect(f.to).toHaveValue('');
    expect(requests.filter((u) => u.includes('/places/'))).toEqual([]);
  });
});

// ── Підказки місць ────────────────────────────────────────────────────

test.describe('place suggestions', () => {
  withApi('🔴 three letters give a non-empty list, every row has a kind and a country, and a pick fills the field', async ({ page }) => {
    const api = await stubApi(page, { suggest: () => captured('places-suggest-antw') });
    const f = await open(page);

    // Дві літери — запиту немає.
    await f.from.fill('an');
    await page.waitForTimeout(500);
    expect(api.suggests).toEqual([]);

    await f.from.fill('ant');
    await expect(f.options.first()).toBeVisible();
    const rows = await f.options.allInnerTexts();
    expect(rows.length).toBeGreaterThan(1);
    for (const r of rows) {
      const [name, where] = r.split('\n');
      expect(name.trim().length, r).toBeGreaterThan(0);
      // «city, Belgium», «campsite, Belgium»: вид і країна словами.
      expect(where, r).toMatch(/^(city|town|village|region|campsite), [A-Z][A-Za-z ]+$/);
    }
    expect(rows.join('|')).toContain('Antwerpen');
    expect(rows.join('|')).toMatch(/region, Belgium/);
    expect(rows.join('|')).toMatch(/campsite, Belgium/);

    // 🔴 Запит — POST із тілом; набраний текст НЕ в адресі.
    expect(api.suggests[0].body).toEqual({ q: 'ant' });
    expect(api.suggests[0].url.endsWith('/places/suggest')).toBe(true);

    await f.options.filter({ hasText: 'Antwerpen' }).first().click();
    await expect(f.from).toHaveValue('Antwerpen, Belgium');
    await expect(f.options).toHaveCount(0);
  });

  withApi('🔴 a picked place travels as its coordinates: the planner gets the numbers of the row, not the words', async ({ page }) => {
    const api = await stubApi(page, {
      suggest: (q) => (q.startsWith('ble') ? captured('places-suggest-bled') : captured('places-suggest-antw')),
    });
    const f = await open(page);
    await f.from.fill('antw');
    await f.options.filter({ hasText: 'Antwerpen' }).first().click();
    await f.to.fill('bled');
    await f.options.first().click();
    await f.days.fill('5');
    await f.submit.click();
    await expect.poll(() => api.plans.length).toBe(1);
    const antwerpen = (captured('places-suggest-antw').body as { items: Array<{ name: string; lat: number; lon: number }> }).items.find((i) => i.name === 'Antwerpen')!;
    const bled = (captured('places-suggest-bled').body as { items: Array<{ lat: number; lon: number }> }).items[0];
    expect(api.plans[0].from).toEqual({ lat: antwerpen.lat, lon: antwerpen.lon });
    expect(api.plans[0].to).toEqual({ lat: bled.lat, lon: bled.lon });
  });

  withApi('🔴 the keyboard works: arrows move, Enter picks and does not send the form, Escape closes', async ({ page }) => {
    const api = await stubApi(page, { suggest: () => captured('places-suggest-antw') });
    const f = await open(page);
    await f.from.fill('antw');
    await expect(f.options.first()).toBeVisible();
    await expect(f.from).toHaveAttribute('aria-expanded', 'true');
    await f.from.press('ArrowDown');
    await expect(f.options.first()).toHaveAttribute('aria-selected', 'true');
    const active = await f.from.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    await expect(page.locator(`#${active}`)).toHaveAttribute('role', 'option');
    await f.from.press('ArrowDown');
    await expect(f.options.nth(1)).toHaveAttribute('aria-selected', 'true');
    await f.from.press('ArrowUp');
    await f.from.press('Enter');
    await expect(f.from).toHaveValue('Antwerpen, Belgium');
    // Enter вибрав, а не відправив форму: підсумку помилок немає, а результату теж.
    await expect(f.errors).toHaveCount(0);
    await expect(f.result).toContainText('Nothing asked yet');
    expect(api.plans).toEqual([]);

    await f.to.fill('antw');
    await expect(f.options.first()).toBeVisible();
    await f.to.press('Escape');
    await expect(f.options).toHaveCount(0);
    await expect(f.to).toHaveValue('antw');
  });

  withApi('🔴 nothing found, and the search not answering, are said in different words', async ({ page }) => {
    let mode: 'none' | 'abort' = 'none';
    await stubApi(page, {
      suggest: () => (mode === 'none' ? captured('places-suggest-none') : 'abort'),
    });
    const f = await open(page);
    await f.from.fill('xqzv');
    const fromStatus = f.from.locator('xpath=ancestor::div[1]').getByTestId('place-status');
    await expect(fromStatus).toContainText('Nothing in our data starts like that.');
    await expect(fromStatus).toContainText('München, not Munich');
    mode = 'abort';
    await f.from.fill('xqzw');
    await expect(fromStatus).toContainText('The place search did not answer.');
    await expect(fromStatus).not.toContainText('Nothing in our data');
  });

  withApi('🔴 a late answer to an earlier word never replaces the list for the word now in the field', async ({ page }) => {
    await stubApi(page, {
      suggest: async (q) => {
        if (q === 'ant') {
          await new Promise((r) => setTimeout(r, 1500));
          return captured('places-suggest-antw');
        }
        return captured('places-suggest-bled');
      },
    });
    const f = await open(page);
    await f.from.fill('ant');
    await page.waitForTimeout(400); // запит «ant» уже пішов і чекає
    await f.from.fill('bled');
    await expect(f.options.first()).toContainText('Bled');
    await page.waitForTimeout(1800); // «ant» відповів пізніше
    await expect(f.options.first()).toContainText('Bled');
    await expect(f.options.filter({ hasText: 'Antwerpen' })).toHaveCount(0);
  });

  withApi('🔴 coordinates are never sent as a search: a pair of numbers asks nobody', async ({ page }) => {
    const api = await stubApi(page, { suggest: () => captured('places-suggest-antw') });
    const f = await open(page);
    await f.from.fill('46.0569, 14.5058');
    await page.waitForTimeout(600);
    expect(api.suggests).toEqual([]);
  });

  withoutApi('🔴 a build with no API address says the search is unavailable, sends nothing, and coordinates still work', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => requests.push(`${r.method()} ${r.url()}`));
    const f = await open(page);
    await f.from.fill('antwerp');
    await expect(f.status).toContainText('Place search is not available here. Write latitude and longitude instead.');
    expect(requests.filter((r) => r.includes('/places/'))).toEqual([]);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('3');
    await f.submit.click();
    await expect(f.errors).toHaveCount(0);
  });
});

// ── Селект за темою ───────────────────────────────────────────────────

test.describe('the select follows the theme', () => {
  test('🔴 40px of room on the right, its own chevron inside the box, the system arrow gone', async ({ page }) => {
    const f = await open(page);
    await expect(f.from).toBeVisible();
    const select = page.locator('#plan-vehicle-type');
    const style = await select.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        padEnd: s.paddingRight,
        appearance: s.appearance,
        minHeight: parseFloat(s.minHeight),
        height: el.getBoundingClientRect().height,
      };
    });
    expect(style.padEnd).toBe('40px');
    expect(style.appearance).toBe('none');
    expect(style.height).toBeGreaterThanOrEqual(56);

    const box = (await select.boundingBox())!;
    const chevron = (await page.getByTestId('select-chevron').boundingBox())!;
    // Шеврон у правій половині поля, не торкається краю (відступ ≥ 12px) і не лізе під текст.
    expect(chevron.x).toBeGreaterThan(box.x + box.width / 2);
    expect(box.x + box.width - (chevron.x + chevron.width)).toBeGreaterThanOrEqual(12);
    // Найдовший варіант не заходить під шеврон: поле має запас, а не лише відступ.
    await select.selectOption('caravan');
    const scroll = await select.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(scroll.sw).toBeLessThanOrEqual(scroll.cw);
  });
});

// ── Розкладка ─────────────────────────────────────────────────────────

test.describe('layout', () => {
  withApi('🔴 on a wide screen the form stays in view while the route scrolls; on a phone it does not stick', async ({ page }) => {
    await stubApi(page);
    const f = await open(page);
    await f.from.fill(A);
    await f.to.fill(C);
    await f.days.fill('14');
    await f.roundTrip.click();
    await f.submit.click();
    await expect(f.result).toContainText('Leg 2:');
    const sticky = page.getByTestId('plan-sticky');
    const wide = (page.viewportSize()?.width ?? 0) >= 1024;
    const before = (await sticky.boundingBox())!;
    // Коліщатко — над результатом: над липкою формою воно спершу прокручує її саму.
    await f.result.hover();
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(800);
    if (wide) {
      await expect(sticky).toBeInViewport({ ratio: 0.3 });
      const after = (await sticky.boundingBox())!;
      expect(after.y).toBeLessThan(200);
      expect(after.y).toBeGreaterThanOrEqual(0);
      // Липка колонка сама прокручується, коли форма вища за вікно.
      expect(before.height).toBeGreaterThan(0);
    } else {
      await expect(sticky).not.toBeInViewport();
    }
  });

  test('🔴 no sideways scrolling at the phone width with stops, a long name and errors on screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const f = await open(page);
    await f.from.fill('W'.repeat(150));
    await f.add.click();
    await f.via.first().getByLabel('Stop 1', { exact: true }).fill('V'.repeat(150));
    await f.submit.click();
    await expect(f.errors).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over).toBeLessThanOrEqual(0);
  });
});

// ── Консоль ───────────────────────────────────────────────────────────

withApi('🔴 the console stays clean through a whole trip: stops, a return leg, a save, a share', async ({ page }) => {
  await stubApi(page, { suggest: () => captured('places-suggest-antw') });
  const bad = watchConsole(page);
  const f = await open(page);
  await f.from.fill('antw');
  await f.options.first().click();
  await f.to.fill(C);
  await f.days.fill('9');
  await f.add.click();
  await f.via.first().getByLabel('Stop 1', { exact: true }).fill(B);
  await f.roundTrip.click();
  await f.submit.click();
  await expect(f.result).toContainText('Leg 3:');
  await f.save.click();
  await f.share.click();
  await expect(f.shareUrl).toBeVisible();
  expect(bad).toEqual([]);
});

// ── Доступність нових станів ──────────────────────────────────────────

test.describe('accessibility of the new states (any build)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`🔴 no violations in ${scheme} mode: stops, errors on a stop, a saved trip, a share link`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      const f = await open(page);
      await f.add.click();
      await f.add.click();
      await page.getByLabel('Height, m').fill('9');
      await f.submit.click();
      await expect(f.errors).toBeVisible();
      expect(await axeViolations(page), 'stops with errors').toEqual([]);

      await f.from.fill(A);
      await f.to.fill(C);
      await f.days.fill('9');
      await f.via.nth(0).getByLabel('Stop 1', { exact: true }).fill(B);
      await f.via.nth(1).getByLabel('Stop 2', { exact: true }).fill('43.0, 17.0');
      await page.getByLabel('Height, m').fill('3.1');
      await f.saveName.fill('Loop');
      await f.save.click();
      await expect(f.saved).toHaveCount(1);
      await f.share.click();
      await expect(f.shareUrl).toBeVisible();
      expect(await axeViolations(page), 'saved trip and share link').toEqual([]);
    });
  }

  withApi('🔴 no violations with the suggestion list open and with "nothing found" said', async ({ page }) => {
    await stubApi(page, { suggest: (q) => (q === 'xqzv' ? captured('places-suggest-none') : captured('places-suggest-antw')) });
    const f = await open(page);
    await f.from.fill('antw');
    await expect(f.options.first()).toBeVisible();
    expect(await axeViolations(page), 'list open').toEqual([]);
    await f.to.fill('xqzv');
    await expect(f.to.locator('xpath=ancestor::div[1]').getByTestId('place-status')).toContainText('Nothing in our data');
    expect(await axeViolations(page), 'nothing found').toEqual([]);
  });
});
