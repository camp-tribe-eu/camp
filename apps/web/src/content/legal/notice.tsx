import { COMPANY } from '@/lib/legal';
import { A, B, Callout, H2, P } from './prose';

// CAMP-56 — Legal notice (imprint).
//
// 🔴 A recorded shortfall, not an oversight.
//
// Article 5 of the E-Commerce Directive (2000/31/EC), implemented in
// Belgium in Book XII of the Wetboek van economisch recht, asks a
// commercial site for the geographic address at which the provider is
// established and for its trade-register number.
//
// 🔴 20.10.2026 — BOTH ARE NOW HERE, AND THIS FILE NO LONGER RECORDS A
// SHORTFALL. For months it did: the street was withheld because the
// registered seat is the owner's home, and this comment argued that the
// omission cost compliance without buying confidentiality, since a
// Belgian company's registered address is public in the Kruispuntbank
// van Ondernemingen and findable by NAME, which we always published.
//
// The owner read that argument, agreed with it in his own words — the
// address is findable from the enterprise number anyway — and supplied
// the data.
//
// 🔴 IT LIVES HERE AND NOT IN THE FOOTER, AND THAT IS ALSO HIS DECISION.
// Publishing it is the duty; printing a home address under every page of
// the site is not. The footer carries the company name, the year and the
// rights line, and links here.

export default function Notice() {
  return (
    <>
      <H2 id="operator">Who operates this site</H2>
      <P>
        CampTribe is operated by <B>{COMPANY.name}</B>.
      </P>
      <P>
        Registered office: <B>{COMPANY.street}</B>, {COMPANY.city},{' '}
        {COMPANY.country}
      </P>
      <P>
        Enterprise number (KBO) and VAT number:{' '}
        <B>{COMPANY.enterpriseNumber}</B>
      </P>
      <P>
        Email: <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>
      </P>
      <P>
        That address reaches a person and is the right one for everything —
        questions, corrections, data protection requests, complaints and
        legal notices alike.
      </P>

      <H2 id="what">What this site does</H2>
      <P>
        CampTribe publishes information about campsites, derived from open
        data, and links to other people&rsquo;s websites. It does not sell,
        book or arrange accommodation, transport or any other travel
        service, and it takes no payment from readers. The{' '}
        <A href="/legal/terms">terms of use</A> set this out in full.
      </P>

      <H2 id="content">Responsibility for content</H2>
      <P>
        The campsite information here comes from{' '}
        <A href="/legal/attribution">open data sources</A>, chiefly
        OpenStreetMap, which anyone may edit. We have not inspected these
        places. Where we link to other websites, their content is theirs and
        we do not control it.
      </P>

      <Callout>
        <B>Something unlawful or infringing?</B> Write to{' '}
        <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A> saying what
        it is and where you found it. We will look at it promptly and remove
        or correct whatever we should.
      </Callout>

      <H2 id="pages">The other pages</H2>
      <P>
        <A href="/legal/terms">Terms of use</A> ·{' '}
        <A href="/legal/privacy">Privacy</A> ·{' '}
        <A href="/legal/cookies">Cookies</A> ·{' '}
        <A href="/legal/attribution">Data and attribution</A>
      </P>
    </>
  );
}
