// CAMP-523: the widget a campsite embeds on ITS OWN website.
//
// One place for the three things that must agree: the stylesheet the
// widget carries, the Content-Security-Policy that names that stylesheet
// by hash, and the path the policy applies to. The policy is emitted by
// next.config.mjs and by gen-headers.mjs; the stylesheet is printed by
// src/lib/provider-widget.ts. A hash kept by hand next to a stylesheet
// kept somewhere else is a widget that renders unstyled the first time
// anyone changes a colour, and nothing would say why.
//
// 🔴 WHAT THE WIDGET MAY DO ON SOMEBODY ELSE'S PAGE: NOTHING BUT BE READ.
//
//   default-src 'none'   no script, no image, no font, no fetch, no frame.
//                        The document is its own only resource, so the
//                        visitor's browser makes ONE request to us.
//   style-src  'sha256…' exactly the stylesheet below and no other. Not
//                        'unsafe-inline': campsite names come from
//                        OpenStreetMap, and a policy that lets any inline
//                        style through lets an injected one through.
//   frame-ancestors *    the whole point — any site may frame it. That is
//                        safe HERE and only here: the document has no
//                        form, no button, no session and no cookie, so
//                        there is nothing for a click to be stolen into.
//                        Every other path keeps 'none'.
//   base-uri / form-action 'none'   belt and braces for the same reason.
//
// 🔴 `*` in frame-ancestors matches http: and https: parents only (the
// CSP3 wildcard does not match data:, blob: or file:). A campsite whose
// site is still plain http can embed it; a data: URL cannot.

import { createHash } from 'node:crypto';

/** Every widget address starts here. Nothing else lives under it. */
export const EMBED_PREFIX = '/embed';

/**
 * The stylesheet, whole. Light only: the widget sits on a page whose
 * theme we cannot see, and following the visitor's OS setting would put
 * a dark box on a white campsite website.
 *
 * The values are the site's own light tokens (globals.css: --surface,
 * --ink, --ink-2, --heading, --line). System fonts, because a webfont is
 * a second request and the budget is one.
 */
export const WIDGET_CSS = [
  ':root{color-scheme:light}',
  '*{box-sizing:border-box}',
  'body{margin:0;padding:16px;background:#fff;color:#000;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  'h1{margin:0 0 2px;font-size:17px;line-height:1.3;color:#343d50}',
  'h2{margin:0 0 10px;font-size:13px;font-weight:400;color:#5a5a5a}',
  'ul{margin:0;padding:0;list-style:none;border-top:1px solid #cacaca}',
  'li{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #cacaca}',
  'li span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}',
  'p{margin:10px 0 0}',
  'a{color:#343d50;font-weight:600}',
  'small{display:block;margin-top:10px;font-size:12px;color:#5a5a5a}',
].join('');

/** `'sha256-…'`, quoted the way a CSP source expression wants it. */
export function styleSource(css = WIDGET_CSS) {
  return `'sha256-${createHash('sha256').update(css, 'utf8').digest('base64')}'`;
}

export const EMBED_CSP = [
  "default-src 'none'",
  `style-src ${styleSource()}`,
  'frame-ancestors *',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * What the widget's path sends INSTEAD of the site-wide values.
 *
 * 🔴 `noindex, nofollow` in every build mode, public included. The widget
 * repeats a part of the campsite page; indexed, it would compete with
 * the page it exists to send people to. And it is the same value a
 * closed build sends everywhere, so overriding the key can never make a
 * closed site's widget MORE crawlable than the rest of it.
 */
export const EMBED_HEADERS = {
  'Content-Security-Policy': EMBED_CSP,
  'X-Robots-Tag': 'noindex, nofollow',
};
