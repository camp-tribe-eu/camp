import { headers } from "next/headers";
import { apiFetch } from "./api";
import { PATH_HEADER } from "./path-header";

/**
 * Tell the API that a request found nothing. CAMP-235.
 *
 * 🔴 WHY THIS IS SERVER-SIDE AND NOT A BEACON FROM THE BROWSER.
 * The readers who matter most here do not run JavaScript. A crawler
 * following a link into a rebuilt slug is exactly the hit this report
 * exists to catch, and a client-side beacon would miss every one of
 * them — leaving a log of the people who already found their way back,
 * and none of the search engines quietly dropping our pages.
 *
 * 🔴 It never throws and never blocks the page. A 404 that errors
 * because its own logging failed is worse than a 404 that logs nothing:
 * the reader came here already having missed, and the one job left is
 * to show them the way out.
 *
 * 🔴 No cookie, no identifier, nothing joining two requests. The API
 * strips the query from both the path and the referrer before storing —
 * see apps/api/src/telemetry/not-found.rules.ts, which says why — and
 * the table's CHECK constraints refuse a row that still has one. The
 * consent banner says "no analytics or advertising cookies" and this
 * must not be the thing that makes that untrue.
 *
 * It goes through `apiFetch`, so it carries the build token and is
 * exempt from the rate limit — which matters: every one of these comes
 * from OUR server, so they share a single caller, and the ordinary
 * 120-a-minute budget would silence the log precisely when a crawler is
 * working through a batch of dead URLs.
 */
export async function reportNotFound(): Promise<void> {
  try {
    const h = await headers();
    const path = h.get(PATH_HEADER);
    // 🔴 No path, no row — and no guess. The header is set by the
    // middleware, so its absence means this 404 came from outside the
    // matcher (a guide, a tool, a typo at the root). Inventing a path
    // would put a wrong URL at the top of a report whose only purpose is
    // deciding where a 301 goes.
    if (!path) return;
    await apiFetch("/not-found", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, referrer: h.get("referer") }),
      cache: "no-store",
    });
  } catch {
    /* A 404 must still render. */
  }
}
