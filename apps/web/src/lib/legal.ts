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
 * for the geographic address at which the provider is established and for
 * its trade-register number. GDPR Art. 13 separately wants the
 * controller's identity and contact details in the privacy notice.
 *
 * 🔴 20.10.2026 — THE SHORTFALL IS CLOSED. For months this file recorded
 * a deliberate omission: the street was withheld because the registered
 * seat is the owner's home. He supplied the full data and decided to
 * publish it, with his own reasoning: the address is findable from the
 * enterprise number anyway, so withholding it bought nothing.
 *
 * That matches what the legal-notice page had argued all along — a
 * Belgian company's registered address is public in the Kruispuntbank van
 * Ondernemingen and findable by NAME, which we always published.
 *
 * 🔴 WHERE IT APPEARS IS ALSO HIS DECISION, AND IT IS NOT THE FOOTER.
 * The address and the number live on the legal pages, which is where
 * someone looking for them goes. The footer carries the company name, the
 * year and the rights line — nothing that reads as a home address to a
 * casual reader. Publishing is a legal duty; putting it under every
 * photograph on the site is not.
 */
export const COMPANY = {
  name: 'UTD BV',
  street: 'Kapucinessenstraat 6',
  city: '2000 Antwerpen',
  country: 'Belgium',
  /**
   * Enterprise number, which is also the VAT number in Belgium — the
   * owner's own note labels it «Ondernemingsnummer (KBO / BTW)», so one
   * field carries both rather than pretending they are two.
   */
  enterpriseNumber: 'BE 0799.245.752',
  email: CONTACT_EMAIL,
} as const;

/**
 * The full postal address, in the order a Belgian reader expects it.
 *
 * 🔴 Built here rather than written out at each call site: three copies
 * of an address drift, and the one that drifts is the one nobody reads
 * until it matters.
 */
export const COMPANY_ADDRESS = [
  COMPANY.name,
  COMPANY.street,
  COMPANY.city,
  COMPANY.country,
].join(', ');

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
      'What CampTribe is, what it is not, what you can rely on, and who may open an account.',
    version: '1.1',
    effectiveFrom: '2026-10-16',
  },
  {
    slug: 'privacy',
    title: 'Privacy',
    summary:
      'What we hold about you, who else touches it, and the two things you can do yourself without asking us.',
    version: '2.0',
    effectiveFrom: '2026-10-16',
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
    // CAMP-186. ODbL §4.6 lets us answer with the DESCRIPTION of our
    // alterations instead of the derived database itself. This is that
    // description, and it sits next to attribution because a reader
    // asking "where is this from" and one asking "what did you do to it"
    // are one step apart.
    slug: 'database',
    title: 'How this database is made',
    summary:
      'What we take from OpenStreetMap, what we compute ourselves, what we join in, and what we leave out.',
    version: '1.0',
    effectiveFrom: '2026-10-04',
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
