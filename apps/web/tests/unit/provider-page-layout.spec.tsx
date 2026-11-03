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
      source_url: null,
      source_checked_on: null,
    },
  ],
  vehicles: [
    {
      name: "Compact 540",
      slug: "compact-540",
      berths: 4,
      belted_seats: 4,
      length_cm: 540,
    },
  ],
  reviewProfiles: [
    { source: "trustpilot", profileUrl: "https://example.test/review" },
  ],
};

async function render(): Promise<string> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(FULL), {
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

  test("країна названа словом, а не кодом", async () => {
    const aside = panel(await render());
    expect(aside).toContain("Finland");
    expect(aside).not.toMatch(/Registered in:\s*<\/dt>\s*<dd[^>]*>FI</);
  });
});
