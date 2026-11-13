// CAMP-523: the widget a campsite puts on its own website.
//
// 🔴 A STRING, NOT A REACT TREE, AND THE REASON IS THE CARD'S BUDGET.
//
// A Next page — any Next page — ships the framework runtime and an RSC
// payload. Measured 13.11.2026 on the fixture build of this branch:
// `/widget`, a page with three paragraphs on it, references 11 script
// files, 602 231 bytes uncompressed; the widget for the same build is
// 1 077 to 1 552 bytes across all 72 campsites. On a campsite's website
// the first figure would be our weight on their page. The card asks for the
// opposite: light, no cookies, readable with JavaScript off. So the
// widget is one HTML document built here by hand and printed by a route
// handler: no script at all, one inline stylesheet, zero subresources.
//
// 🔴 EVERYTHING THAT IS NOT OURS IS ESCAPED. Campsite names and the
// names of lakes, towns and stations come from OpenStreetMap; the labels
// come from the CMS. Neither is trusted to be text. The CSP on this path
// would stop an injected script anyway (`default-src 'none'`), but a
// policy is the second line, not the first.
//
// 🔴 ONLY WHAT WE MEASURED. The rows are `aroundRows` — the same function
// the campsite page uses, over the same `context` — so a distance that is
// not a number is not a row here either, and the widget cannot say
// something the page does not. What the card also lists and this does NOT
// show, each for a stated reason (see the PR): a map (MapLibre alone is
// many times the budget), weather warnings (their licence wants them no
// older than ten minutes, which needs script), an accessibility profile
// and a route (we hold neither as measured data).

import { WIDGET_CSS } from "../../scripts/embed-policy.mjs";
import { SPOT_TYPE_LABEL, withOwnerOverrides, type Spot } from "./api";
import type { PageView, SectionView } from "./page-content";
import { aroundRows } from "./spot-facts";
import { isUnpublishedCountry } from "./unpublished-countries";

/** The CMS page that holds every word of the widget and of its manual. */
export const WIDGET_PAGE = "provider-widget";

/**
 * 🔴 THE BUDGET THE CARD ASKS TO BE "DEFINED": 14 000 BYTES, UNCOMPRESSED,
 * FOR EVERYTHING THE VISITOR'S BROWSER DOWNLOADS.
 *
 * Not a round number picked for comfort: ten TCP segments of 1 460 bytes
 * is the initial congestion window (RFC 6928), so a response under it
 * arrives in the first round trip even before compression. And because
 * the document has no subresources, "the document" and "everything" are
 * the same number — which is what makes the limit checkable at all.
 */
export const WIDGET_BUDGET_BYTES = 14_000;

/** The slots of `provider-widget` the widget itself reads. */
export const WIDGET_SLOTS = [
  "widget-heading",
  "widget-link",
  "widget-source",
  "widget-empty",
] as const;

export interface WidgetLabels {
  /** The line under the campsite's name, above the rows. */
  heading: string;
  /** The words of the link to the campsite's page on CampTribe. */
  link: string;
  /** Where the figures come from — the OpenStreetMap attribution. */
  source: string;
  /** What is said instead of rows when we measured nothing. */
  empty: string;
}

/**
 * The four labels, or `null` if ANY is missing.
 *
 * 🔴 All or nothing. A widget without its attribution line breaks the
 * licence of the data it shows; one without its "nothing measured" line
 * would have to draw an empty box. Neither is a state worth rendering,
 * so the caller answers 503 and says which words are missing.
 */
export function widgetLabels(
  sections: readonly SectionView[] | null | undefined,
): WidgetLabels | null {
  if (!sections) return null;
  const one = (slot: (typeof WIDGET_SLOTS)[number]): string | null => {
    const found = sections.filter((s) => s.slot === slot);
    const text = found.length === 1 ? found[0].heading?.trim() : "";
    return text ? text : null;
  };
  const heading = one("widget-heading");
  const link = one("widget-link");
  const source = one("widget-source");
  const empty = one("widget-empty");
  if (!heading || !link || !source || !empty) return null;
  return { heading, link, source, empty };
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text for an element body or a double-quoted attribute. */
export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** The name the campsite page puts in its own `<h1>`. */
export function widgetName(spot: Spot): string {
  const shown = withOwnerOverrides(spot);
  const name = typeof shown.name === "string" ? shown.name.trim() : "";
  if (name) return name;
  return shown.region
    ? `${SPOT_TYPE_LABEL[shown.type]} near ${shown.region}`
    : SPOT_TYPE_LABEL[shown.type];
}

export interface WidgetAddress {
  country: string;
  region: string;
  slug: string;
}

/** `/camping/hr/istria/camp-x`, each segment encoded. */
export const campsitePath = (a: WidgetAddress): string =>
  `/camping/${[a.country, a.region, a.slug].map(encodeURIComponent).join("/")}`;

/** `/embed/camping/hr/istria/camp-x`. */
export const widgetPath = (a: WidgetAddress): string =>
  `/embed${campsitePath(a)}`;

/**
 * The whole document.
 *
 * `siteUrl` is absolute on purpose: inside a frame on another site a
 * relative link would still resolve against us, but an absolute one is
 * what a reader sees when they hover, and it is the address we want
 * copied.
 *
 * 🔴 `target="_blank"`, never `_top`. `_top` would navigate the
 * campsite's own page away to ours — we would be taking their visitor,
 * on their website, with their embed. `rel="noopener"` so the page we
 * open cannot reach back into theirs.
 */
export function renderWidget(input: {
  spot: Spot;
  address: WidgetAddress;
  labels: WidgetLabels;
  siteUrl: string;
}): string {
  const { spot, address, labels } = input;
  const name = escapeHtml(widgetName(spot));
  const href = escapeHtml(
    `${input.siteUrl.replace(/\/+$/, "")}${campsitePath(address)}`,
  );
  const rows = aroundRows(spot.context);
  const body =
    rows.length > 0
      ? `<h2>${escapeHtml(labels.heading)}</h2><ul>${rows
          .map(
            (r) =>
              `<li><span>${escapeHtml(r.label)}</span><span>${escapeHtml(r.value)}</span></li>`,
          )
          .join("")}</ul>`
      : `<p>${escapeHtml(labels.empty)}</p>`;

  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow">' +
    `<title>${name}</title><style>${WIDGET_CSS}</style></head><body>` +
    `<h1>${name}</h1>${body}` +
    `<p><a href="${href}" target="_blank" rel="noopener">${escapeHtml(labels.link)}</a></p>` +
    // 🔴 Printed only beside figures. With no rows there is no OpenStreetMap
    // data on the screen, and crediting a source for nothing is its own
    // small untruth.
    (rows.length > 0 ? `<small>${escapeHtml(labels.source)}</small>` : "") +
    "</body></html>"
  );
}

