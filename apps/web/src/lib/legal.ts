// CAMP-56: who we are, and the registry of the pages that say so.
//
// 🔴 CAMP-365: THE TEXT OF THESE PAGES NO LONGER LIVES IN THE REPOSITORY
// TREE OF THE SITE. It lives in the database (`legal_pages`), the owner
// edits it in the CMS, and the site reads it from our API AT BUILD TIME
// and renders it statically (`lib/legal-content.ts`). What stays here is
// the REGISTRY: which documents exist, in what order a reader needs them,
// and — for now — their version and effective date.
//
// The registry stays in code, not in the database, for reasons that are
// still true:
//
//   · `consent.ts` reads the cookie policy's version SYNCHRONOUSLY from a
//     CLIENT component, and a changed version voids a reader's saved
//     consent at once. An asynchronous version, with a fallback for an
//     unreachable database, would void it for everybody on one network
//     blip.
//   · `legal_pages` has no order column, and the order is deliberate.
//
// 🔴 WHAT THAT COSTS, AND THE GUARD THAT PAYS FOR IT. The page prints the
// version the DATABASE holds while consent is keyed by the version THIS
// FILE holds. They are one fact kept in two places, so the build refuses
// to proceed when they differ (`checkLegalDocument`) — the version moves
// with the registry or not at all. Title and summary are NOT compared:
// they feed the footer, and a different title in the CMS is a look, not a
// falsehood.
//
// 🔴 WHAT THE MOVE GAVE UP. The earlier reasons for keeping the text in git
// were that a commit history answers "which text was in force on the day"
// with a timestamp and an author, and that a legal page must not change
// without a pull request somebody reads. The text is now a row a person
// can edit and save. That is the owner's decision (CAMP-365). What answers
// "which text was in force on that day" is no longer git: it is the
// `version` bumped by hand plus whatever revision history the CMS keeps —
// and nothing here has verified that the CMS keeps one.
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
