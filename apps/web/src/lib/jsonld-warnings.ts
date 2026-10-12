import { areaNames } from './warnings';
import type { WarningState } from './warnings';
import type { Warning } from './warning-types';

// CAMP-211 — the one thing we have that no competitor has, said in a
// language search engines and AI agents read.
//
// 🔴 WHY THIS IS NOT IN THE PAGE'S BUILT MARKUP.
//
// The site is a static export: 65 435 pages, built once and served as
// files. A weather warning is live — it has an `expires`, often within
// hours — and there is no scheduled rebuild (measured 12.10.2026: the
// crons in .github/workflows are backup-verify, codeql, osm-weekly,
// scale-check, watchdog and warning-geography; not one of them rebuilds
// the site). Baking a warning into a static page would publish a claim
// about a named place that goes false the moment it expires, and would
// keep publishing it until somebody deploys. That is the one thing this
// project refuses to do.
//
// So the announcement is emitted beside the panel, from the same live
// state, and it exists exactly as long as the warning does.
//
// 🔴 AND ONLY IN THE `warnings` STATE. `clear` is a measurement, not an
// announcement, and `no-fresh-data` is an admission that we do not know.
// Markup for either would be us saying something the service did not.

/** A node this file emits. Narrow on purpose: no `any` reaches the page. */
export type AnnouncementNode = {
  '@context': 'https://schema.org';
  '@type': 'SpecialAnnouncement';
  name: string;
  text: string;
  datePosted: string;
  expires?: string;
  inLanguage?: string;
  spatialCoverage?: { '@type': 'Place'; name: string };
  about?: { '@type': 'Place'; name: string; url?: string };
  provider: { '@type': 'Organization'; name: string; url?: string };
  identifier?: string;
};

/** Where the warning is about, as the page knows it. */
export type AnnouncedPlace = {
  /** The campsite's name, as printed on the page. */
  name: string;
  /** Its canonical URL, absolute. */
  url?: string;
};

const named = (s: string | null | undefined): s is string =>
  typeof s === 'string' && s.trim() !== '';

/**
 * What to call this warning in one line.
 *
 * The service's own words, in its own order of preference. Nothing here
 * is written by us: `headline` is what the service chose to lead with,
 * `event` is the hazard it named, and if it gave neither there is
 * nothing honest to put in a headline, so the warning is skipped.
 */
function title(w: Warning): string | null {
  for (const candidate of [w.headline, w.event, w.type]) {
    if (named(candidate)) return candidate.trim();
  }
  return null;
}

/**
 * The body, which must say something a headline does not have to.
 *
 * `description` first because it is the service's full text; `headline`
 * is the fallback so that `text` is never empty — schema.org makes it
 * the substance of the announcement, and an announcement with no
 * substance is noise in a search result.
 */
function body(w: Warning): string | null {
  for (const candidate of [w.description, w.headline, w.event]) {
    if (named(candidate)) return candidate.trim();
  }
  return null;
}

/**
 * The announcements for one campsite page, or none.
 *
 * 🔴 `sender` AND `sent` ARE REQUIRED, and this file checks them even
 * though `warningState` already filters on both (warnings.ts:211).
 * Clause 5.3 of the MeteoAlarm terms says the issuing service must be
 * named, and clause 5.4 says when it issued the warning: markup is a
 * second publication of the same words, so it carries the same duties.
 * Relying on an upstream filter means the duty is one refactor away
 * from being nobody's.
 */
export function specialAnnouncements(
  state: WarningState,
  place: AnnouncedPlace,
): AnnouncementNode[] {
  if (state.kind !== 'warnings') return [];

  const out: AnnouncementNode[] = [];
  for (const w of state.warnings) {
    if (!named(w.sender) || !named(w.sent)) continue;

    const name = title(w);
    const text = body(w);
    if (name === null || text === null) continue;

    const areas = areaNames(w);
    const node: AnnouncementNode = {
      '@context': 'https://schema.org',
      '@type': 'SpecialAnnouncement',
      name,
      text,
      datePosted: w.sent,
      // 🔴 The issuer, not us. We publish somebody else's warning; the
      // organisation that decided it is the one a reader must be able
      // to check against. `senderId` is often a URL and is passed
      // through when it is one.
      provider: {
        '@type': 'Organization',
        name: w.sender,
        ...(named(w.senderId) && /^https?:\/\//.test(w.senderId)
          ? { url: w.senderId }
          : {}),
      },
    };

    // 🔴 `expires` is what keeps this honest. Google drops a
    // SpecialAnnouncement past its expiry, so a warning that ends at
    // 18:00 stops being a claim at 18:00 without anybody deploying.
    // When the service gave none we say none rather than inventing one.
    if (named(w.expires)) node.expires = w.expires;
    if (named(w.language)) node.inLanguage = w.language;
    if (named(w.id)) node.identifier = w.id;

    // The area the SERVICE named, not the area we guessed. Several
    // areas are joined because the warning is one announcement over all
    // of them, and splitting it would publish several warnings where
    // the service issued one.
    if (areas.length > 0) {
      node.spatialCoverage = { '@type': 'Place', name: areas.join('; ') };
    }

    // And what the page is about, so an agent reading the announcement
    // alone can tell which campsite it was found beside.
    if (named(place.name)) {
      node.about = {
        '@type': 'Place',
        name: place.name,
        ...(named(place.url) ? { url: place.url } : {}),
      };
    }

    out.push(node);
  }
  return out;
}
