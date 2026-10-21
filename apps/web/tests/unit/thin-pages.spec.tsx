import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import CampingIndex from "@/app/camping/page";
import { GET as llmsTxt } from "@/app/llms.txt/route";
import MapPage from "@/app/map/page";
import RoutePage from "@/app/routes/[slug]/page";
import RoutesIndex from "@/app/routes/page";
import SearchPage from "@/app/search/page";
import MapEmbed from "@/components/map-embed";
import RouteMapEmbed from "@/components/route-map-embed";
import { memberState, memberStateCount } from "@/lib/campsite-count";
import { CURATED_ROUTES } from "../../src/data/routes";
import { CAMPSITES_PER_STAGE, STAGE_RADIUS_M } from "../../src/lib/routes";
import {
  SERVICE_KINDS,
  SERVICE_LABEL,
  SERVICE_RADIUS_M,
} from "../../src/lib/route-services";
import { renderAsyncComponent, renderComponent } from "./render-component";
import { everythingSaid, visibleText } from "./rendered-text";

// CAMP-240 — /routes, /tools and /search were "thin". What they now carry
// is checked here, and every check reads the HTML a reader is served.
//
// 🔴 NOT A CONSTANT, NOT A CLASS, NOT AN `sr-only` CAPTION. A breadcrumb
// "exists" when a visible `<nav>` holds links to the pages above this one;
// a distance "has its label" when the card a reader sees says so in
// words; a count of countries is right when the sentence says it. The
// two helpers that read a page are `visibleText` (what a sighted reader
// is shown, hidden elements removed first) and `everythingSaid` (every
// tag a space, which is how block-level spans read).
//
// 🔴 THE EVIDENCE IS NOT MADE OF THE THING MEASURED. Three places where
// that was a risk, and what stands in for the shared field:
//   · the card's distance is compared with a haversine written in THIS
//     file, not with `straightLineLabel`, which produced it;
//   · the member-state count is compared with the EU-27 file the API
//     workspace owns (`eu-member-states.json`), not with the table the
//     function reads;
//   · the catalogue's account of what stands behind a stop is compared
//     with the route page's own sentence about the same thing, rendered
//     separately.

// ── reading a rendered page ──────────────────────────────────────────────

const ABS = (path: string) => `https://camptribe.eu${path}`;

/** Every JSON-LD block in a page, parsed. An unparseable one is a failure. */
function jsonLd(html: string): Record<string, unknown>[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
}

interface Crumb {
  name: string;
  path: string;
}

/** The breadcrumb a crawler is told about. */
function markedUpCrumbs(html: string): Crumb[] {
  const list = jsonLd(html).find((b) => b["@type"] === "BreadcrumbList");
  if (!list) return [];
  const items = list.itemListElement as {
    position: number;
    name: string;
    item: string;
  }[];
  // Positions from 1 and without gaps, or Google drops the whole list.
  items.forEach((it, i) => expect(it.position).toBe(i + 1));
  return items.map((it) => ({
    name: it.name,
    path: new URL(it.item).pathname,
  }));
}

/**
 * The breadcrumb a reader is shown: every link in the `<nav
 * aria-label="Breadcrumb">`, then the page itself as the last, unlinked,
 * item. `null` when there is no such nav.
 */
function shownCrumbs(html: string): { text: string; links: Crumb[] } | null {
  const nav = /<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/.exec(
    html,
  );
  if (!nav) return null;
  const links = [
    ...nav[0].matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g),
  ].map((m) => ({ name: visibleText(m[2]), path: m[1] }));
  // `visibleText` of the nav alone: a nav hidden with `hidden` or `sr-only`
  // reads as '' here, which is what a sighted reader gets.
  const text = visibleText(nav[0]).replace(/\s*\/\s*/g, " / ");
  return { text, links };
}

const render = {
  routes: () => renderComponent(RoutesIndex, {}),
};

/** The countries as the API emitted them, captured 15.10.2026. */
const API_COUNTRIES: { country: string; spots: number; regions: number }[] =
  JSON.parse(
    readFileSync(
      join(__dirname, "fixtures", "api-spots-countries.json"),
      "utf8",
    ),
  );

/** `fetch` swapped for one test, always put back. */
async function withFetch(
  impl: (url: string) => Response,
  run: () => Promise<void>,
) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) =>
    Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

