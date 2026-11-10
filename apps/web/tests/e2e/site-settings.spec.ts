import { expect, test } from "@playwright/test";

/**
 * CAMP-481 — підпис сайту й речення в підвалі приходять із CMS.
 *
 * 🔴 ТЕСТ ЗВІРЯЄ СТОРІНКУ З ТИМ САМИМ API, З ЯКОГО ЇЇ БУДУЄ СЕРВЕР, а
 * не з рядком, переписаним сюди. Рядок у тесті доводив би лише те, що
 * хтось двічі набрав ті самі слова: переїзд тексту в базу лишився б
 * зеленим і тоді, коли сторінка далі малює копію з коду.
 *
 * 🔴 І ОКРЕМО — ЩО РЯДОК У БАЗІ ВЗАГАЛІ Є. Порожня колекція була
 * первісним дефектом: адмін відкривав форму, яка ні на що не впливає.
 * Код нижче свідомо терпить порожнечу (підвал без речення живий), тож
 * без цієї перевірки «нічого не вписано» й «усе працює» виглядали б
 * однаково зеленими.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function settings(request: import("@playwright/test").APIRequestContext) {
  const url = `${API}/site-settings`;
  const res = await request.get(url);
  expect(
    res.ok(),
    `GET ${url} → ${res.status()}. Підвал будується з цієї ж адреси, ` +
      `тож поки вона не відповідає, звіряти нема з чим.`,
  ).toBeTruthy();
  return (await res.json()) as {
    tagline: string | null;
    footerNote: string | null;
  };
}

test("у CMS є підпис сайту і речення підвалу", async ({ request }) => {
  const s = await settings(request);

  expect(
    s.footerNote,
    "`footer_note` порожній. Підвал це переживе — абзацу просто не буде, " +
      "— але саме порожня колекція й була дефектом CAMP-481: редактор " +
      "бачив форму, яка ні на що не впливає. Сій рядок міграцією.",
  ).toBeTruthy();

  expect(
    s.tagline,
    "`tagline` порожній, а він — опис сайту в голові документа, OG і " +
      "Twitter. Без нього сторінки поїдуть у пошук без опису зовсім.",
  ).toBeTruthy();
});

test("підвал показує речення саме з CMS", async ({ page, request }) => {
  const s = await settings(request);
  await page.goto("/");

  const footer = page.locator("footer");
  await expect(
    footer,
    `Підвал мусить містити текст із /site-settings. Якщо тут червоно, ` +
      `а речення на сторінці видно — воно малюється з коду, і власник ` +
      `не може його змінити.`,
  ).toContainText(s.footerNote!);
});

test("опис головної береться з CMS, а не з коду", async ({ page, request }) => {
  const url = `${API}/pages/home`;
  const res = await request.get(url);
  expect(res.ok(), `GET ${url} → ${res.status()}`).toBeTruthy();
  const home = (await res.json()) as { metaDescription: string | null };

  expect(
    home.metaDescription,
    "У головної немає опису в CMS — тоді їй лишається загальний підпис " +
      "сайту, і цей тест нічого не доводить. Сій опис міграцією.",
  ).toBeTruthy();

  await page.goto("/");
  const content = await page
    .locator('head meta[name="description"]')
    .getAttribute("content");

  expect(
    content,
    "Голова документа мусить нести опис із CMS. Якщо тут інший текст — " +
      "він приходить із коду, і власник не може його змінити.",
  ).toBe(home.metaDescription);
});

/**
 * 🔴 ЦЕЙ ТЕСТ ПРО ТЕ, ЧОГО НЕ ВИДНО НА СТОРІНЦІ, І ТОМУ ВІН ПОТРІБЕН.
 *
 * Заміряно 10.11.2026: ЖОДНА сторінка сайту не лишає опис порожнім —
 * кожна ставить свій. Отже кореневий опис із `generateMetadata` ніде
 * не рендериться, і зміна підпису в CMS не дала б видимого результату.
 * Я мало не записав цей переїзд у здобутки, не перевіривши.
 *
 * Підпис лишається в корені навмисно — це правильне місце для
 * загального опису, і саме він підхопить першу ж сторінку, яка свого
 * опису не матиме. Але доводити його можна лише так: запитом за тим
 * значенням, яке туди доїхало.
 */
test("загальний підпис сайту доступний як опис за замовчуванням", async ({
  request,
}) => {
  const s = await settings(request);
  expect(s.tagline).toBeTruthy();
  expect(
    s.tagline,
    "Підпис сайту мусить бути реченням, а не словом: він стає описом " +
      "сторінки, яка не має власного.",
  ).toMatch(/\s/);
});
