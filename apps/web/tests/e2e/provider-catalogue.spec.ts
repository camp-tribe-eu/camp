import { expect, test } from "./api-request";

// 🔴 CAMP-427, дірка в пункті 2 «Способу перевірки» — закривається тут,
// а не в юніті.
//
// Донедавна доведено було лише те, що звужує ПРЕДИКАТ (`matches`,
// `arrange` — десять випадків у `rental-providers.spec.ts`). Чого
// доведено не було: що список НА ЕКРАНІ справді коротшає. Компонент із
// власним переліком поруч пройшов би всі десять випадків і показував би
// свій.
//
// Юніт-харнес це довести не може: каталог — клієнтський острів із
// `useState`, а харнес викликає компонент простою функцією, і хук падає.
// Межа вже записана в `catalogue-language.spec.ts`. Тому замір іде через
// справжній браузер і справжній клік.

test.describe("каталог компаній: фільтр звужує, а не перемальовує", () => {
  test("🔴 вибір країни скорочує список, і знаменник лишається цілим", async ({
    page,
  }) => {
    await page.goto("/camper-rental/providers");
    const rows = page.getByTestId("provider-row");
    const before = await rows.count();
    // Щоб відсутність щось означала: каталог справді не порожній.
    // Фікстура CI несе чотири компанії й шість країн, і кожна країна
    // трапляється не в однієї — інакше «звужує» не відрізнити від
    // «показує лише першу» (apps/api/test/fixtures/ci-seed-rental-providers.sql).
    expect(before).toBeGreaterThanOrEqual(4);

    const country = page.getByTestId("filter-country");
    const options = await country.locator("option").allTextContents();
    // Перша — «all»; беремо другу, тобто справжній код країни.
    expect(options.length).toBeGreaterThan(2);
    await country.selectOption({ index: 1 });

    await expect(rows).not.toHaveCount(before);
    const after = await rows.count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);

    // 🔴 Знаменник — це «скільки відсіялось». Чисельник змінився, а
    // знаменник мусить лишитись числом усього каталогу.
    await expect(page.getByTestId("result-count")).toHaveText(
      `${after} of ${before}`,
    );
  });

  test("🔴 кожен рядок веде на сторінку, яка існує і несе контакти", async ({
    page,
  }) => {
    await page.goto("/camper-rental/providers");
    const first = page.getByTestId("provider-row").first();
    const name = (await first.getByRole("link").first().textContent())?.trim();
    expect(name).toBeTruthy();
    await first.getByRole("link").first().click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name!);
    // Пункт 3 картки: сингл несе контакти й опис, а не лише назву.
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Scale, as the company states it" }),
    ).toBeVisible();
  });

  test("🔴 підпис селекта обіцяє те саме, що робить фільтр", async ({
    page,
  }) => {
    await page.goto("/camper-rental/providers");
    // Фільтр читає `p.countries` — країни, де компанія ВИДАЄ машини.
    // Підпис мусить казати це, а не «країна компанії»: інакше сайт
    // обіцяє одне, а робить інше (рішення вже записане в CAMP-421).
    await expect(page.getByText("Hands over vehicles in")).toBeVisible();
    await expect(page.getByText(/home country/i)).toHaveCount(0);
  });

  test("оцінок немає ніде — ні цифри, ні зірки", async ({ request }) => {
    const html = await (await request.get("/camper-rental/providers")).text();
    for (const forbidden of ["TrustScore", "★", "aggregateRating"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
    // Щоб відсутність щось означала: сторінка справді прочитана.
    expect(html).toContain("provider-row");
  });
});

// 🔴 CAMP-371, пункт 3: фільтр «який вен чи причеп шукаєте» — справжнім
// кліком, і число схованих читається з розмітки, а не з константи тесту.
//
// Число не записане в тест рукою навмисно: тест іде і по фікстурі CI
// (2 машини без типу з 4), і по справжньому каталозі (48 зі 115 на
// 04.11.2026). Замість цього він бере суму «N without a stated type» /
// «no vehicle type stated for its N models» з КОЖНОГО рядка до фільтра —
// тобто з іншого місця розмітки — і вимагає, щоб рядок про сховані машини
// назвав рівно її. Константа замість підрахунку збіглася б із цією сумою
// хіба що випадково, і лише на одному з двох наборів даних.
test.describe("каталог компаній: фільтр за типом", () => {
  test("🔴 вибір типу звужує список, і число схованих через невідомий тип дорівнює сумі по рядках", async ({
    page,
  }) => {
    await page.goto("/camper-rental/providers");
    const rows = page.getByTestId("provider-row");
    const before = await rows.count();
    expect(before).toBeGreaterThanOrEqual(2);

    // Сума машин без типу по ВСІХ рядках — до того, як щось сховано.
    const perRow = await page.getByTestId("row-types").allTextContents();
    const untyped = perRow.reduce((n, t) => {
      const m = t.match(
        /(\d+) without a stated type|no vehicle type stated for its (\d+) model/,
      );
      return n + (m ? Number(m[1] ?? m[2]) : 0);
    }, 0);
    // Щоб число щось означало: у даних справді є машини без типу.
    expect(untyped).toBeGreaterThan(0);

    const type = page.getByTestId("filter-type");
    const options = await type.locator("option").allTextContents();
    // Перша — «any»; далі таксономія з бази, тобто пʼять типів.
    expect(options.length).toBe(6);
    // Перший тип таксономії — ван (position 10); він є і у фікстурі, і
    // в каталозі.
    await type.selectOption({ index: 1 });
    const chosen = options[1].toLowerCase();

    await expect(rows).not.toHaveCount(before);
    const after = await rows.count();
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    await expect(page.getByTestId("result-count")).toHaveText(
      `${after} of ${before}`,
    );
    // Кожен, хто лишився, НАЗВАВ цей тип сам.
    for (const t of await page.getByTestId("row-types").allTextContents()) {
      expect(t).toContain(chosen);
    }
    await expect(page.getByTestId("hidden-by-type")).toHaveText(
      new RegExp(
        `^${untyped} vehicles? (is|are) not shown because their rental company does not state a type`,
      ),
    );
  });
});
