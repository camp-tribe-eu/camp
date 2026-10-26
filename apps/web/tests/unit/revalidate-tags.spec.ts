import { expect, test } from "@playwright/test";
import { ALLOWED_TAGS } from "@/lib/revalidate-tags";
import { PAGE_TAG } from "@/lib/page-content";
import { NAV_TAG } from "@/lib/navigation";

// 🔴 CAMP-364 — мітку `pages` не міг скинути НІХТО.
//
// Заміряно рецензією #308: `POST /internal/revalidate?tag=pages` віддавав
// `400 {"allowed":["navigation"]}`, і жоден виклик у репозиторії цю
// мітку не згадував. Тобто ввесь текст CMS — сторінки, правові
// документи, дописи блогу — оновлювався виключно витримкою 86 400 с,
// тоді як коментар у `lib/posts.ts` стверджував «одна мітка — один
// вебхук, який не можна налаштувати наполовину». Мітка існувала, і
// скинути її було нічим.
//
// 🔴 І ЧОМУ ЦЕ ЮНІТ, А НЕ E2E. Першою редакцією я написав e2e, який
// питав обробник по HTTP, — він упав у ВСІХ ЧОТИРЬОХ браузерах. Бо
// секрет перевіряється ПЕРШИМ: без `REVALIDATE_SECRET` (а в CI його
// немає) відповідь 503, і про мітки в ній не йдеться. Перелік міток по
// HTTP у CI не видно ніколи — тест стояв на хибній засновку.
test.describe("🔴 мітки, які дозволено скидати", () => {
  test("перелік містить і меню, і сторінки", () => {
    expect([...ALLOWED_TAGS.keys()].sort()).toEqual(["navigation", "pages"]);
  });

  test("імена ведуть на ті самі мітки, що вживає код", () => {
    expect(ALLOWED_TAGS.get("navigation")).toBe(NAV_TAG);
    expect(ALLOWED_TAGS.get("pages")).toBe(PAGE_TAG);
  });

  // 🔴 Пара: без неї «містить pages» було б істинним і для переліку,
  // що приймає будь-що.
  test("вигадана мітка не приймається", () => {
    expect(ALLOWED_TAGS.get("definitely-not-a-tag")).toBeUndefined();
    expect(ALLOWED_TAGS.get("")).toBeUndefined();
  });
});
