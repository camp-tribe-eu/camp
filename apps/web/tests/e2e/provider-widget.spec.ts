import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  API_BASE,
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "./api-request";
import {
  embedSnippet,
  WIDGET_BUDGET_BYTES,
  widgetPath,
  campsitePath,
  type WidgetAddress,
} from "../../src/lib/provider-widget";
import { isUnpublishedCountry } from "../../src/lib/unpublished-countries";
import { EMBED_HEADERS } from "../../scripts/embed-policy.mjs";
import { SECURITY_HEADERS } from "../../scripts/security-headers.mjs";

// CAMP-523 — the widget a campsite embeds on its own website.
//
// 🔴 EVERYTHING HERE READS WHAT WAS SERVED. The card's three checks —
// under the weight budget, no cookies, works without JavaScript — are
// statements about a response and a browser, so each is asked of a
// response or of a browser, on a page of ANOTHER origin, the way a
// campsite's website would hold it. The unit spec next door holds the
// string; this one holds the claim.

// 🔴 NO TRACE IN THIS FILE, AND IT IS NOT A CONVENIENCE.
//
// The trace recorder takes its snapshots by running script in every
// frame. The widget's frame is sandboxed without `allow-scripts`, so
// Chromium and WebKit report each attempt as
//
//   Blocked script execution in '…/embed/camping/…' because the
//   document's frame is sandboxed and the 'allow-scripts' permission is
//   not set.
//
// — eight console errors per run, made by the HARNESS, on a document that
// carries no script. Measured 13.11.2026: the same host page in a plain
// browser gives zero console lines, before and after reading the frame.
// Filtering that sentence out of the assertion would also hide a script
// of OURS being blocked, so the recorder is off instead and "no console
// error" means none. (Playwright allows this setting only file-wide.)
test.use({ trace: "off" });

type IndexEntry = WidgetAddress;

async function campsites(request: APIRequestContext): Promise<IndexEntry[]> {
  const res = await request.get(`${API_BASE}/spots/index`);
  expect(res.ok(), "GET /spots/index").toBe(true);
  const all = (await res.json()) as IndexEntry[];
  return all.filter((s) => !isUnpublishedCountry(s.country));
}

/**
 * Serve `body` as a campsite's own page, from a real second origin, and
 * open it. Returns the function that stops the server.
 *
 * 🔴 A REAL SERVER ON 127.0.0.1, NOT `page.route` ON A MADE-UP HOST, and
 * the first version of this spec is why. A fulfilled route has no
 * address, Chromium files it under "public", and its Local Network
 * Access check then refuses ANY frame pointing at localhost:
 *
 *   net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS
 *
 * So the widget did not render — and, far worse, "the campsite page
 * cannot be framed" PASSED, for a reason that had nothing to do with our
 * policy. `127.0.0.1:<port>` against `localhost:3000` is a different
 * origin and a different site, and both are loopback, so the only thing
 * left to refuse a frame is the header under test.
 */
async function openProviderPage(page: Page, body: string) {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<!doctype html><html><head><title>Our campsite</title></head><body><h1>Our campsite</h1>${body}</body></html>`,
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await page.goto(`http://127.0.0.1:${port}/`);
  return () => new Promise<void>((done) => server.close(() => done()));
}

