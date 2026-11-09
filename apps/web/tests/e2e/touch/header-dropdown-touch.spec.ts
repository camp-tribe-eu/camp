/**
 * 🔴 CAMP-468 — розкривач у шапці на ПРИСТРОЇ З ДОТИКОМ, ширина ≥1200px.
 *
 * ⚠️ ДЕФЕКТУ, ЗАРАДИ ЯКОГО ЗАВОДИЛАСЬ КАРТКА, НЕМАЄ. Картка стверджувала,
 * що тап дає емульований `mouseenter` (відкрити) і `click` (закрити)
 * підряд, тож меню блимає. Заміряно 09.11.2026 на Chromium і WebKit,
 * ширина 1280, `hasTouch` — один тап відкриває панель, і вона лишається
 * відкритою. Твердження картки було прочитане з коду, а не зміряне.
 *
 * 🔴 АЛЕ ПОСЛІДОВНІСТЬ ПОДІЙ САМЕ ТАКА, ЯК ОПИСАНО, і це важливо:
 *
 *   pointerover(touch) → pointerdown → pointerup → pointerleave
 *   → mouseover → mouseenter → mousedown → mouseup → click
 *
 * Сумісні мишачі події приходять ПІСЛЯ дотику, одним пакетом із кліком,
 * і `onMouseEnter` у цьому пакеті вже викликав `setOpen(true)`. Працює
 * воно лише тому, що обробник кліку читає `open` із замикання —
 * значення з попереднього малювання, тобто ще `false`. Одна правка
 * «спростити» його на `setOpen((o) => !o)` — і панель закривається тим
 * самим тапом, що її відкрив.
 *
 * Доведено мутацією в обох рушіях: із функцією оновлення цей тест
 * червоніє («Received: "false"»), без неї — зелений. Тому тест лишається
 * не як підтвердження правки, а як кілок у землі.
 *
 * 🔴 ЧОМУ ЦЬОГО НЕ ПЕРЕВІРЯВ ЖОДЕН НАЯВНИЙ ПРОЄКТ. `chromium-desktop` і
 * `firefox-desktop` — без дотику; `mobile-chrome` (Pixel 7, 412 px)
 * вужчий за 1200 і бачить бургер, де розкривача немає взагалі. Потрібна
 * саме КОМБІНАЦІЯ: дотик і широкий екран.
 *
 * 🔴 ПОРІГ 1200 НЕ ВИГАДАНИЙ ТУТ. Нижче нього тема показує бургер
 * (`max-width:1199.98px` у її CSS), і наша шапка повторює цей поріг.
 * Ширина проєкту `tablet-touch` у playwright.config.ts узята з того ж
 * числа; якщо поріг колись переїде, переїде й вона — не окремо.
 *
 * 🔴 ЦЕЙ ФАЙЛ БІЖИТЬ ЛИШЕ В ОДНОМУ ПРОЄКТІ, і це навмисно. 11.10.2026
 * власник прибрав `tablet` і `mobile-safari` саме тому, що вони вшосте
 * проганяли ті самі десктопні твердження в іншому user-agent. Проєкт
 * `tablet-touch` звужений `testDir` рівно до цієї теки: нова комбінація
 * коштує стільки, скільки коштують її власні тести.
 */
import { expect, test, type APIRequestContext } from '../api-request';

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

interface NavItem {
  href: string;
  label: string;
  children: NavItem[];
}

async function parentWithChildren(request: APIRequestContext): Promise<NavItem> {
  const res = await request.get(`${API}/navigation`);
  expect(res.ok(), `GET ${API}/navigation → ${res.status()}`).toBe(true);
  const body = (await res.json()) as { header?: NavItem[] };
  const parent = (body.header ?? []).find((i) => i.children.length > 0);
  expect(
    parent,
    'у базі немає жодного пункту шапки з дітьми — міграція NavigationChildren не накотилась?',
  ).toBeTruthy();
  return parent!;
}

test('🔴 дотик на широкому екрані: тап ВІДКРИВАЄ панель і вона лишається відкритою', async ({
  page,
  request,
}) => {
  const parent = await parentWithChildren(request);
  await page.goto('/');

  const li = page.locator(
    `header nav[aria-label="Main"] [data-nav-parent="${parent.href}"]`,
  );
  const toggle = li.locator('button[aria-expanded]');
  const panel = li.locator('[data-nav-sub]');

  // Сам факт, що розкривач тут є, а не бургер: нижче 1200 кнопки немає.
  await expect(toggle, 'на ≥1200px розкривач мусить бути в шапці').toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();

  // 🔴 ЧЕКАЄМО ГІДРАЦІЮ, А НЕ ПОВТОРЮЄМО ТАП. Перша редакція цього тесту
  // обгортала тап у `toPass`, як це робить `header-nav.ts` для бургера. Там
  // повтор доречний: він лікує клік, що прилетів до гідрації. ТУТ він
  // сліпить тест рівно на тому дефекті, заради якого той написаний —
  // «перший тап не спрацював, другий спрацював» і є симптомом CAMP-468,
  // а `toPass` зарахував би це як успіх.
  //
  // Тому гідрація чекається прямо: React 18/19 вішає на вузол свої
  // внутрішні ключі (`__reactFiber$…`, `__reactProps$…`) саме тоді, коли
  // обробники почали працювати. Після цього — РІВНО ОДИН тап.
  await page.waitForFunction(() => {
    const el = document.querySelector(
      'header nav[aria-label="Main"] button[aria-expanded]',
    );
    return (
      !!el &&
      Object.keys(el).some(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactProps$'),
      )
    );
  }, null, { timeout: 15_000 });

  // 🔴 `tap()`, а не `click()`. Клік Playwright шле мишу; саме дотик дає
  // ту пару подій (емульоване наведення + клік), через яку все блимало.
  await toggle.tap();
  await expect(
    toggle,
    'ОДИН тап мусить відкрити розкривач — два це і є дефект CAMP-468',
  ).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });

  await expect(panel, 'панель мусить лишитись відкритою після тапу').toBeVisible();

  // Панель не просто «видима» — у ній справді стоять підпункти.
  for (const child of parent.children) {
    await expect(
      panel.getByRole('link', { name: child.label, exact: true }),
    ).toHaveAttribute('href', child.href);
  }

  // І другий тап закриває — інакше «відкрито» було б станом без виходу.
  await toggle.tap();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
});
