import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

import { Flag } from "@/components/flag";
import MediaCards from "@/components/media-card";
import { RentalProviderCards, RentalStories } from "@/components/rental-blocks";
import RentalPicker from "@/components/rental-picker";
import { countryName } from "@/lib/api";
import { pickerChoices } from "@/lib/rental-picker";
import type { CamperType, Provider } from "@/lib/rental-providers";
import type { SectionView } from "@/lib/page-content";
import { claimSlots, withButton } from "@/lib/slots";
import { renderComponent, rendersNothing } from "./render-component";

// CAMP-461 — оренда: банер, віджет, єдина картка, слоти.
//
// 🔴 УСЕ ТУТ ЧИТАЄ ВІДДАНУ РОЗМІТКУ, а не константу й не клас. «Картка має
// одну кнопку, і вона називає предмет» — це рядок у HTML, який бачить читач
// екрана, а не поле в пропсах.

const P = (over: Partial<Provider> & { slug: string }): Provider => ({
  name: over.slug.toUpperCase(),
  homeCountry: "DE",
  website: null,
  declaredDepotCount: null,
  declaredFleetSize: null,
  foundedYear: null,
  serviceCount: 0,
  vehicleCount: 0,
  reviewProfiles: [],
  serviceCodes: [],
  countries: [],
  camperTypeSlugs: [],
  untypedVehicleCount: 0,
  ...over,
});

const TYPES: CamperType[] = [
  { slug: "van", name: "Campervan", position: 10 },
  { slug: "coachbuilt", name: "Coachbuilt", position: 20 },
  { slug: "caravan", name: "Caravan", position: 50 },
];

const section = (over: Partial<SectionView>): SectionView => ({
  type: "prose",
  variant: null,
  slot: null,
  heading: null,
  subheading: null,
  body: null,
  imageUrl: null,
  imageAlt: null,
  ctaHref: null,
  ctaLabel: null,
  items: [],
  ...over,
});

// ── Єдина картка ─────────────────────────────────────────────────────

test.describe("єдина картка «медіа — назва — текст — кнопка»", () => {
  const items = [
    {
      key: "a",
      media: <Flag code="de" />,
      title: "Alpenwohnmobil",
      text: "Based in Austria.",
      chips: ["6 depots", "fleet of 140"],
      cta: { href: "/camper-rental/providers/alpen", label: "View Alpenwohnmobil" },
    },
    {
      key: "b",
      media: <Flag code="nl" />,
      title: "Dunes Vans",
      cta: { href: "/camper-rental/providers/dunes", label: "View Dunes Vans" },
    },
  ];

  test("🔴 рівно одне посилання на картку, і підпис називає предмет", () => {
    const html = renderComponent(MediaCards, { items });
    const cards = html.split('data-testid="media-card"').slice(1);
    expect(cards.length).toBe(2);
    for (const [i, card] of cards.entries()) {
      const links = card.match(/<a [^>]*href="[^"]+"/g) ?? [];
      expect(links.length, `картка ${i}`).toBe(1);
    }
    expect(cards[0]).toContain(">View Alpenwohnmobil<");
    expect(cards[0]).toContain('href="/camper-rental/providers/alpen"');
    expect(cards[1]).toContain(">View Dunes Vans<");
    // Підпис не безіменний: «More» / «Read more» на картці — це мовчання
    // для читача екрана.
    expect(html).not.toMatch(/>(More|Read more|Click here)</);
  });

  test("🔴 медіа стоїть ПЕРЕД заголовком у розмітці, а чипи йдуть лише коли їх дали", () => {
    const html = renderComponent(MediaCards, { items });
    const first = html.split('data-testid="media-card"')[1];
    expect(first.indexOf("ct-flag")).toBeGreaterThan(-1);
    expect(first.indexOf("ct-flag")).toBeLessThan(first.indexOf("Alpenwohnmobil"));
    expect(first).toContain(">6 depots<");
    expect(first).toContain(">fleet of 140<");
    const second = html.split('data-testid="media-card"')[2];
    expect(second).not.toContain("ct-mc__chips");
  });

  test("🔴 порожній перелік не малює порожньої сітки", () => {
    expect(rendersNothing(MediaCards, { items: [] })).toBe(true);
  });
});

// ── Картка компанії: чисельники з даних, Кіпр, порядок ───────────────

