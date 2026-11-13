import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";

import { SPOT_TYPE_LABEL, type Spot } from "@/lib/api";
import type { SectionView } from "@/lib/page-content";
import {
  buildWidget,
  embedSnippet,
  renderWidget,
  WIDGET_BUDGET_BYTES,
  WIDGET_SLOTS,
  widgetLabels,
} from "@/lib/provider-widget";
import { findForbiddenWords } from "@/lib/wording";
import {
  EMBED_CSP,
  EMBED_HEADERS,
  EMBED_PREFIX,
  WIDGET_CSS,
} from "../../scripts/embed-policy.mjs";
import { SECURITY_HEADERS } from "../../scripts/security-headers.mjs";
import nextConfig from "../../next.config.mjs";
import { WIDGET_SECTIONS } from "../../../api/src/migrations/1797400000000-ProviderWidgetText";

// CAMP-523. What can be held without a server: the string the widget is,
// the policy it is served under, and that the two agree. What needs a
// browser — framing from another origin, cookies, the request count — is
// tests/e2e/provider-widget.spec.ts.

const section = (slot: string, heading: string | null): SectionView => ({
  type: "prose",
  variant: null,
  slot,
  heading,
  subheading: null,
  body: null,
  imageUrl: null,
  imageAlt: null,
  ctaHref: null,
  ctaLabel: null,
  items: [],
});

const SEEDED = WIDGET_SECTIONS.map((s) => section(s.slot, s.heading));
const LABELS = widgetLabels(SEEDED)!;
const ADDRESS = { country: "hr", region: "istria", slug: "camp-x" };

const spot = (over: Partial<Spot> = {}): Spot =>
  ({
    slug: "camp-x",
    name: "Camp X",
    country: "hr",
    region: "Istria",
    type: "paid",
    lat: 45,
    lon: 14,
    amenities: {},
    ownerOverrides: {},
    lastSeenAt: null,
    missingSince: null,
    context: {
      town: { name: "Pula", m: 4200 },
      supermarket: { m: 800 },
      elevation: 12,
    },
    description: null,
    descriptionLang: null,
    stars: null,
    website: null,
    ...over,
  }) as unknown as Spot;

const html = (over: Partial<Spot> = {}, labels = LABELS) =>
  renderWidget({
    spot: spot(over),
    address: ADDRESS,
    labels,
    siteUrl: "https://camptribe.eu/",
  });

test.describe("the words", () => {
  test("the migration seeds every slot the widget reads", () => {
    expect(LABELS).not.toBeNull();
    const seeded = WIDGET_SECTIONS.map((s) => s.slot);
    for (const slot of WIDGET_SLOTS) expect(seeded).toContain(slot);
    expect(new Set(seeded).size, "a slot seeded twice").toBe(seeded.length);
  });

  for (const slot of WIDGET_SLOTS) {
    test(`🔴 without «${slot}» there are no labels at all`, () => {
      expect(widgetLabels(SEEDED.filter((s) => s.slot !== slot))).toBeNull();
      // Blank is missing: an editor who cleared the field has not written
      // an attribution of zero characters.
      expect(
        widgetLabels(
          SEEDED.map((s) => (s.slot === slot ? section(slot, "  ") : s)),
        ),
      ).toBeNull();
      // Two sections in one slot: we do not pick.
      expect(widgetLabels([...SEEDED, section(slot, "second")])).toBeNull();
    });
  }

  test("no sections is no labels", () => {
    expect(widgetLabels(null)).toBeNull();
    expect(widgetLabels([])).toBeNull();
  });

  test("the seeded text uses none of the words the site refuses", () => {
    for (const s of WIDGET_SECTIONS) {
      expect(
        findForbiddenWords(`${s.heading} ${s.body ?? ""}`),
        s.slot,
      ).toEqual([]);
    }
  });
});

