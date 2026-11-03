import { expect, test } from "@playwright/test";

import ProviderPageView from "@/app/camper-rental/providers/[slug]/page";
import { renderAsyncComponent } from "./render-component";

// 🔴 CAMP-427, пункт 5: «структуру й дизайн брати з теми Fuse».
//
// Власник просив сингл провайдера «за зразком single product page». Це
// не смак — у теми є точні числа, зняті з `assets/product.build.css`:
//
//   .product       { display:flex; column-gap:12px }
//   .product-media { width: calc(100% - 480px - 12px) }
//   .product-form  { position:sticky; top:0; width:480px; flex-shrink:0 }
//   @media (max-width:1199.98px) { .product-media { width:100% } }
//
// Тобто ліворуч — те, заради чого прийшли; праворуч — панель 480 px, де
// ухвалюється рішення, і вона їде за читачем; нижче 1200 px — один
// стовпець. Без цього тесту «привести до теми» — це речення в картці,
// яке переживе будь-яке прибирання верстки.
//
// 🔴 І тест перевіряє не лише ЧИСЛА, а й ЩО В ЯКІЙ колонці. Панель із
// правильною шириною, але з описом компанії всередині, пройшла б
// перевірку на числа й не була б сторінкою товару.

const FULL = {
  slug: "nordic-campers",
  name: "Nordic Campers",
  intro: "A Finnish company that hands over vehicles at four depots.",
  whatToKnow: "Winter tyres are fitted from October to April.",
  legalName: "Nordic Campers Oy",
  registrationNumber: "FI12345678",
  homeCountry: "FI",
  website: "https://example.test",
  email: "hello@example.test",
  phone: "+358 40 000 0000",
  declaredDepotCount: 4,
  declaredFleetSize: 60,
  foundedYear: 2011,
  sourceUrl: "https://example.test/about",
  sourceCheckedOn: "2026-11-03",
  services: [
    {
      code: "unlimited_km",
      availability: "included",
      note: null,
      source_url: "https://example.test/terms",
      source_checked_on: "2026-11-03",
    },
  ],
  vehicles: [
    {
      name: "Compact 540",
      slug: "compact-540",
      berths: 4,
      belted_seats: 4,
      length_cm: 540,
      camper_type_slug: "lowprofile",
      camper_type_name: "Low-profile motorhome",
      camper_type_said: "Car type: Semi-integrated",
      camper_type_checked_on: "2026-11-04",
      source_url: "https://example.test/fleet",
      source_checked_on: "2026-11-03",
    },
  ],
  reviewProfiles: [
    { source: "trustpilot", profileUrl: "https://example.test/review" },
  ],
};

async function render(payload: unknown = FULL): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    return await renderAsyncComponent(ProviderPageView, {
      params: Promise.resolve({ slug: FULL.slug }),
    });
  } finally {
    globalThis.fetch = real;
  }
}

/** Вміст <aside> панелі — те, що праворуч. */
function panel(html: string): string {
  const m = html.match(
    /<aside[^>]*data-testid="provider-panel"[\s\S]*?<\/aside>/,
  );
  expect(m, "панелі на сторінці немає взагалі").toBeTruthy();
  return m![0];
}

