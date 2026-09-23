// CAMP-56: who we are, and the pages that say so.
//
// 🔴 Why this text lives in the repository and not in the CMS.
//
// `legal_pages` exists in Directus (CAMP-89) and could hold these. It
// deliberately does not, for three reasons that only apply to legal text:
//
//   1. Git is the audit trail. The question a regulator or a court asks
//      is "which version was in force on the day this person used the
//      site" — and a commit history answers that with a timestamp and an
//      author. A CMS row that was edited in place cannot.
//   2. A legal page must not change without review. In the repository a
//      change is a pull request somebody reads; in a CMS it is a Save
//      button at two in the morning.
//   3. The site has to serve them with the backend switched off, which
//      is how the whole web app already works (CAMP-39).
//
// The CMS table stays where it is — translations of these pages are a
// different problem and will want it.
//
// 🔴 What this file is NOT. It is drafted to be as protective as the law
// actually allows, which is a lot, and it has not been reviewed by a
// lawyer. UTD BV is a BELGIAN company, so the governing law is Belgian
// (Wetboek van economisch recht) and the reviewer has to be a Belgian
// lawyer. Publishing unreviewed legal text is itself a risk.

/** One address, so there is one thing to set up and it cannot half-work. */
export const CONTACT_EMAIL = 'hello@camptribe.eu';

/**
 * 🔴 Exactly what the owner approved, and no more.
 *
 * The E-Commerce Directive (2000/31/EC, Art. 5), implemented in Belgium
 * in Book XII of the Wetboek van economisch recht, asks a commercial site
 * for the geographic address of establishment and the trade-register
 * number. We publish the city and the country but not the street, at the
 * owner's instruction, because the registered seat is his home.
 *
 * That is a deliberate, recorded shortfall rather than an oversight —
 * see the note printed on the legal-notice page itself.
 */
export const COMPANY = {
  name: 'UTD BV',
  city: '2000 Antwerpen',
  country: 'Belgium',
  email: CONTACT_EMAIL,
} as const;

export interface LegalPage {
  slug: string;
  title: string;
  /**
   * One plain sentence, shown under the heading and in the footer's
   * tooltip. A legal page nobody can summarise is one nobody has read.
   */
  summary: string;
  /**
   * 🔴 Bumped by hand when the meaning changes, not on every typo.
   *
   * It exists so that "you agreed to version 3" is a statement we can
   * support: the consent record stores this number, and git holds the
   * text that carried it.
   */
  version: string;
  /** ISO date this version took effect. Never back-dated. */
  effectiveFrom: string;
}

/**
 * Order is the order a reader needs them, not alphabetical: what the
 * service is, what happens to their data, what we store on their device,
 * where the information comes from, who we are.
 */
export const LEGAL_PAGES: LegalPage[] = [
  {
    slug: 'terms',
    title: 'Terms of use',
    summary:
      'What CampTribe is, what it is not, and what you can rely on.',
    version: '1.0',
    effectiveFrom: '2026-09-23',
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    summary:
      'What we know about you — which is very little — and what you can make us do about it.',
    version: '1.0',
    effectiveFrom: '2026-09-23',
  },
  {
    slug: 'cookies',
    title: 'Cookies',
    summary:
      'Nothing is stored on your device until you say yes, and saying no is one click.',
    version: '1.0',
    effectiveFrom: '2026-09-23',
  },
  {
    slug: 'disclaimer',
    summary:
      'Nobody from CampTribe has visited these campsites. What that means before you drive somewhere.',
    title: 'What we do and do not know',
    version: '1.0',
    effectiveFrom: '2026-09-23',
  },
  {
    slug: 'attribution',
    title: 'Data and attribution',
    summary:
      'Where every map, boundary and elevation on this site comes from, and the licences we are bound by.',
    version: '1.0',
    effectiveFrom: '2026-09-23',
  },
  {
    slug: 'notice',
    title: 'Legal notice',
    summary: 'Who operates this site and how to reach a human.',
    version: '1.0',
    effectiveFrom: '2026-09-23',
  },
];

export function legalPage(slug: string): LegalPage | undefined {
  return LEGAL_PAGES.find((p) => p.slug === slug);
}

export const legalPath = (slug: string) => `/legal/${slug}`;
