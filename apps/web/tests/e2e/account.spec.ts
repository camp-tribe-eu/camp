import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './api-request';
import { EMPTY_STATES } from '@/components/account-cabinet-view';
import { RETURN_KEY } from '@/lib/return-path';
import { visibleText } from '../unit/rendered-text';

// CAMP-228 — сторінки акаунта, як їх зустрічає читач, з ВИДАНОГО документа.
//
// 🔴 Усе, що тут сказано про галочки й Умови, читається з HTML, який
// віддає сервер ДО виконання бандла (`request`, без браузера): галочка
// розсилки порожня, Умови — рядок із лінками, а не поле. `data-testid`,
// клас і `sr-only` нічого не доводять, тому тут їх нема.
//
// Те, що розмітка без браузера не показує, — розмова з API й стани після
// відповіді — перевірено руками в браузері й записано в описі PR: збірка
// CI не має `NEXT_PUBLIC_API_BASE_URL`, тож форми там чесно кажуть
// «акаунти недоступні», і тест із вигаданим API перевіряв би не нашу
// збірку.

// `heading` — що стоїть в <h1> ВИДАНОГО документа, тобто до того, як сторінка
// прочитала адресу й вирішила, який стан показати. Читається саме <h1>, а не
// весь текст: заголовок вкладки (<title>) інакше пройшов би за h1. Хлібна
// крихта мусить дорівнювати цьому рядку (див. нижче).
const PAGES = [
  { path: '/signup', heading: 'Create an account' },
  { path: '/login', heading: 'Sign in' },
  { path: '/forgot-password', heading: 'Reset your password' },
  { path: '/reset-password', heading: 'Choose a new password' },
  { path: '/verify-email', heading: 'Confirm your email' },
] as const;

test.describe('кожна сторінка', () => {
  for (const { path, heading } of PAGES) {
    test(`${path}: 200, noindex у виданому HTML, і один <h1> з потрібним текстом`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/<meta name="robots"[^>]*content="[^"]*noindex[^"]*nofollow/i);
      const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => visibleText(m[1]));
      expect(h1).toEqual([heading]);
    });
  }

  // 🔴 Знайдено CI, а не мною: `check-structured-data` вимагає JSON-LD від
  // КОЖНОЇ зібраної сторінки, крім сторінок помилок, а мої п'ять його не мали.
  // Скрипт читає збірку, якої локально не зібрати (65 тис. сторінок), тож
  // тут те саме правило, але на виданому HTML цих п'яти.
  for (const { path, heading } of PAGES) {
    test(`${path}: у виданому HTML є хлібні крихти JSON-LD, що ведуть сюди й називаються як <h1>`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
        (m) => JSON.parse(m[1]),
      );
      const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
      expect(crumbs, 'немає BreadcrumbList').toBeDefined();
      const items = crumbs.itemListElement as { position: number; name: string; item: string }[];
      expect(items.map((i) => i.position)).toEqual([1, 2]);
      expect(items[0].name).toBe('CampTribe');
      expect(new URL(items[1].item).pathname).toBe(path);
      // Не лише шлях: і ІМ'Я. Те, що стоїть у крихті, — те, що стоїть у <h1>.
      const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => visibleText(m[1]));
      expect(items[1].name).toBe(heading);
      expect(h1).toEqual([items[1].name]);
    });
  }

  for (const path of ['/reset-password', '/verify-email']) {
    test(`${path}: токен у адресі не йде далі в Referer`, async ({ request }) => {
      const html = await (await request.get(`${path}?t=anything`)).text();
      expect(html).toMatch(/<meta name="referrer" content="no-referrer"/i);
    });
  }
});

test.describe('🔴 /signup: що сказано у виданому документі', () => {
  test('рівно один checkbox, і він не поставлений (Planet49, C-673/17)', async ({ request }) => {
    const html = await (await request.get('/signup')).text();
    const boxes = [...html.matchAll(/<input\b[^>]*>/g)]
      .map((m) => m[0])
      .filter((tag) => /\btype="checkbox"/.test(tag));
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatch(/\bname="newsletter"/);
    expect(boxes[0]).not.toMatch(/\bchecked\b/);
  });

  test('Умови — рядок тексту з лінками на сторінки, що існують', async ({ request }) => {
    const html = await (await request.get('/signup')).text();
    expect(visibleText(html)).toContain(
      'By creating an account you confirm that you are eighteen or older, and you accept the Terms and the Privacy Policy.',
    );
    for (const href of ['/legal/terms', '/legal/privacy']) {
      expect(html).toContain(`href="${href}"`);
      expect((await request.get(href)).status(), href).toBe(200);
    }
  });
});