test.describe("картки компаній", () => {
  const providers = [
    P({
      slug: "alfa",
      homeCountry: "AT",
      declaredDepotCount: 6,
      declaredFleetSize: 140,
      foundedYear: 1998,
      countries: ["AT", "DE", "CY"],
      camperTypeSlugs: ["van"],
    }),
    P({ slug: "bravo", homeCountry: "SE", countries: ["SE"] }),
  ];

  test("🔴 заявлені цифри — чипи; країна видачі рахується БЕЗ Кіпру", () => {
    const html = renderComponent(RentalProviderCards, { providers, types: TYPES });
    expect(html).toContain(">6 depots<");
    expect(html).toContain(">fleet of 140<");
    expect(html).toContain(">trading since 1998<");
    expect(html).toContain(">campervan<");
    // Три коди (AT, DE, CY), але Кіпр читач не бачить: «2 countries».
    expect(html).toContain("Based in Austria; hands over vehicles in 2 countries.");
    expect(html).not.toContain("in 3 countries");
    expect(html).toContain("Based in Sweden; hands over vehicles in 1 country.");
  });

  test("🔴 прапор — країни прописки, і код не друкується замість назви", () => {
    const html = renderComponent(RentalProviderCards, { providers, types: TYPES });
    expect(html).toContain("/flags/at.svg");
    expect(html).toContain("/flags/se.svg");
    expect(html).not.toMatch(/Based in (AT|SE)[;.]/);
  });
});

// ── Віджет: форма, а не обіцянка ─────────────────────────────────────

test.describe("віджет вибору компанії", () => {
  const choices = pickerChoices(
    [
      P({ slug: "a", countries: ["DE", "NL", "CY"], camperTypeSlugs: ["van"] }),
      P({ slug: "b", countries: ["AT"], camperTypeSlugs: [] }),
    ],
    TYPES,
  );
  const html = renderComponent(RentalPicker, {
    heading: "Find a rental company",
    hint: "Pick a country.",
    submitLabel: "Show rental companies",
    action: "/camper-rental/providers",
    countries: choices.countries,
    types: choices.types,
  });

  test("🔴 звичайна форма GET на каталог, з полями країни й типу", () => {
    const form = html.match(/<form[^>]*>/)?.[0] ?? "";
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/camper-rental/providers"');
    expect(html).toContain('name="country"');
    expect(html).toContain('name="type"');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Show rental companies<\/button>/);
  });

  test("🔴 не обіцяє пошуку дат: поля дати немає", () => {
    expect(html).not.toMatch(/type="date"|name="(from|to|start|end|dates?)"/);
  });

  test("🔴 селект країн — назви, без Кіпру; типи — лише названі компаніями", () => {
    // 4 коди DE, NL, CY, AT → без CY три; відсортовано за назвою.
    expect(choices.countries.map((c) => c.code)).toEqual(["AT", "DE", "NL"]);
    expect(html).toContain(">Austria<");
    expect(html).toContain(">Germany<");
    expect(html).toContain(">Netherlands<");
    expect(html).not.toContain("Cyprus");
    expect(html).not.toContain('value="CY"');
    // Із трьох типів таксономії названий один.
    expect(choices.types.map((t) => t.slug)).toEqual(["van"]);
    expect(html).toContain(">Campervan<");
    expect(html).not.toContain(">Coachbuilt<");
    expect(html).not.toContain(">Caravan<");
  });
});

// ── Коди джерела: перелічені, не припущені ───────────────────────────

test("🔴 коди країн у засіві компаній — рівно 26 кодів ISO ЄС, без EL/UK/AX", () => {
  const dir = join(__dirname, "..", "..", "..", "api", "src", "rental");
  const codes = new Set<string>();
  const walk = (x: unknown, key = ""): void => {
    if (Array.isArray(x)) {
      for (const v of x) walk(v, key);
    } else if (x && typeof x === "object") {
      for (const [k, v] of Object.entries(x)) walk(v, k);
    } else if (
      typeof x === "string" &&
      ["homeCountry", "home_country", "country", "countries"].includes(key)
    ) {
      codes.add(x);
    }
  };
  for (const f of [
    "providers.seed.json",
    "provider-countries.json",
    "providers-local.seed.json",
  ]) {
    walk(JSON.parse(readFileSync(join(dir, f), "utf8")));
  }
  // Перелічено, а не перевірено своїм списком: ось що лежить у джерелі.
  expect([...codes].sort()).toEqual([
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR",
    "HR", "HU", "IE", "IT", "LT", "LU", "LV", "NL", "PL", "PT", "RO", "SE",
    "SI", "SK",
  ]);
  // І кожен код має назву, а не лишається двома літерами: саме так
  // виглядав би `EL`, якби він був.
  for (const c of codes) {
    expect(countryName(c), c).not.toBe(c);
  }
});