async function renderSearch(): Promise<string> {
  let html = "";
  await withFetch(
    (url) => {
      // Raw, as the API answers: the page does its own counting.
      if (url.endsWith("/spots/summary")) {
        return json({
          spots: 52_501,
          countries: API_COUNTRIES.length,
          regions: 806,
        });
      }
      if (url.endsWith("/spots/countries")) return json(API_COUNTRIES);
      // CAMP-364: llms.txt і карта сайту питають дописи. Порожній
            // перелік — це «блог порожній», і саме так тут і є.
            if (url.includes("/posts")) return json({ posts: [] });
      throw new Error(`unexpected request in a unit test: ${url}`);
    },
    async () => {
      html = await renderAsyncComponent(SearchPage, {});
    },
  );
  return html;
}

// 🔴 The readers are tested before anything is read with them: were
// `jsonLd` to return [] or `shownCrumbs` to return null for every page,
// each assertion below that says "there is no X" would pass over a page
// that has one.
test.describe("the readers are not blind", () => {
  test("jsonLd finds the blocks on a page that has them", () => {
    const blocks = jsonLd(render.routes());
    expect(blocks.map((b) => b["@type"]).sort()).toEqual(
      ["BreadcrumbList", "CollectionPage"].sort(),
    );
  });

  test("shownCrumbs finds a nav, and reads nothing from one that is hidden", () => {
    const nav =
      '<nav aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li>/</li><li aria-current="page">Here</li></ol></nav>';
    expect(shownCrumbs(nav)?.text).toBe("Home / Here");
    expect(
      shownCrumbs(nav.replace("<nav ", '<nav class="sr-only" '))?.text,
    ).toBe("");
    expect(shownCrumbs("<main>no nav here</main>")).toBeNull();
  });
});

// ── 1. THE BREADCRUMB: WHAT A READER SEES IS WHAT A CRAWLER IS TOLD ──────

const PAGES: {
  name: string;
  path: string;
  html: () => Promise<string> | string;
  last: string;
}[] = [
  { name: "/routes", path: "/routes", html: render.routes, last: "Routes" },
  { name: "/search", path: "/search", html: renderSearch, last: "Search" },
];

for (const page of PAGES) {
  test.describe(`${page.name}: the breadcrumb`, () => {
    test("🔴 a visible trail, home to this page, and the same trail in the JSON-LD", async () => {
      const html = await page.html();
      const marked = markedUpCrumbs(html);
      const shown = shownCrumbs(html);

      expect(
        marked.length,
        "no BreadcrumbList in the JSON-LD",
      ).toBeGreaterThanOrEqual(2);
      expect(shown, "markup with no visible trail").not.toBeNull();

      // The trail a reader reads is the trail a crawler is told.
      expect(shown!.text).toBe(marked.map((c) => c.name).join(" / "));
      // Home first, this page last.
      expect(marked[0]).toEqual({ name: "CampTribe", path: "/" });
      expect(marked[marked.length - 1]).toEqual({
        name: page.last,
        path: page.path,
      });
      // Every crumb but the last is a link, to the page the markup names;
      // the last is the page itself and is not a link to itself.
      expect(shown!.links).toEqual(marked.slice(0, -1));
      expect(html).toContain('aria-current="page"');
    });

    test("🔴 the page’s own JSON-LD names the page’s own URL", async () => {
      // The `<link rel="canonical">` comes from Next's metadata and is
      // not in what a component renders; it is read off the served HTML
      // in tests/e2e/thin-pages.spec.ts. This is the half that is here.
      const html = await page.html();
      const named = jsonLd(html)
        .filter((b) => b["@type"] !== "BreadcrumbList")
        .map((b) => b["url"]);
      expect(named).toContain(ABS(page.path));
    });
  });
}

// ── 2. /tools — ПЕРЕЇХАЛО В `tests/e2e/tools.spec.ts` ───────────────────
//
// 🔴 CAMP-365 забрала текст цієї сторінки в CMS, тож компонент став
// асинхронним і синхронний рендер на ньому падає. Усі чотири сторожі
// живі — вони читають живу сторінку, тобто сильніше: не «компонент
// містить рядок», а «читач це бачить».
//
// Переїхало без втрат: два інструменти й три їхні рядки, колекція
// JSON-LD, рівно 27 паливних країн проти `eu-member-states.json`, і
// звірка «кожен вхід, який називає вступ, є полем на самому
// інструменті». Додано сторож на живу підстановку дати бюлетеня.

// ── 3. /routes ───────────────────────────────────────────────────────────

/** Great-circle km, written here so the card is not checked against itself. */
const R_KM = 6371.0088;
function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