test.describe("the document", () => {
  test("prints the measured rows, the link and the attribution", () => {
    const out = html();
    expect(out).toContain("<h1>Camp X</h1>");
    expect(out).toContain(`<h2>${LABELS.heading}</h2>`);
    expect(out).toContain("<li><span>Pula</span><span>4.2 km</span></li>");
    expect(out).toContain(
      "<li><span>Supermarket</span><span>800 m</span></li>",
    );
    expect(out).toContain("<li><span>Elevation</span><span>12 m</span></li>");
    expect(out).toContain(
      '<a href="https://camptribe.eu/camping/hr/istria/camp-x" target="_blank" rel="noopener">',
    );
    expect(out).toContain(`<small>${LABELS.source}</small>`);
  });

  test("🔴 a distance that is not a number is not a row", () => {
    const out = html({
      context: {
        town: { name: "Pula", m: undefined as unknown as number },
        supermarket: { m: 800 },
      },
    } as Partial<Spot>);
    expect(out).not.toContain("Pula");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("NaN");
    expect(out).toContain("Supermarket");
  });

  test("🔴 nothing measured: it says so, draws no list and credits nobody", () => {
    const out = html({ context: {} });
    expect(out).toContain(`<p>${LABELS.empty}</p>`);
    expect(out).not.toContain("<ul");
    expect(out).not.toContain("<h2");
    expect(out).not.toContain("<small");
    expect(out).toContain("/camping/hr/istria/camp-x");
  });

  test("🔴 a name from OpenStreetMap and a label from the CMS are text, never markup", () => {
    const hostile = "<script>alert(1)</script><img src=x onerror=alert(1)>\"'&";
    const out = html(
      {
        name: hostile,
        context: { town: { name: hostile, m: 10 } },
      } as Partial<Spot>,
      { ...LABELS, heading: hostile, link: hostile, source: hostile },
    );
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<img/i);
    expect(
      out.match(/&lt;script&gt;/g)?.length,
      "title, h1, h2, row, link, source",
    ).toBe(6);
    // One <style>, ours, and it is the only place a quote may appear raw.
    const outside = out.replace(/<style>.*?<\/style>/, "");
    expect(outside).not.toMatch(/onerror=alert\(1\)>/);
    expect(outside).toContain("&quot;&#39;&amp;");

    // The words for "nothing measured" travel a branch of their own.
    const bare = html({ context: {} }, { ...LABELS, empty: hostile });
    expect(bare).not.toMatch(/<script/i);
    expect(bare).toContain("<p>&lt;script&gt;");
  });

  test("a nameless campsite is named the way its page names it", () => {
    // The campsite page's own rule (generateMetadata): type, then region.
    expect(html({ name: null })).toContain(
      `<h1>${SPOT_TYPE_LABEL.paid} near Istria</h1>`,
    );
    expect(html({ name: "  ", region: null })).toContain(
      `<h1>${SPOT_TYPE_LABEL.paid}</h1>`,
    );
  });

  test("it carries no script, no image, no font and no second file", () => {
    const out = html();
    for (const tag of [
      "<script",
      "<img",
      "<link",
      "<iframe",
      "<object",
      "<form",
      "<input",
      "<video",
      "<audio",
      "@import",
      "url(",
      "@font-face",
      "src=",
    ]) {
      expect(out, tag).not.toContain(tag);
    }
    expect(Buffer.byteLength(out)).toBeLessThan(WIDGET_BUDGET_BYTES);
  });
});

test.describe("what the route answers", () => {
  const page = {
    slug: "provider-widget",
    title: "A widget",
    metaTitle: null,
    metaDescription: null,
    noindex: true,
    sections: SEEDED,
  };
  const deps = (over: Partial<Parameters<typeof buildWidget>[1]> = {}) => ({
    getSpot: async () => ({ spot: spot() }),
    pageContent: async () => page,
    siteUrl: "https://camptribe.eu",
    ...over,
  });

  test("a campsite we hold, with its words: the document", async () => {
    const reply = await buildWidget(ADDRESS, deps());
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(html());
  });

  test("🔴 a country we do not publish is 404 even when the campsite EXISTS, and is not even read", async () => {
    let asked = 0;
    const reply = await buildWidget(
      { country: "CY", region: "x", slug: "y" },
      deps({
        getSpot: async () => {
          asked += 1;
          return { spot: spot({ country: "cy" }) };
        },
      }),
    );
    expect(reply).toEqual({ status: 404, body: "Not found" });
    expect(asked).toBe(0);
  });

  test("a campsite we do not hold is 404", async () => {
    expect(
      (await buildWidget(ADDRESS, deps({ getSpot: async () => null }))).status,
    ).toBe(404);
  });

  test("🔴 without its words it is 503 and prints no figure", async () => {
    for (const pageContent of [
      async () => null,
      async () => ({
        ...page,
        sections: SEEDED.filter((s) => s.slot !== "widget-source"),
      }),
    ]) {
      const reply = await buildWidget(ADDRESS, deps({ pageContent }));
      expect(reply.status).toBe(503);
      expect(reply.body).not.toContain("<");
      expect(reply.body).not.toContain("4.2 km");
      expect(reply.body).toContain("widget-source");
    }
  });
});

