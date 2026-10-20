import { expect, test } from '@playwright/test';

// CAMP-365 — меню переїхало з коду в базу, і цей файл повертає те, що
// ми переїздом втратили.
//
// 🔴 ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ, І ЧОМУ ВІН НЕ «ПРО ВСЯК ВИПАДОК».
//
// Доки меню жило списком у `site-chrome.tsx`, мертве посилання було
// НЕМОЖЛИВЕ. Поруч навіть стояв коментар: закоментовані пункти
// (`/routes`, `/rentals`) додаються «коли кожен поїде, не раніше». Щоб
// додати пункт, треба було змінити файл, а файл читає рецензія і CI.
//
// База цієї властивості не має. Власник може вписати пункт на
// сторінку, якої ще немає, — і нічого не впаде: сайт просто віддасть
// 404 з головного меню, мовчки, усім читачам одразу.
//
// Тобто без цього файла переїзд був би обміном «власник не може
// редагувати» на «власник може зламати». Саме тому тут перевіряється
// КОЖЕН пункт із бази, а не вибірка й не ті шість, що я переніс
// міграцією: наступний додасть власник, і його ніхто не рецензує.

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';

interface NavItem {
  href: string;
  label: string;
  children: NavItem[];
}

/** Усі пункти всіх розташувань, у глибину. */
function flatten(items: NavItem[], out: NavItem[] = []): NavItem[] {
  for (const i of items) {
    out.push(i);
    flatten(i.children, out);
  }
  return out;
}

test.describe('🔴 CAMP-365 — меню з бази', () => {
  test('кожен пункт меню веде на сторінку, яка відкривається', async ({
    page,
    request,
  }) => {
    const res = await request.get(`${API}/navigation`);
    expect(
      res.status(),
      `API меню відмовив: ${res.status()} ${res.statusText()}`,
    ).toBe(200);

    const body = (await res.json()) as Record<string, NavItem[]>;
    const all = flatten([
      ...(body.header ?? []),
      ...(body.footer ?? []),
      ...(body.mobile ?? []),
    ]);

    // 🔴 ПОРОЖНЄ МЕНЮ ЗАДОВОЛЬНИЛО Б УСІ ПЕРЕВІРКИ НИЖЧЕ.
    //
    // «Жоден пункт не веде в нікуди» істинне й тоді, коли пунктів
    // немає зовсім. А меню, що зникло, це поломка, яку читач помітить
    // раніше за нас. Тож спершу стверджуємо, що воно є.
    expect(
      all.length,
      'меню порожнє — або база не наповнена, або запит бере не те',
    ).toBeGreaterThan(0);

    for (const item of all) {
      expect(
        item.label.trim(),
        `пункт ${item.href} без підпису — читач побачить порожнє місце`,
      ).not.toBe('');

      // Зовнішні посилання не наші, їх не перевіряємо: чужий сайт може
      // лежати з причин, до яких ми не маємо стосунку.
      if (!item.href.startsWith('/')) continue;

      const page404 = await request.get(item.href, { failOnStatusCode: false });
      expect(
        page404.status(),
        `пункт меню «${item.label}» веде на ${item.href}, а той віддає ` +
          `${page404.status()}. Саме це переїзд меню в базу і зробив ` +
          `можливим — див. коментар угорі файла.`,
      ).toBeLessThan(400);
    }

    // 🔴 І ТЕ САМЕ ОЧИМА ЧИТАЧА, а не лише в API. Пункт може бути в
    // базі й не доїхати до розмітки — саме цей клас дефекту ми ловили
    // в CAMP-352, коли проп доходив до підпису, але не до мапи.
    await page.goto('/camping');
    const header = page.locator('header');
    for (const item of body.header ?? []) {
      await expect(
        header.getByRole('link', { name: item.label, exact: true }).first(),
        `пункт «${item.label}» є в базі, але його немає в шапці`,
      ).toHaveAttribute('href', item.href);
    }
  });
});