test.describe("the widget, as served", () => {
  test("🔴 every campsite: 200, under the budget, no cookie, no script, no second file", async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const all = await campsites(request);
    // The denominator. "Nothing over budget" across zero widgets is not a result.
    expect(all.length, "campsites in the index").toBeGreaterThan(50);

    let withRows = 0;
    let withoutRows = 0;
    let heaviest = 0;
    for (const address of all) {
      const res = await request.get(`${baseURL}${widgetPath(address)}`);
      const where = widgetPath(address);
      expect(res.status(), where).toBe(200);

      const body = await res.body();
      heaviest = Math.max(heaviest, body.length);
      expect(body.length, `${where} is over the budget`).toBeLessThan(
        WIDGET_BUDGET_BYTES,
      );

      const names = res.headersArray().map((h) => h.name.toLowerCase());
      expect(names, `${where} sets a cookie`).not.toContain("set-cookie");

      const html = body.toString("utf8");
      for (const mark of [
        "<script",
        "<img",
        "<link",
        "<iframe",
        "src=",
        "url(",
        "@import",
      ]) {
        expect(html, `${where} carries ${mark}`).not.toContain(mark);
      }
      // The link the whole thing exists for, to the page of THIS campsite.
      expect(html, where).toMatch(
        new RegExp(
          `<a href="https?://[^"/]+${campsitePath(address).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" target="_blank" rel="noopener">`,
        ),
      );

      if (html.includes("<ul>")) {
        withRows += 1;
        // Figures on screen ⇒ their source on screen.
        expect(html, where).toContain("OpenStreetMap");
      } else {
        withoutRows += 1;
        expect(
          html,
          `${where} draws neither rows nor the words for none`,
        ).toMatch(/<\/h1><p>[^<]+<\/p><p><a /);
        expect(html, where).not.toContain("<small");
      }
    }
    // Both branches must have been exercised by real campsites, or the
    // assertions inside them never ran.
    expect(withRows, "widgets with measured rows").toBeGreaterThan(0);
    expect(withoutRows, "widgets with nothing measured").toBeGreaterThan(0);
    console.log(
      `widgets: ${all.length} served, ${withRows} with rows, ${withoutRows} without, heaviest ${heaviest} B of ${WIDGET_BUDGET_BYTES}`,
    );
  });

  test("🔴 it is served under its own policy, and only it is", async ({
    request,
    baseURL,
  }) => {
    const [address] = await campsites(request);
    const widget = (
      await request.get(`${baseURL}${widgetPath(address)}`)
    ).headers();
    expect(widget["content-security-policy"]).toBe(
      EMBED_HEADERS["Content-Security-Policy"],
    );
    expect(widget["content-security-policy"]).toContain("frame-ancestors *");
    expect(widget["x-robots-tag"]).toBe("noindex, nofollow");
    // The rest of the site-wide set still arrives.
    for (const name of [
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ] as const) {
      expect(widget[name.toLowerCase()], name).toBe(SECURITY_HEADERS[name]);
    }

    // 🔴 The exception is one path wide. The campsite page, the manual
    // and the home page still refuse every frame.
    for (const path of [campsitePath(address), "/widget", "/"]) {
      const res = await request.get(`${baseURL}${path}`);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-security-policy"], path).toBe(
        SECURITY_HEADERS["Content-Security-Policy"],
      );
      expect(res.headers()["content-security-policy"], path).toContain(
        "frame-ancestors 'none'",
      );
    }
  });

  // The unpublished-country gate is held in the unit spec, with a campsite
  // that EXISTS there: this fixture has none, so asking here would pass
  // whether or not the gate did.
  test("a campsite we do not have is a plain 404 with no cookie", async ({
    request,
    baseURL,
  }) => {
    const [known] = await campsites(request);
    const address = { ...known, slug: "no-such-campsite-anywhere" };
    const res = await request.get(`${baseURL}${widgetPath(address)}`);
    expect(res.status(), widgetPath(address)).toBe(404);
    expect(res.headers()["content-type"]).toContain("text/plain");
    expect(res.headersArray().map((h) => h.name.toLowerCase())).not.toContain(
      "set-cookie",
    );
  });
});