test.describe("/routes", () => {
  const html = render.routes();

  /** One route's card, as a reader reads it. */
  const card = (slug: string): string => {
    const m = new RegExp(
      `<a\\b[^>]*href="/routes/${slug}"[^>]*>([\\s\\S]*?)</a>`,
    ).exec(html);
    expect(m, `no card for ${slug}`).not.toBeNull();
    return everythingSaid(m![1])[1];
  };

  test("every route has a card linking to its page", () => {
    const links = [...html.matchAll(/href="\/routes\/([a-z0-9-]+)"/g)].map(
      (m) => m[1],
    );
    expect(links.sort()).toEqual(CURATED_ROUTES.map((r) => r.slug).sort());
  });

  test("🔴 every card prints its distance, and the distance is the sum of straight lines, and says so", () => {
    for (const r of CURATED_ROUTES) {
      const said = card(r.slug);
      const m = /([\d,]+) km in a straight line/.exec(said);
      expect(
        m,
        `${r.slug}: no labelled distance on the card — "${said}"`,
      ).not.toBeNull();

      let expected = 0;
      for (let i = 1; i < r.stages.length; i++) {
        expected += haversineKm(r.stages[i - 1], r.stages[i]);
      }
      const shown = Number(m![1].replace(/,/g, ""));
      expect(
        Math.abs(shown - expected),
        `${r.slug}: card says ${shown} km, the stops say ${expected.toFixed(1)}`,
      ).toBeLessThanOrEqual(1);

      // 🔴 The only `km` on the card is the labelled one. A second,
      // unlabelled figure beside it is the one a reader takes for a drive.
      expect(
        (said.match(/\bkm\b/g) ?? []).length,
        `${r.slug}: another km on the card`,
      ).toBe(1);
    }
  });

  test("every card says who the route suits, in the filter’s own words", () => {
    for (const r of CURATED_ROUTES) {
      expect(card(r.slug), r.slug).toMatch(/Suits: [A-Z]/);
    }
  });

  test("🔴 the catalogue’s own words promise no hours at the wheel and no money", () => {
    // The design's catalogue promises both ("2–4 hours behind the wheel",
    // "fuel ≈ €84"). We have no routing engine, so neither exists. A
    // property of what WE wrote, not a list of banned phrases: none of
    // our figures is a duration or a price.
    //
    // 🔴 What is read is the lead, the facts line of every card, and the
    // section at the foot — NOT each route's `summary`, which is editorial
    // prose about the ground ("a 40-minute ferry") and a different kind
    // of statement from a figure on a card. They are cut out, and cut out
    // provably: a summary that was not found in its card would mean this
    // test had scanned the wrong text.
    let scanned = "";
    for (const r of CURATED_ROUTES) {
      const said = card(r.slug);
      const parts = said.split(r.summary.replace(/\s+/g, " ").trim());
      expect(
        parts.length,
        `${r.slug}: the summary is not on its card verbatim`,
      ).toBe(2);
      scanned += ` ${parts.join(" ")}`;
    }
    const section =
      /<section\b[^>]*aria-labelledby="how-heading"[\s\S]*?<\/section>/.exec(
        html,
      );
    expect(
      section,
      'no "how these routes are put together" section',
    ).not.toBeNull();
    scanned += ` ${everythingSaid(section![0])[1]}`;
    scanned += ` ${everythingSaid(/<h1\b[\s\S]*?<p\b[\s\S]*?<\/p>/.exec(html)![0])[1]}`;

    expect(scanned).not.toMatch(
      /\d\s*(?:h|hr|hrs|hours?|min|mins|minutes?)\b/i,
    );
    expect(scanned).not.toMatch(/\bhours?\b/i);
    expect(scanned).not.toMatch(/[€≈]|\beuros?\b/i);
  });

  test("🔴 it says what is not here, in the place a reader comparing routes looks", () => {
    const text = visibleText(html);
    expect(text).toContain("What is not here yet");
    for (const missing of [
      "road distances and driving times",
      "height, width or weight of your vehicle",
      "what the fuel will cost",
      "sum of the straight lines",
    ]) {
      expect(text, `the hub does not say: ${missing}`).toContain(missing);
    }
  });

  test("🔴 the word on the page for how many routes there are is the number there are", () => {
    // "Twelve routes", "twelve rather than fifty" are typed. Add a
    // thirteenth route and they say a thing that is no longer true.
    const word = NUMBER_WORDS[CURATED_ROUTES.length];
    expect(word, "more routes than the word list has words for").toBeDefined();
    const text = visibleText(html).toLowerCase();
    expect(text).toContain(`${word} routes through the european union`);
    expect(text).toContain(`${word} rather than fifty`);
  });

  test("🔴 what it says stands behind each stop is what the route page says, rendered separately", async () => {
    const catalogue =
      /up to (\d+) campsites from our database within (\d+) km of it, nearest first, and the nearest recorded example of each of (\d+) kinds of service/.exec(
        visibleText(html),
      );
    expect(
      catalogue,
      "the catalogue no longer says what stands behind a stop",
    ).not.toBeNull();

    const route = CURATED_ROUTES[0];
    let page = "";
    await withFetch(
      (url) => {
        if (url.includes("/routes/near")) {
          return json({
            groups: route.stages.map((s) => ({
              lat: s.lat,
              lon: s.lon,
              spots: [],
            })),
            perPoint: CAMPSITES_PER_STAGE,
            radiusMetres: STAGE_RADIUS_M,
            returned: 0,
          });
        }
        if (url.includes("/routes/services")) {
          return json({
            groups: route.stages.map((s) => ({
              lat: s.lat,
              lon: s.lon,
              services: [],
            })),
            radiusMetres: SERVICE_RADIUS_M,
            perKind: 1,
            returned: 0,
            truncated: false,
          });
        }
        // CAMP-364: llms.txt і карта сайту питають дописи. Порожній
              // перелік — це «блог порожній», і саме так тут і є.
              if (url.includes("/posts")) return json({ posts: [] });
        throw new Error(`unexpected request in a unit test: ${url}`);
      },
      async () => {
        page = visibleText(
          await renderAsyncComponent(
            RoutePage,
            { params: Promise.resolve({ slug: route.slug }) },
            { omit: [RouteMapEmbed] },
          ),
        );
      },
    );
    const stop =
      /shows up to (\d+) campsites from our database within (\d+) km of it, nearest first, and the nearest single example of each of (\d+) kinds of service/.exec(
        page,
      );
    expect(
      stop,
      "the route page no longer says what stands behind a stop",
    ).not.toBeNull();
    expect(catalogue!.slice(1)).toEqual(stop!.slice(1));
    // And the third number is the closed list's length, not a literal.
    expect(Number(catalogue![3])).toBe(SERVICE_KINDS.length);

    // 🔴 The number is one thing and the list after it is another, and a
    // page can keep the first while the second shrinks ("7 kinds of
    // service: fuel."). Two checks, neither against the constant that
    // built the sentence: the list is as long as the number says, and
    // every kind the ROUTE PAGE labels in its stop blocks is in it.
    const listed = /kinds of service: ([^.]+)\./.exec(visibleText(html));
    expect(listed, "the catalogue names no kinds of service").not.toBeNull();
    expect(listed![1].split(", ").length).toBe(Number(catalogue![3]));
    for (const label of Object.values(SERVICE_LABEL)) {
      expect(page, `the route page no longer labels "${label}"`).toContain(
        label,
      );
      expect(
        listed![1].toLowerCase(),
        `the route page labels "${label}" and the catalogue does not name it`,
      ).toContain(label.toLowerCase());
    }
  });
});