test.describe('доступність і консоль', () => {
  for (const { path } of PAGES) {
    test(`${path}: axe WCAG AA без порушень, консоль без помилок`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(path);
      // Поля вимкнені, поки сторінка не ожила; чекаємо, а не вгадуємо.
      // 🔴 Без `.catch`: сторінка, що так і не ожила, — це провал, а не
      // привід перевірити axe на мертвій формі.
      await page.waitForFunction(() => !document.querySelector('input:disabled'), null, {
        timeout: 15_000,
      });
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});

// ── CAMP-229: /account ───────────────────────────────────────────────────
//
// 🔴 Що ТУТ можна довести, а що ні. Збірка CI не має `NEXT_PUBLIC_API_BASE_URL`,
// тож кабінет там не може спитати сервер, хто це, і справжній кабінет (профіль,
// три порожні картки) побачити в CI неможливо. Це не прогалина тесту, а факт
// збірки: розмітку кабінету читає `tests/unit/account-cabinet.spec.tsx` на
// ВИДАНОМУ HTML, розмову з API — `tests/unit/cabinet.spec.ts`, а повний шлях
// у браузері з живим API (вхід, повернення, консоль, 375 і 1024 px, axe) прогнано
// руками й записано в описі PR.
//
// Те, що без API довести МОЖНА, і що тут доведено: виданий документ, і те, що
// людину без сесії дійсно відправляють на /login, запам'ятавши, звідки.

test.describe('🔴 /account: виданий документ', () => {
  test('200, noindex+nofollow у HTML, один <h1>, і ЖОДНОГО кабінету до того, як сервер назвав людину', async ({
    request,
  }) => {
    const res = await request.get('/account');
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<meta name="robots"[^>]*content="[^"]*noindex[^"]*nofollow/i);
    const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => visibleText(m[1]));
    expect(h1).toEqual(['Your account']);
    // Що бачить кожен, кому JS не виконався: заголовок і «перевіряємо», не профіль
    // і не порожній кабінет, що вдає, ніби людина ввійшла.
    const text = visibleText(html);
    expect(text).toContain('Checking your sign-in…');
    for (const s of EMPTY_STATES) expect(text, s.title).not.toContain(s.title);
  });

  test('хлібні крихти JSON-LD ведуть сюди й називаються як <h1>', async ({ request }) => {
    const html = await (await request.get('/account')).text();
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (m) => JSON.parse(m[1]),
    );
    const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
    expect(crumbs, 'немає BreadcrumbList').toBeDefined();
    const items = crumbs.itemListElement as { position: number; name: string; item: string }[];
    expect(new URL(items[1].item).pathname).toBe('/account');
    expect(items[1].name).toBe('Your account');
  });
});

test.describe('🔴 /account: не ввійшов — на /login, і сторінка запам\'ятовує, звідки', () => {
  test('людина без сесії потрапляє на /login, а в сховищі вкладки лежить рівно `/account`', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/account');
    await page.waitForURL('**/login');
    expect(new URL(page.url()).pathname).toBe('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');

    const stored = await page.evaluate((key) => window.sessionStorage.getItem(key), RETURN_KEY);
    expect(stored, 'місце повернення записано').not.toBeNull();
    expect(JSON.parse(stored!).path).toBe('/account');
    expect(errors).toEqual([]);
  });

  test('запит у адресі, що годиться (?tab=photos), переживає перехід на /login', async ({
    page,
  }) => {
    await page.goto('/account?tab=photos');
    await page.waitForURL('**/login');
    const kept = await page.evaluate((key) => window.sessionStorage.getItem(key), RETURN_KEY);
    expect(JSON.parse(kept!).path).toBe('/account?tab=photos');
  });

  test('🔴 запит, що не годиться як місце повернення, не записується взагалі', async ({ page }) => {
    // `//evil.com` у запиті: сторінка за логіном не вибирає, що з адреси брати, а
    // кладе в сховище все або нічого. «Нічого» означає, що після входу людина піде
    // на типове місце, а не туди, куди показує лист.
    await page.goto('/account?next=//evil.com');
    await page.waitForURL('**/login');
    const kept = await page.evaluate((key) => window.sessionStorage.getItem(key), RETURN_KEY);
    expect(kept).toBeNull();
  });
});

