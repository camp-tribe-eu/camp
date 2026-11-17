import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "@playwright/test";

import PHOTOS from "@/data/page-photos.json";
import { LayeredBanner } from "@/components/layered-banner";
import { PhotoFrame } from "@/components/photo-frame";
import { AI_LABEL, pagePhoto } from "@/lib/page-photos";

/**
 * 🔴 Generated page photos (17.11.2026). What must hold:
 *  1. every recorded picture is on disk, with prompt + seed on record;
 *  2. only landscape kinds — never a campsite or a company;
 *  3. a generated picture prints «AI illustration» wherever it is shown
 *     (AI Act Art. 50(4)), and the owner's own picture does not.
 */
const KINDS = ["country", "route", "rental", "topic", "topic-country"];
const table = PHOTOS as Record<string, Record<string, { src: string; alt: string; seed: number; prompt: string; model: string }>>;
const entries = Object.entries(table).flatMap(([k, v]) => Object.entries(v).map(([s, e]) => ({ k, s, ...e })));

test("every recorded picture exists, carries prompt, seed and model, and its alt says it is an illustration", () => {
  expect(entries.length, "the manifest is empty — the check saw nothing").toBeGreaterThan(100);
  for (const e of entries) {
    expect(existsSync(path.join(process.cwd(), "public", e.src)), e.src).toBe(true);
    expect(typeof e.seed, e.src).toBe("number");
    expect(e.prompt.length, e.src).toBeGreaterThan(40);
    expect(e.model, e.src).toBe("fal-ai/flux/krea");
    expect(e.alt, e.src).toContain("(AI illustration)");
  }
});

test("🔴 only landscape kinds — no campsite, region or company picture", () => {
  expect(Object.keys(table).every((k) => KINDS.includes(k))).toBe(true);
  // The campsite page must not even import the module.
  const spot = readFileSync("src/app/camping/[country]/[region]/[slug]/page.tsx", "utf8");
  expect(spot).not.toMatch(/page-photos/);
});

test("🔴 a generated banner background says «AI illustration»; the owner's own picture does not", () => {
  const gen = pagePhoto("country", "fr")!;
  const base = { tickerText: "FRANCE", heading: "Campsites in France" };
  const withAi = renderToStaticMarkup(createElement(LayeredBanner, { ...base, background: gen }));
  expect(withAi).toContain(`data-testid="ai-label">${AI_LABEL}<`);
  const own = renderToStaticMarkup(createElement(LayeredBanner, { ...base, background: { src: "/x.webp", alt: "" } }));
  expect(own).not.toContain("ai-label");
});

test("🔴 a generated photo frame says «AI illustration»", () => {
  const html = renderToStaticMarkup(createElement(PhotoFrame, { image: pagePhoto("route", "andalusia-in-winter"), hero: true }));
  expect(html).toContain(`data-testid="ai-label">${AI_LABEL}<`);
  expect(renderToStaticMarkup(createElement(PhotoFrame, { image: { src: "/x.webp", alt: "" } }))).not.toContain("ai-label");
});

test("lookup is case-insensitive and unknown slugs give nothing", () => {
  expect(pagePhoto("country", "FR")?.src).toBe("/photos/country/fr.webp");
  expect(pagePhoto("country", "cy")).toBeNull(); // Cyprus is not shown (owner, 26.10.2026)
  expect(pagePhoto("route", undefined)).toBeNull();
});
