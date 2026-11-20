import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "@playwright/test";

import TripCostCalculator from "@/components/trip-cost-calculator";
import PackingListBuilder from "@/components/packing-list-builder";
import ProviderCatalogue from "@/components/provider-catalogue";
import RentalPicker from "@/components/rental-picker";
import { renderClient, renderComponent } from "./render-component";

/**
 * 🔴 Review 442/22 and 442/32: «шеврон селекта не впритул до краю».
 *
 * The native arrow sits against the edge; the theme's select is
 * `appearance: none` + its own chevron + 40px on the inline end. Each
 * select must carry BOTH: room without chevron looks like a text field,
 * chevron without `appearance-none` draws two arrows.
 */
const pages = {
  "trip cost": () => createElement(TripCostCalculator, {}),
  packing: () => createElement(PackingListBuilder),
};

for (const [name, el] of Object.entries(pages)) {
  test(`🔴 ${name}: every select is the theme select — own chevron, room on the end`, () => {
    const html = renderToStaticMarkup(el());
    const selects = [...html.matchAll(/<select\b([^>]*)>[\s\S]*?<\/select>(\s*<svg\b[^>]*>)?/g)];
    expect(selects.length, "no select rendered — the check saw nothing").toBeGreaterThan(0);
    for (const [, attrs, svg] of selects) {
      const id = /id="([^"]+)"/.exec(attrs)?.[1];
      expect(attrs, id).toMatch(/\bappearance-none\b/);
      expect(attrs, id).toMatch(/\bpe-10\b/);
      expect(svg ?? "", `${id}: chevron must follow the select`).toContain('data-testid="select-chevron"');
    }
  });
}

// 🔴 Review 444/9: «селекти системні» on the provider catalogue and the
// rental picker (/camper-rental, /contact). Same pair as above; the
// picker styles its select by CSS class, so its room is checked in the
// shipped stylesheet rather than in utility classes.
const TYPES = [{ slug: "van", name: "Campervan", position: 10 }];

const chevronAfterEverySelect = (html: string) => {
  const selects = [...html.matchAll(/<select\b([^>]*)>[\s\S]*?<\/select>(\s*<svg\b[^>]*>)?/g)];
  expect(selects.length, "no select rendered — the check saw nothing").toBeGreaterThan(0);
  for (const [, attrs, svg] of selects) {
    const id = /data-testid="([^"]+)"/.exec(attrs)?.[1];
    expect(svg ?? "", `${id}: chevron must follow the select`).toContain('data-testid="select-chevron"');
  }
  return selects;
};

test("🔴 provider catalogue: every select is the theme select — own chevron, room on the end", () => {
  const html = renderClient(ProviderCatalogue, { all: [], types: TYPES });
  const selects = chevronAfterEverySelect(html);
  expect(selects.length).toBe(3);
  for (const [, attrs] of selects) {
    expect(attrs).toMatch(/\bappearance-none\b/);
    expect(attrs).toMatch(/\bpe-10\b/);
  }
});

test("🔴 rental picker: every select is the theme select — own chevron, room on the end", () => {
  const html = renderComponent(RentalPicker, {
    heading: "Find a rental company",
    submitLabel: "Show rental companies",
    action: "/camper-rental/providers",
    countries: [{ code: "DE", name: "Germany" }],
    types: TYPES,
  });
  // CAMP-444: тип — плитками з іконками, тож селект лишився один (країна).
  expect(chevronAfterEverySelect(html).length).toBe(1);
  const rule = /\.ct-pick__select\{([^}]*)\}/.exec(html)?.[1] ?? "";
  expect(rule, "picker stylesheet not rendered").not.toBe("");
  expect(rule).toMatch(/(^|;)appearance:none/);
  expect(rule).toMatch(/padding:0 40px 0 12px/);
});

// 🔴 CAMP-444 (ревʼю 444/9–10): тип кемпера — плитками з нашою іконкою,
// справжніми радіокнопками з імʼям `type` (те саме, що в селекта), «Any
// type» обрано за замовчуванням, і кожен тип має СВОЮ іконку.
test("🔴 rental picker: vehicle type is a group of icon tiles over real radios named `type`", () => {
  const types = [
    { slug: "van", name: "Campervan", position: 10 },
    { slug: "caravan", name: "Caravan", position: 50 },
  ];
  const html = renderComponent(RentalPicker, {
    heading: "Find a rental company",
    submitLabel: "Show rental companies",
    action: "/camper-rental/providers",
    countries: [{ code: "DE", name: "Germany" }],
    types,
  });
  const group = /<fieldset\b[^>]*data-testid="picker-type"[\s\S]*?<\/fieldset>/.exec(html)?.[0] ?? "";
  expect(group, "no type fieldset").not.toBe("");
  expect(group).toContain("<legend");
  const radios = [...group.matchAll(/<input\b([^>]*)>/g)].map((m) => m[1]);
  expect(radios).toHaveLength(types.length + 1);
  for (const r of radios) {
    expect(r).toContain('type="radio"');
    expect(r).toContain('name="type"');
  }
  expect(radios[0]).toContain('value=""');
  expect(radios[0]).toMatch(/checked/);
  for (const t of types) {
    expect(group, `${t.slug} icon`).toMatch(
      new RegExp(`data-camper-type="${t.slug}"[^>]*>\\s*<svg[^>]*data-camper-icon="${t.slug}"`),
    );
    expect(group).toContain(t.name);
  }
  expect(html, "no type <select> left behind").not.toMatch(/<select[^>]*name="type"/);
});