test.describe("the widget, on a campsite’s own website", () => {
  /** A campsite whose widget has rows, found by asking. */
  async function withRows(request: APIRequestContext, baseURL: string) {
    for (const address of await campsites(request)) {
      const html = await (
        await request.get(`${baseURL}${widgetPath(address)}`)
      ).text();
      const name = /<h1>([^<]+)<\/h1>/.exec(html)?.[1];
      if (html.includes("<ul>") && name && !name.includes("&"))
        return { address, name };
    }
    throw new Error("no campsite in the fixture has a widget with rows");
  }

  const snippetFor = (address: WidgetAddress, baseURL: string) =>
    embedSnippet({
      address,
      siteUrl: baseURL,
      title: "Around our campsite",
      linkText: "Our campsite on CampTribe",
    });

  // 🔴 ITS OWN CONTEXT, NOT THE SHARED `page` FIXTURE: the fixture adds an
  // init script to every frame, and see the note on `trace` at the top.
  test("🔴 it renders in a frame from another origin: one request, no cookie, styled, no console error", async ({
    browser,
    request,
    baseURL,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const { address, name } = await withRows(request, baseURL!);
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    const toUs: string[] = [];
    page.on("request", (r) => {
      if (r.url().startsWith(baseURL!)) toUs.push(r.url());
    });

    const stop = await openProviderPage(page, snippetFor(address, baseURL!));
    expect(
      new URL(page.url()).origin,
      "the host page must be another origin",
    ).not.toBe(new URL(baseURL!).origin);

    const frame = page.frameLocator("iframe");
    await expect(frame.locator("h1")).toHaveText(name);
    await expect(frame.locator("li").first()).toBeVisible();
    await expect(frame.locator("a")).toHaveAttribute(
      "href",
      new RegExp(`${campsitePath(address)}$`),
    );

    // 🔴 Styled ⇒ the hash in the policy matched the stylesheet in a real
    // browser. A mismatch leaves the text readable and black on white —
    // which no assertion about text would notice.
    await expect(frame.locator("h1")).toHaveCSS("color", "rgb(52, 61, 80)");
    await expect(frame.locator("ul")).toHaveCSS("list-style-type", "none");

    expect(toUs, "requests the visitor’s browser made to us").toEqual([
      `${baseURL}${widgetPath(address)}`,
    ]);
    expect(
      await context.cookies(),
      "cookies after viewing the widget in a frame",
    ).toEqual([]);

    // The link outside the frame is in the campsite's own markup.
    await expect(
      page.locator("body > p > a", { hasText: "Our campsite on CampTribe" }),
    ).toHaveAttribute("href", `${baseURL}${campsitePath(address)}`);
    await stop();
    await context.close();

    // 🔴 AND ONCE MORE AS A PAGE OF ITS OWN, IN A BROWSER THAT HAS NEVER
    // SEEN IT, because the jar above is empty for reasons that are not
    // ours. Measured 13.11.2026: with `Set-Cookie: seen=1; Path=/` added
    // to the route, the framed check above stayed green, and so did a
    // second visit in the same context. (Most likely: a cookie without
    // `SameSite=None; Secure` is dropped in a cross-site frame, and the
    // repeat visit is answered from the HTTP cache. The cause is my
    // reading; the two green runs are the measurement.) A first-party
    // visit in a fresh context went red on the same mutation, so this is
    // the check that reads our behaviour and not the browser's defences.
    const direct = await browser.newContext();
    const own = await direct.newPage();
    await own.goto(`${baseURL}${widgetPath(address)}`);
    await expect(own.locator("h1")).toHaveText(name);
    expect(
      await direct.cookies(),
      "cookies after opening the widget directly",
    ).toEqual([]);
    await direct.close();
  });

  test.describe("with JavaScript off", () => {
    test.use({ javaScriptEnabled: false });

    test("🔴 the same rows are there to read", async ({
      page,
      request,
      baseURL,
    }) => {
      const { address, name } = await withRows(request, baseURL!);
      const stop = await openProviderPage(page, snippetFor(address, baseURL!));
      const frame = page.frameLocator("iframe");
      await expect(frame.locator("h1")).toHaveText(name);
      await expect(frame.locator("li").first()).toBeVisible();
      await expect(frame.locator("small")).toContainText("OpenStreetMap");
      await expect(frame.locator("h1")).toHaveCSS("color", "rgb(52, 61, 80)");
      await stop();
    });
  });

  test("🔴 the campsite page itself still cannot be framed", async ({
    page,
    request,
    baseURL,
  }) => {
    const { address, name } = await withRows(request, baseURL!);
    // 🔴 TWO FRAMES ON ONE PAGE, and the second is the control. The
    // first is the widget's own snippet pointed at the ordinary campsite
    // page; the second is the widget. "Nothing rendered in the first" is
    // only a finding once the second HAS rendered on the same page — a
    // host page on which no frame works at all proves nothing, which is
    // exactly how this test once passed for the wrong reason.
    const blocked = snippetFor(address, baseURL!).replace(
      widgetPath(address),
      campsitePath(address),
    );
    expect(blocked).toContain(`src="${baseURL}${campsitePath(address)}"`);
    // 🔴 The refusal is read from the BROWSER, not from inside the frame:
    // each engine reports the refused document as a failed request
    // (measured 13.11.2026 — Firefox `SEC_ERROR_UNKNOWN`, WebKit
    // `cancelled`), and Firefox never answers a locator pointed into a
    // refused frame at all, so asking "is the heading in there" hangs
    // until the test times out instead of saying no.
    const refused = page.waitForEvent("requestfailed", {
      predicate: (r) => r.url() === `${baseURL}${campsitePath(address)}`,
      timeout: 20_000,
    });
    const stop = await openProviderPage(
      page,
      `${blocked}${snippetFor(address, baseURL!)}`,
    );
    await expect(page.locator("iframe")).toHaveCount(2);
    await expect(page.frameLocator("iframe >> nth=1").locator("h1")).toHaveText(
      name,
    );
    await refused;
    await stop();
  });
});

test.describe("the manual at /widget", () => {
  test.use({ javaScriptEnabled: false });

  test("prints the snippet a campsite copies, and what it does to their visitors", async ({
    page,
  }) => {
    await page.goto("/widget");
    const code = page.locator("[data-widget-snippet] pre code");
    await expect(code).toContainText('/embed/camping/COUNTRY/REGION/CAMPSITE"');
    await expect(code).toContainText(
      'sandbox="allow-popups allow-popups-to-escape-sandbox"',
    );
    await expect(code).toContainText('/camping/COUNTRY/REGION/CAMPSITE">');
    await expect(page.locator("main")).toContainText("sets no cookies");
    // The widget's own labels are not paragraphs of this page.
    await expect(page.locator("main")).not.toContainText(
      "Full page on CampTribe",
    );
  });
});

test.describe("the privacy policy, as served", () => {
  test.use({ javaScriptEnabled: false });

  test("🔴 /legal/privacy tells a visitor of a campsite’s website what reaches us", async ({
    page,
  }) => {
    await page.goto("/legal/privacy");
    const main = page.locator("main");
    await expect(main).toContainText("Our block on a campsite’s own website");
    await expect(main).toContainText(
      "your browser sends us one request, and that request becomes one line in the security log",
    );
    await expect(main).toContainText(
      "the address of the page that led you to us, when your browser sends one (the referrer)",
    );
    await expect(page.getByTestId("legal-version")).toContainText(
      "Version 2.9",
    );
  });
});
