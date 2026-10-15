import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './api-request';
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
// прочитала адресу й вирішила, який стан показати. Для /verify-email це
// «перевіряємо», а не «підтвердіть»: заголовок вкладки (<title>) каже інше, і
// саме тому читається <h1>, а не весь текст — інакше title пройшов би за h1.
const PAGES = [
  { path: '/signup', heading: 'Create an account' },
  { path: '/login', heading: 'Sign in' },
  { path: '/forgot-password', heading: 'Reset your password' },
  { path: '/reset-password', heading: 'Choose a new password' },
  { path: '/verify-email', heading: 'Checking your link' },
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
  for (const { path } of PAGES) {
    test(`${path}: у виданому HTML є хлібні крихти JSON-LD, що ведуть сюди`, async ({ request }) => {
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
      'By creating an account you accept the Terms and the Privacy Policy.',
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
