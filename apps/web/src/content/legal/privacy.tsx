import { COMPANY } from '@/lib/legal';
import { A, B, Callout, H2, H3, P, UL } from './prose';

// CAMP-56 — Privacy.
//
// 🔴 The strongest privacy policy is a short one, and it is short because
// of a design decision rather than a drafting one: we do not collect what
// we do not need. There are no accounts, no tracking pixels, no
// advertising network and no third-party analytics. Data we never hold is
// data we cannot lose, cannot be asked for, and cannot be fined over.
//
// 🔴 This document must describe what the site ACTUALLY does on the day
// it is published — not what it is planned to do. A privacy policy
// describing analytics we have not switched on is a false statement about
// processing, which is its own breach. When CAMP-57 lands, this page
// changes in the same commit.

export default function Privacy() {
  return (
    <>
      <H2 id="who">Who is responsible</H2>
      <P>
        {COMPANY.name}, {COMPANY.city}, {COMPANY.country}, is the controller
        for any personal data processed through this site. You can reach a
        person at <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>.
      </P>

      <Callout>
        <B>The short version.</B> There are no accounts on this site, no
        advertising, no tracking pixels and no profiling. We do not sell or
        share personal data with anyone. Unless you write to us, we do not
        know who you are.
      </Callout>

      <H2 id="what">What we process, and why</H2>

      <H3>Serving the pages</H3>
      <P>
        When your browser asks for a page, our hosting provider handles the
        request and records technical information about it — including your
        IP address, the page requested, the time, and your browser&rsquo;s
        user-agent string. This is how any website works, and it is what
        lets us keep the site available and fend off abuse.
      </P>
      <UL>
        <li>
          <B>Who does it:</B> Cloudflare, Inc., as our hosting provider and
          processor.
        </li>
        <li>
          <B>Legal basis:</B> our legitimate interests in operating and
          securing the service — Article 6(1)(f) GDPR.
        </li>
        <li>
          <B>Kept for:</B> we do not receive these logs, do not store them
          and cannot search them. They exist inside our provider&rsquo;s
          infrastructure under its own retention policy, for operational
          and security purposes only.
        </li>
      </UL>

      <H3>Your cookie choice</H3>
      <P>
        If you answer the cookie banner, we store that answer — and only
        that answer — on your own device, so we do not have to ask again.
        It never reaches our servers and it identifies nothing. The details
        are on the <A href="/legal/cookies">cookies</A> page.
      </P>

      <H3>Writing to us</H3>
      <P>
        If you send us an email, we have your email address and whatever you
        put in the message, for as long as it takes to deal with it and for
        a reasonable period afterwards.
      </P>
      <UL>
        <li>
          <B>Legal basis:</B> our legitimate interest in answering people who
          write to us — Article 6(1)(f) GDPR.
        </li>
      </UL>

      <H3>What we do not do</H3>
      <UL>
        <li>No advertising and no advertising networks.</li>
        <li>
          No profiling, and no automated decision-making that produces legal
          or similarly significant effects — Article 22 GDPR does not arise.
        </li>
        <li>No selling, renting or sharing of personal data.</li>
        <li>
          No social-media buttons that report your visit back to a social
          network.
        </li>
      </UL>

      <H2 id="who-else">Who else sees it</H2>
      <P>
        <B>Cloudflare, Inc.</B> hosts this site and processes data on our
        behalf, under a contract that obliges it to act only on our
        instructions — Article 28 GDPR. Where that involves a transfer
        outside the European Economic Area, it is covered by the European
        Commission&rsquo;s Standard Contractual Clauses.
      </P>
      <P>
        That is the complete list. Nobody else receives personal data from
        this site, except where we are legally required to disclose it — and
        if that list ever grows, this page grows with it in the same
        release.
      </P>

      <H2 id="map">The map</H2>
      <P>
        The map draws its background tiles from an external provider, which
        means your browser connects to that provider directly and it can see
        your IP address and which tiles you asked for, in the same way any
        image on the web works. We do not send it anything about you, and it
        sets no cookies through us. Which provider is in use is shown under
        the map, and you can switch it.
      </P>

      <H2 id="rights">Your rights</H2>
      <P>
        Under the GDPR you may ask us to give you a copy of your personal
        data, correct it, delete it, restrict or object to our use of it, or
        hand it to someone else in a portable form. Where we rely on your
        consent — the analytics cookies, if we ever set any — you can
        withdraw it at any time, and withdrawing is as easy as giving it.
      </P>
      <P>
        Write to <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>. We
        answer within one month, and if a request is complex enough to need
        longer we will tell you inside that month and say why — which is what
        Article 12(3) allows and requires. In practice the honest answer to
        most such requests will be that we hold nothing about you, because we
        do not.
      </P>

      <Callout>
        <B>If we get it wrong.</B> You can complain to a data protection
        authority. Ours is the Belgian{' '}
        <A href="https://www.gegevensbeschermingsautoriteit.be/">
          Gegevensbeschermingsautoriteit / Autorité de protection des
          données
        </A>
        , and you may also complain to the authority where you live or work.
      </Callout>

      <H2 id="children">Children</H2>
      <P>
        This site is not aimed at children and we do not knowingly collect
        anything from them. There is nothing here to sign up to.
      </P>

      <H2 id="changes">Changes</H2>
      <P>
        The version of this policy and the date it took effect are at the
        top of the page. Earlier versions are in our public source
        repository, so what applied on any given day can be established
        exactly.
      </P>
    </>
  );
}