// ── 4. /search ───────────────────────────────────────────────────────────

test.describe("/search", () => {
  test("🔴 the source emits 28 codes and the page says 27 countries", async () => {
    // The corpus: what `/spots/countries` answered on 15.10.2026, code for
    // code. 28 entries — the 27 member states and `ax`, Åland.
    expect(API_COUNTRIES.length).toBe(28);
    expect(API_COUNTRIES.map((c) => c.country)).toContain("ax");

    const text = visibleText(await renderSearch());
    expect(text).toContain("across 27 countries");
    expect(text).not.toContain("28 countries");
  });

  test("🔴 folded, the source’s codes ARE the EU-27 — compared with the API workspace’s own file", () => {
    const members = Object.keys(
      (
        JSON.parse(
          readFileSync(
            join(
              process.cwd(),
              "..",
              "api",
              "src",
              "osm",
              "eu-member-states.json",
            ),
            "utf8",
          ),
        ) as { members: Record<string, string> }
      ).members,
    ).sort();
    expect(members.length).toBe(27);

    const folded = [
      ...new Set(API_COUNTRIES.map((c) => memberState(c.country))),
    ].sort();
    // Equality of the SETS, not of their sizes: a code that is neither a
    // member state nor an alias of one is a failure here, and so is a
    // member state the source stopped emitting.
    expect(folded).toEqual(members);
    expect(memberStateCount(API_COUNTRIES.map((c) => c.country))).toBe(27);
  });

  test("the count counts member states, not codes", () => {
    expect(memberStateCount(["fi", "ax"])).toBe(1);
    expect(memberStateCount(["ax"])).toBe(1);
    expect(memberStateCount(["FI", "AX", "fr"])).toBe(2);
    // A code nobody has told us about is a country of its own — the
    // number rises, it does not silently fold away.
    expect(memberStateCount(["fi", "ax", "xx"])).toBe(2);
    expect(memberStateCount([])).toBe(0);
  });

  test("🔴 it says the box searches campsites only, and where the rest of the site is", async () => {
    const html = await renderSearch();
    const text = visibleText(html);
    expect(text).toContain("This box searches campsites only");
    for (const href of ["/map", "/routes", "/guides", "/tools"]) {
      expect(html, `no way out to ${href}`).toContain(`href="${href}"`);
    }
    // The count of routes on offer is the count there are.
    expect(text).toContain(`${CURATED_ROUTES.length} curated routes`);
  });

  test("every country chip carries a thousands separator, like the lead does", async () => {
    const text = visibleText(await renderSearch());
    expect(text).toContain("France · 17,915");
    expect(text).not.toMatch(/France · 17915/);
  });
});

