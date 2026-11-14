import { getSpot } from "@/lib/api";
import { pageContent } from "@/lib/page-content";
import { buildWidget } from "@/lib/provider-widget";
import { SITE } from "@/lib/sitemap";

// CAMP-523 — the widget itself. Everything it prints is built in
// lib/provider-widget.ts; the policy it is served under is
// scripts/embed-policy.mjs, applied by next.config.mjs to `/embed/…`.
//
// 🔴 RENDERED ON REQUEST, NOT PRERENDERED, AND THAT IS A COST DECISION.
// Prerendering would add one more file per campsite to a build that is
// already 65 000 pages long, for a document most campsites will never
// embed. The two reads below are the same cached reads the campsite page
// makes (a day, `next: { revalidate }`), so a request here is string
// concatenation over data the server already holds.
//
// 🔴 NO `Set-Cookie`, EVER, and nothing here could produce one: the
// handler never touches `cookies()`, a session or the request's headers.
// It does not read the request at all — which is also why nothing about
// the visitor (address, referrer, user agent) can end up in the reply.

type Params = { country: string; region: string; slug: string };

export async function GET(
  _request: Request,
  ctx: { params: Promise<Params> },
): Promise<Response> {
  const reply = await buildWidget(await ctx.params, {
    getSpot,
    pageContent,
    siteUrl: SITE,
  });
  return new Response(reply.body, {
    status: reply.status,
    headers:
      reply.status === 200
        ? {
            "Content-Type": "text/html; charset=utf-8",
            // An hour in the visitor's browser: a returning visitor of
            // the campsite's site does not ask us again, which is both
            // lighter for them and one request fewer that reaches our log.
            "Cache-Control": "public, max-age=3600",
          }
        : {
            "Content-Type": "text/plain; charset=utf-8",
            // An error is not worth remembering: the campsite may be
            // imported next week, the words restored in a minute.
            "Cache-Control": "no-store",
          },
  });
}