// ── CAMP-229 (3/3): /account/data і /account/delete ──────────────────────
//
// 🔴 Той самий поділ, що вище: розмітку екранів (варіанти долі фото, і що жоден не
// позначений; текст «що лишиться» з назвою підстави) читають `tests/unit/account-delete.spec.tsx`
// та `account-data.spec.tsx` на ВИДАНОМУ HTML компонентів; розмову з API — `rights.spec.ts`
// і `account-rights.db.spec.ts`; повний шлях у браузері з живим API (вхід, архів, видалення,
// повернення входом, консоль, 375 і 1024 px, axe) прогнано руками й записано в описі PR.
// Тут — виданий документ і те, що людину без сесії відправляють на /login.

const RIGHTS_PAGES = [
  { path: '/account/data', heading: 'Your data' },
  { path: '/account/delete', heading: 'Delete your account' },
] as const;

test.describe('🔴 /account/data і /account/delete: виданий документ', () => {
  for (const { path, heading } of RIGHTS_PAGES) {
    test(`${path}: 200, noindex+nofollow, один <h1>, і ні варіантів, ні кнопок видалення до того, як сервер назвав людину`, async ({
      request,
    }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/<meta name="robots"[^>]*content="[^"]*noindex[^"]*nofollow/i);
      const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => visibleText(m[1]));
      expect(h1).toEqual([heading]);
      // Що бачить кожен, кому JS не виконався: заголовок і «перевіряємо» — і нічого з того,
      // що належить людині. Парна половина: «перевіряємо» справді є, тож порожнеча нижче —
      // не від того, що сторінка не відрендерилась.
      const text = visibleText(html);
      expect(text).toContain('Checking your sign-in…');
      expect(html).not.toMatch(/type="radio"/);
      expect(html).not.toMatch(/type="password"/);
      expect(text).not.toContain('Delete account');
      expect(text).not.toContain('Prepare my archive');
    });

    test(`${path}: хлібні крихти JSON-LD ведуть сюди й називаються як <h1>`, async ({ request }) => {
      const html = await (await request.get(path)).text();
      const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
        (m) => JSON.parse(m[1]),
      );
      const crumbs = blocks.find((b) => b['@type'] === 'BreadcrumbList');
      expect(crumbs, 'немає BreadcrumbList').toBeDefined();
      const items = crumbs.itemListElement as { position: number; name: string; item: string }[];
      expect(new URL(items[1].item).pathname).toBe(path);
      expect(items[1].name).toBe(heading);
    });

    test(`${path}: людина без сесії потрапляє на /login, і в сховищі вкладки лежить рівно ${path}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(path);
      await page.waitForURL('**/login');
      expect(new URL(page.url()).pathname).toBe('/login');
      const stored = await page.evaluate((key) => window.sessionStorage.getItem(key), RETURN_KEY);
      expect(stored, 'місце повернення записано').not.toBeNull();
      expect(JSON.parse(stored!).path).toBe(path);
      expect(errors).toEqual([]);
    });
  }

  // Карту сайту читає unit-тест кабінету (`STATIC_HUBS`); тут — robots.txt, як його віддає
  // сервер: ні, шляху в `Disallow` немає, бо тоді робот не прочитав би й `noindex`.
  test('robots.txt їх не закриває, і сам файл справжній', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    // Парна половина: файл має правила, тож відсутність цих шляхів щось означає.
    expect(robots).toMatch(/^Disallow:/mi);
    for (const { path } of RIGHTS_PAGES) {
      expect(robots, path).not.toMatch(new RegExp(`^Disallow:\\s*${path}`, 'mi'));
    }
  });
});
