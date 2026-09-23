import { COMPANY } from '@/lib/legal';
import { A, B, Callout, H2, P } from './prose';

// CAMP-56 — Legal notice (imprint).
//
// 🔴 A recorded shortfall, not an oversight.
//
// Article 5 of the E-Commerce Directive (2000/31/EC), implemented in
// Belgium in Book XII of the Wetboek van economisch recht, asks a
// commercial site for the geographic address at which the provider is
// established and for its trade-register number. We publish the city and
// country but not the street, at the owner's instruction, because the
// registered seat is his home.
//
// The owner has been told, and it is repeated here so the next person
// does not have to rediscover it: withholding the street does not make it
// private. A Belgian company's registered address and enterprise number
// are published in the Kruispuntbank van Ondernemingen and anyone can
// look them up by name in seconds. So the omission costs compliance
// without buying confidentiality. The cheap fix is a business address —
// an accountant's or a registered-office service — which is both
// publishable and not his home.

export default function Notice() {
  return (
    <>
      <H2 id="operator">Who operates this site</H2>
      <P>
        CampTribe is operated by <B>{COMPANY.name}</B>, {COMPANY.city},{' '}
        {COMPANY.country}.
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