// ── Слоти: секція, яку макет не забрав, не зникає мовчки ─────────────

test.describe("слоти сторінки", () => {
  const spec = { one: ["banner", "faq"], many: /^story:\d+$/ } as const;
  const ok = [
    section({ slot: "banner", type: "hero" }),
    section({ slot: "faq", type: "faq" }),
    section({ slot: "story:0", type: "image-text" }),
    section({ slot: "story:1", type: "image-text" }),
  ];

  test("збирає одиничні й повторювані слоти", () => {
    const got = claimSlots(ok, spec, "t");
    expect(Object.keys(got.one).sort()).toEqual(["banner", "faq"]);
    expect(got.many.map((s) => s.slot)).toEqual(["story:0", "story:1"]);
  });

  test("🔴 невідомий слот падає і називає його", () => {
    expect(() =>
      claimSlots([...ok, section({ slot: "timeline" })], spec, "t"),
    ).toThrow(/слот «timeline» сторінці невідомий/);
  });

  test("🔴 секція без слота падає", () => {
    expect(() => claimSlots([...ok, section({ slot: null })], spec, "t")).toThrow(
      /без слота/,
    );
  });

  test("🔴 бракує слота — падає і називає, якого саме", () => {
    expect(() => claimSlots(ok.slice(1), spec, "t")).toThrow(
      /немає слотів: banner/,
    );
  });

  test("🔴 слот двічі падає", () => {
    expect(() => claimSlots([...ok, ok[0]], spec, "t")).toThrow(/двічі/);
  });

  test("🔴 кнопка без підпису чи заголовка падає, а не малює півкнопки", () => {
    const full = section({
      slot: "banner",
      heading: "H",
      ctaHref: "/x",
      ctaLabel: "Go",
    });
    expect(withButton(full, "t").ctaLabel).toBe("Go");
    for (const bad of [
      { heading: null },
      { ctaHref: null },
      { ctaLabel: "" },
    ]) {
      expect(() => withButton({ ...full, ...bad }, "t")).toThrow(/мусить мати/);
    }
  });
});

// ── Рядки «фото + текст»: порожнє не малюється мовчки ────────────────

test.describe("рядки «фото + текст» зі слотів", () => {
  const story = (over: Partial<SectionView> = {}) =>
    section({
      slot: "story:0",
      type: "image-text",
      heading: "Plan the route",
      body: "Routes show the stages.",
      imageUrl: "/banners/routes.webp",
      imageAlt: "A gravel path",
      ctaHref: "/routes",
      ctaLabel: "Browse camper routes",
      ...over,
    });

  test("🔴 фото, заголовок, текст і кнопка доходять до читача; фото праворуч за variant", () => {
    const left = renderComponent(RentalStories, { sections: [story()], where: "t" });
    expect(left).toContain('src="/banners/routes.webp"');
    expect(left).toContain('alt="A gravel path"');
    expect(left).toContain(">Plan the route<");
    expect(left).toContain('href="/routes"');
    expect(left).toContain(">Browse camper routes<");
    expect(left).not.toMatch(/<section class="[^"]*ct-iwt--reverse/);
    const right = renderComponent(RentalStories, {
      sections: [story({ variant: "reverse" })],
      where: "t",
    });
    expect(right).toMatch(/<section class="[^"]*ct-iwt--reverse/);
  });

  test("🔴 без заголовка, картинки, опису чи з півкнопкою — падає", () => {
    for (const [name, bad] of [
      ["заголовок", { heading: null }],
      ["картинка", { imageUrl: "" }],
      ["alt", { imageAlt: null }],
      ["кнопка", { ctaLabel: null }],
    ] as const) {
      expect(
        () =>
          renderComponent(RentalStories, { sections: [story(bad)], where: "t" }),
        name,
      ).toThrow();
    }
  });
});
