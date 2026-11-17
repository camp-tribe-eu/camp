import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "@playwright/test";

import TripCostCalculator from "@/components/trip-cost-calculator";
import PackingListBuilder from "@/components/packing-list-builder";

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
