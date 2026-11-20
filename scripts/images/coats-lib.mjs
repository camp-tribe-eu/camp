// CAMP-441: the rules about which coat-of-arms file we may show, as pure
// functions. The fetcher (fetch-coats.mjs) and the guard (check-coats.mjs)
// both read THESE, so the guard cannot approve what the fetcher refuses
// for a different reason.

/**
 * The only Commons licences we use. Exact names as Commons prints them in
 * `extmetadata.LicenseShortName`. No CC BY, no CC BY-SA: those need a credit
 * and a share-alike notice we do not print (owner, 20.11.2026).
 */
export const CLEAN_LICENSES = ['Public domain', 'CC0'];

/** True when the manifest's licence string is one of the clean two. */
export function isCleanLicense(license) {
  return typeof license === 'string' && CLEAN_LICENSES.includes(license.trim());
}

/**
 * One Commons `extmetadata` block (or its flat form) → why a file is NOT
 * clean, or `null` when it is. 🔴 ANY `Restrictions` value rejects:
 * `insignia` means national symbol law may restrict the use, `trademarked`
 * speaks for itself, and a value we have never seen is not a green light.
 */
export function rejectReason(license, restrictions) {
  if (!isCleanLicense(license)) return `licence "${license ?? ''}" is not Public domain or CC0`;
  if (typeof restrictions === 'string' && restrictions.trim() !== '')
    return `Commons restriction "${restrictions.trim()}"`;
  return null;
}

/** Commons wraps the author in HTML; the manifest wants plain text or null. */
export function plainText(html) {
  if (typeof html !== 'string') return null;
  const t = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return t === '' ? null : t;
}

/**
 * Problems with an SVG's text; empty means it may ship. 🔴 An `<img>` does
 * not run a script, but the file is ours to serve and may one day be opened
 * on its own, so: no script, no event handler, no `javascript:`, no
 * foreignObject, no entity declarations, and nothing that fetches from
 * another host (href/src/url()/@import to http(s) or //host).
 */
export function svgProblems(text) {
  const out = [];
  if (!/<svg[\s>]/i.test(text)) out.push('not an SVG');
  if (/<script/i.test(text)) out.push('contains <script');
  if (/[\s"'/]on[a-z]+\s*=/i.test(text)) out.push('contains an on*= event handler');
  if (/javascript:/i.test(text)) out.push('contains javascript:');
  if (/<foreignObject/i.test(text)) out.push('contains <foreignObject');
  if (/<!ENTITY/i.test(text)) out.push('declares an ENTITY');
  if (/(?:href|src)\s*=\s*["']\s*(?:https?:)?\/\//i.test(text)) out.push('has an external href/src');
  if (/url\(\s*["']?\s*(?:https?:)?\/\//i.test(text)) out.push('has an external url()');
  if (/@import/i.test(text)) out.push('has @import');
  return out;
}

/** ISO 3166-2 → the file stem (`HR-01` → `hr-01`). */
export const stem = (iso) => iso.toLowerCase();

/**
 * Codes whose Wikidata coat is clean in licence but is NOT that region's coat
 * of arms. A wrong shield is as false as a drawn one, so these show the flag.
 * Found by reading the file title against the region name (20.11.2026).
 * The fetcher skips them; the guard fails if one appears in the manifest.
 */
export const NOT_THIS_REGIONS_ARMS = {
  'GR-J': 'Wikidata P94 is the national coat of arms of Greece (Ministries), not Peloponnisos',
  'FR-03': 'file is the historic County of Clermont (Bourbon), not the department of Allier',
  'FR-11': 'file is marked "non-officiel": Aude has no official arms',
};