test.describe("the policy", () => {
  test("🔴 the stylesheet in the document is the one the policy names", () => {
    const css = /<style>(.*?)<\/style>/.exec(html())?.[1];
    expect(css).toBe(WIDGET_CSS);
    const hash = createHash("sha256").update(css!, "utf8").digest("base64");
    expect(EMBED_CSP).toContain(`style-src 'sha256-${hash}'`);
  });

  test("it allows framing and nothing else", () => {
    expect(EMBED_CSP.split("; ")).toEqual([
      "default-src 'none'",
      expect.stringMatching(/^style-src 'sha256-[A-Za-z0-9+/]{43}='$/),
      "frame-ancestors *",
      "base-uri 'none'",
      "form-action 'none'",
    ]);
    expect(EMBED_CSP).not.toContain("unsafe");
    expect(EMBED_HEADERS["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  test("🔴 next.config: the widget path overrides, so it must come after the site-wide entry", async () => {
    const entries = await nextConfig.headers();
    const all = entries.findIndex(
      (e: { source: string }) => e.source === "/:path*",
    );
    const embed = entries.findIndex(
      (e: { source: string }) => e.source === `${EMBED_PREFIX}/:path*`,
    );
    expect(all).toBe(0);
    expect(embed, "Next lets the LAST matching entry win").toBeGreaterThan(all);
    expect(entries).toHaveLength(2);
    const value = (i: number, key: string) =>
      entries[i].headers.find((h: { key: string }) => h.key === key)?.value;
    expect(value(embed, "Content-Security-Policy")).toBe(EMBED_CSP);
    // And the exception is one path wide: everything else still refuses a frame.
    expect(value(all, "Content-Security-Policy")).toBe(
      SECURITY_HEADERS["Content-Security-Policy"],
    );
    expect(value(all, "Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  test("public/_headers: the inherited policy is detached before ours is set", () => {
    const dir = path.join(__dirname, "..", "..");
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== "NODE_ENV"),
    ) as NodeJS.ProcessEnv;
    const res = spawnSync(
      process.execPath,
      [path.join(dir, "scripts", "gen-headers.mjs")],
      { env },
    );
    expect(res.status).toBe(0);
    const lines = readFileSync(
      path.join(dir, "public", "_headers"),
      "utf8",
    ).split("\n");
    const at = lines.indexOf(`${EMBED_PREFIX}/*`);
    expect(at, "the widget block is missing").toBeGreaterThan(
      lines.indexOf("/*"),
    );
    expect(lines.slice(at + 1, at + 5)).toEqual([
      "  ! Content-Security-Policy",
      `  Content-Security-Policy: ${EMBED_CSP}`,
      "  ! X-Robots-Tag",
      "  X-Robots-Tag: noindex, nofollow",
    ]);
  });
});

test.describe("what the campsite pastes", () => {
  const snippet = embedSnippet({
    address: ADDRESS,
    siteUrl: "https://camptribe.eu",
    title: 'Camp "X"',
    linkText: "Camp <X> on CampTribe",
  });

  test("a sandboxed frame that may open a tab and do nothing else", () => {
    expect(snippet).toContain(
      'src="https://camptribe.eu/embed/camping/hr/istria/camp-x"',
    );
    const sandbox = /sandbox="([^"]*)"/.exec(snippet)?.[1].split(" ");
    expect(sandbox).toEqual(["allow-popups", "allow-popups-to-escape-sandbox"]);
    expect(snippet).toContain('referrerpolicy="no-referrer"');
    expect(snippet).toContain('loading="lazy"');
    expect(snippet).not.toMatch(/<script/i);
  });

  test("🔴 and a plain link OUTSIDE the frame — the part that is a link at all", () => {
    const after = snippet.slice(snippet.indexOf("</iframe>"));
    expect(after).toContain(
      '<a href="https://camptribe.eu/camping/hr/istria/camp-x">Camp &lt;X&gt; on CampTribe</a>',
    );
    expect(snippet).toContain('title="Camp &quot;X&quot;"');
  });
});