test.describe("сингл провайдера за зразком сторінки товару", () => {
  test("🔴 дві колонки з числами теми: 480 px, 12 px, стек нижче 1200", async () => {
    const html = await render();
    // Ліва колонка — рівно формула теми.
    expect(html).toContain("xl:w-[calc(100%-480px-12px)]");
    // Права панель — 480 px, не розтягується, їде за читачем.
    expect(panel(html)).toContain("xl:w-[480px]");
    expect(panel(html)).toContain("shrink-0");
    expect(panel(html)).toContain("xl:sticky");
    // 12 px між колонками — `gap-3` у нашій шкалі.
    expect(html).toMatch(/flex flex-col gap-3 xl:flex-row/);
  });

  test("🔴 праворуч саме те, де ухвалюється рішення", async () => {
    const aside = panel(await render());
    for (const heading of ["Contacts", "Scale, as the company states it"]) {
      expect(aside, heading).toContain(heading);
    }
    expect(aside).toContain("Reviews");
    // І ЦЬОГО там бути не може: опис і парк — це ліва колонка.
    expect(aside).not.toContain("What to know");
    expect(aside).not.toContain('data-testid="vehicles"');
    expect(aside).not.toContain('data-testid="services"');
  });

  test("🔴 ліворуч — те, заради чого прийшли", async () => {
    const html = await render();
    const aside = panel(html);
    const left = html.replace(aside, "");
    expect(left).toContain(FULL.intro);
    expect(left).toContain("What to know");
    expect(left).toContain('data-testid="services"');
    expect(left).toContain('data-testid="vehicles"');
    // Щоб відсутність щось означала: панель справді винесена з лівої.
    expect(left).not.toContain("Scale, as the company states it");
  });

  // 🔴 CAMP-371, умова 1 і пункт 2 «Способу перевірки» дослівно:
  // «на сторінці провайдера видно дату прочитання даних» і «мутація
  // "прибрати дату зрізу" мусить червонити перевірку — назвати, яку».
  //
  // Ось ці три. Без них сторінка стверджує «у них є ця модель» у
  // теперішньому часі — а ми бачили її в названий день і більше не
  // дивились. Машину могли продати наступного тижня.
  test("🔴 рядок парку несе дату прочитання", async () => {
    const html = await render();
    const rows = html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*<\/li>/g) ?? [];
    const fleet = rows.filter((r) => r.includes(FULL.vehicles[0].name));
    // Щоб порожнє читання не пройшло за збіг: рядок справді знайдено.
    expect(fleet.length).toBe(1);
    expect(fleet[0]).toContain('data-testid="vehicle-checked"');
    expect(fleet[0]).toContain(FULL.vehicles[0].source_checked_on!);
  });

  test("🔴 рядок сервісу несе дату прочитання", async () => {
    const html = await render();
    const withDate = (html.match(/data-testid="service-checked"/g) ?? [])
      .length;
    const said = FULL.services.filter(
      (s) => s.source_checked_on !== null,
    ).length;
    // Знаменник названий: нуль із нулем теж «збігається».
    expect(said).toBeGreaterThan(0);
    expect(withDate).toBe(said);
  });

  // 🔴 CAMP-371, пункт 3. ТИП ЄСТЬ, І ВІН НЕ НАШ ВИСНОВОК.
  //
  // У фікстурі дата типу навмисно ІНША (04.11), ніж дата парку (03.11):
  // тип читали окремим заміром, і спільна дата поставила б під фактом
  // день, коли його не читали. Якщо колись хтось зведе їх в одну колонку,
  // червоніє саме цей випадок.
  test("🔴 рядок парку несе тип, слова прокатника і ВЛАСНУ дату", async () => {
    const html = await render();
    const rows = html.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*<\/li>/g) ?? [];
    const fleet = rows.filter((r) => r.includes(FULL.vehicles[0].name));
    expect(fleet.length).toBe(1);
    expect(fleet[0]).toContain('data-testid="vehicle-type"');
    // назва типу словами, не слагом
    expect(fleet[0]).toContain("Low-profile motorhome");
    expect(fleet[0]).not.toContain("lowprofile");
    // дослівні слова прокатника
    expect(fleet[0]).toContain("Car type: Semi-integrated");
    // і ДВІ різні дати в одному рядку
    expect(fleet[0]).toContain("2026-11-04");
    expect(fleet[0]).toContain("2026-11-03");
  });

  test("машина без типу не отримує порожнього ярлика", async () => {
    const html = await render({
      ...FULL,
      vehicles: [
        {
          ...FULL.vehicles[0],
          camper_type_slug: null,
          camper_type_name: null,
          camper_type_said: null,
          camper_type_checked_on: null,
        },
      ],
    });
    expect(html).not.toContain('data-testid="vehicle-type"');
    // але дата ПАРКУ лишається — вона про інший факт
    expect(html).toContain('data-testid="vehicle-checked"');
  });

  test("🔴 і сторінка каже, що перелік — це знімок, а не склад сьогодні", async () => {
    const html = await render();
    expect(html).toContain("What a company had on the day we read its page");
  });

  test("країна названа словом, а не кодом", async () => {
    const aside = panel(await render());
    expect(aside).toContain("Finland");
    expect(aside).not.toMatch(/Registered in:\s*<\/dt>\s*<dd[^>]*>FI</);
  });
});