// ── 5. /camping, /map and llms.txt — the same count, three more surfaces ─

// 🔴 CAMP-240 fixed the sentence on /search and left three copies of it
// standing. `countries.length` is the length of the list `/spots/countries`
// answers with, and that list carries `ax` — Åland, a self-governing
// region of Finland with 19 campsites and an ISO code of its own. So each
// of these three said "28 countries" on a site whose scope is the EU-27:
// two of them inside JSON-LD, where no reader would ever catch it, and
// one in the file assistants read and quote.
//
// 🔴 THE EXPECTED NUMBER IS NOT THE FUNCTION'S. It is the length of
// `eu-member-states.json`, the file the API workspace owns — so a table
// here that quietly folded two member states together would fail rather
// than agree with itself. And every check reads the number OUT of what
// the surface serves, rather than asserting the absence of "28": a page
// that rendered nothing at all satisfies "does not say 28", which is how
// a check like this goes green over a blank page.

/** The EU-27, counted from the file the API workspace keeps. */
const EU_MEMBERS: number = Object.keys(
  (
    JSON.parse(
      readFileSync(
        join(process.cwd(), "..", "api", "src", "osm", "eu-member-states.json"),
        "utf8",
      ),
    ) as { members: Record<string, string> }
  ).members,
).length;

/** The campsites the fixture holds — what each surface should still total. */
const FIXTURE_SPOTS = API_COUNTRIES.reduce((n, c) => n + c.spots, 0);

/** The `description` of the CollectionPage a page marks itself up as. */
function collectionDescription(html: string): string {
  const block = jsonLd(html).find((b) => b["@type"] === "CollectionPage");
  expect(block, "the page carries no CollectionPage JSON-LD").toBeTruthy();
  return String(block!.description);
}

/** Every URL the CollectionPage's item list names. */
function collectionItemPaths(html: string): string[] {
  const block = jsonLd(html).find((b) => b["@type"] === "CollectionPage");
  const list = (block!.mainEntity as { itemListElement: { url: string }[] })
    .itemListElement;
  return list.map((it) => new URL(it.url).pathname);
}

/**
 * The number a surface prints in "across N countries".
 *
 * 🔴 Returns the number or fails. A regex that did not match would
 * otherwise make every assertion below it vacuous.
 */
function countriesSaid(text: string, where: string): number {
  const m = /across (\d+) (?:countries|country)/.exec(text);
  expect(
    m,
    `${where} no longer says how many countries it covers`,
  ).not.toBeNull();
  return Number(m![1]);
}

/** /camping, rendered against the raw fixture. */
async function renderCamping(): Promise<string> {
  let html = "";
  await withFetch(
    (url) => {
      if (url.endsWith("/spots/countries")) return json(API_COUNTRIES);
      // CAMP-364: llms.txt і карта сайту питають дописи. Порожній
            // перелік — це «блог порожній», і саме так тут і є.
            if (url.includes("/posts")) return json({ posts: [] });
      throw new Error(`unexpected request in a unit test: ${url}`);
    },
    async () => {
      html = await renderAsyncComponent(CampingIndex, {});
    },
  );
  return html;
}