/**
 * What a campsite pastes into its own page.
 *
 * 🔴 THE LINK IS OUTSIDE THE FRAME, AND THAT IS THE HALF THAT MATTERS TO
 * BOTH SIDES. A frame is not a link: a search engine credits nothing to
 * us for it, and a visitor whose browser shows no frames sees nothing at
 * all. The plain `<a>` in the campsite's own markup is the link from
 * their domain the card is about, and it is the widget's whole "basic
 * form" when frames are off.
 *
 * 🔴 `sandbox` IS FOR THE CAMPSITE, NOT FOR US. With it, their page does
 * not have to trust ours: whatever we serve tomorrow cannot run script,
 * read their cookies or navigate their window. `allow-popups` (+ escape)
 * is the one thing the link needs to open our page in a new tab.
 * `referrerpolicy="no-referrer"`: we do not learn which of their pages
 * the visitor was reading.
 */
export function embedSnippet(input: {
  address: WidgetAddress;
  siteUrl: string;
  /** Campsite name for the frame's accessible title. */
  title: string;
  /** Words of the plain link under the frame. */
  linkText: string;
}): string {
  const site = input.siteUrl.replace(/\/+$/, "");
  return [
    `<iframe src="${escapeHtml(site + widgetPath(input.address))}"`,
    `  title="${escapeHtml(input.title)}"`,
    '  width="100%" height="340" loading="lazy"',
    '  referrerpolicy="no-referrer"',
    '  sandbox="allow-popups allow-popups-to-escape-sandbox"',
    '  style="border:0;max-width:420px"></iframe>',
    `<p><a href="${escapeHtml(site + campsitePath(input.address))}">${escapeHtml(input.linkText)}</a></p>`,
  ].join("\n");
}

export interface WidgetReply {
  status: 200 | 404 | 503;
  /** `text/html` for 200, `text/plain` otherwise. */
  body: string;
}

/**
 * Everything the route decides, with its two reads passed in — so the
 * decisions can be held by a test without a server, a database or a
 * campsite in a country we do not publish (the fixture has none, which
 * made the first, end-to-end version of that check pass for any code).
 *
 * 🔴 It takes an address and nothing else of the request. No header, no
 * cookie, no query string reaches this function, so nothing about the
 * visitor can end up in the reply.
 */
export async function buildWidget(
  address: WidgetAddress,
  deps: {
    getSpot: (
      country: string,
      region: string,
      slug: string,
    ) => Promise<{ spot: Spot } | null>;
    pageContent: (slug: string) => Promise<PageView | null>;
    siteUrl: string;
  },
): Promise<WidgetReply> {
  // 🔴 The same gate as the campsite page, and BEFORE the read. A widget
  // for a country whose pages we do not publish would link to a 404 on
  // our own site.
  if (isUnpublishedCountry(address.country)) {
    return { status: 404, body: "Not found" };
  }
  const data = await deps.getSpot(
    address.country,
    address.region,
    address.slug,
  );
  if (!data) return { status: 404, body: "Not found" };

  const labels = widgetLabels((await deps.pageContent(WIDGET_PAGE))?.sections);
  if (!labels) {
    // 🔴 503, not a widget with holes in it. The words live in the CMS;
    // without the attribution line the figures may not be shown at all.
    return {
      status: 503,
      body: `The widget's text is not available (CMS page "${WIDGET_PAGE}", slots ${WIDGET_SLOTS.join(", ")}).`,
    };
  }
  return {
    status: 200,
    body: renderWidget({
      spot: data.spot,
      address,
      labels,
      siteUrl: deps.siteUrl,
    }),
  };
}