/** /map, rendered against the raw fixture. The canvas is left out. */
async function renderMap(): Promise<string> {
  let html = "";
  await withFetch(
    (url) => {
      // The map draws the campsites with no region too, which is why the
      // page asks a second endpoint — and why its own two numbers differ.
      if (url.endsWith("/spots/map/regions")) {
        return json([{ slug: "r1", count: FIXTURE_SPOTS + 135 }]);
      }
      if (url.endsWith("/spots/countries")) return json(API_COUNTRIES);
      // CAMP-364: llms.txt і карта сайту питають дописи. Порожній
            // перелік — це «блог порожній», і саме так тут і є.
            if (url.includes("/posts")) return json({ posts: [] });
      throw new Error(`unexpected request in a unit test: ${url}`);
    },
    async () => {
      html = await renderAsyncComponent(MapPage, {}, { omit: [MapEmbed] });
    },
  );
  return html;
}

/** /llms.txt, served as a crawler receives it. */
async function renderLlmsTxt(): Promise<string> {
  let body = "";
  await withFetch(
    (url) => {
      if (url.endsWith("/spots/countries")) return json(API_COUNTRIES);
      if (/\/spots\/[a-z]{2}\/regions(\?|$)/.test(url)) return json([]);
      if (url.endsWith("/guides")) return json([]);
      // CAMP-364: llms.txt і карта сайту питають дописи. Порожній
            // перелік — це «блог порожній», і саме так тут і є.
            if (url.includes("/posts")) return json({ posts: [] });
      throw new Error(`unexpected request in a unit test: ${url}`);
    },
    async () => {
      body = await (await llmsTxt()).text();
    },
  );
  return body;
}

test.describe("the count of countries, on every surface that prints one", () => {
  test("🔴 the fixture can still tell the two numbers apart", () => {
    // Without this, a fixture trimmed to 27 member states would make
    // every test below pass while the defect was still in the code.
    expect(EU_MEMBERS).toBe(27);
    expect(API_COUNTRIES.length).toBe(28);
    expect(API_COUNTRIES.map((c) => c.country)).toContain("ax");
    expect(API_COUNTRIES.length).toBeGreaterThan(EU_MEMBERS);
  });

  test("🔴 /camping marks itself up as 27 countries, not 28", async () => {
    const html = await renderCamping();
    const description = collectionDescription(html);
    expect(countriesSaid(description, "/camping")).toBe(EU_MEMBERS);
    expect(description).toContain(`${FIXTURE_SPOTS} campsites`);
  });

  test("/camping still lists Åland — only the COUNT changed", async () => {
    const html = await renderCamping();
    const paths = collectionItemPaths(html);
    // Every code gets a link, Åland included: it has 19 campsites and a
    // page of its own. Folding it away from the LIST would lose them.
    expect(paths.length).toBe(API_COUNTRIES.length);
    expect(paths).toContain("/camping/ax");
    const text = visibleText(html);
    expect(text).toContain("Åland Islands");
    expect(html).toContain('href="/camping/ax"');
  });

  test("🔴 /map marks itself up as 27 countries, not 28", async () => {
    const html = await renderMap();
    const description = collectionDescription(html);
    expect(countriesSaid(description, "/map")).toBe(EU_MEMBERS);
    // The campsite figure beside it is the browsable one, unchanged.
    expect(description).toContain(
      `${FIXTURE_SPOTS.toLocaleString("en-GB")} campsites`,
    );
  });

  test("/map still links Åland in the list below the canvas", async () => {
    const html = await renderMap();
    expect(collectionItemPaths(html)).toContain("/camping/ax");
    expect(html).toContain('href="/camping/ax"');
  });

  test("🔴 llms.txt tells an assistant 27 countries, not 28", async () => {
    const body = await renderLlmsTxt();
    expect(countriesSaid(body, "llms.txt")).toBe(EU_MEMBERS);
    // The plural branch is chosen from the same number it prints.
    expect(body).toMatch(/across 27 countries,/);
    expect(body).toContain(`**${FIXTURE_SPOTS} campsites**`);
  });

  test('llms.txt still points at Åland under "Start here"', async () => {
    const body = await renderLlmsTxt();
    // One line per code, Åland included — an assistant that is told we
    // cover 27 countries must still be able to reach all 28 pages.
    expect(body).toContain("/camping/ax)");
    expect(body).toContain("Åland Islands");
    const starts = body.split("## Start here")[1] ?? "";
    expect(
      starts.split("\n").filter((l) => l.startsWith("- [Campsites in ")).length,
    ).toBe(API_COUNTRIES.length);
  });
});
