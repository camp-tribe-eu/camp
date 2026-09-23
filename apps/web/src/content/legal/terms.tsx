import { COMPANY } from '@/lib/legal';
import { A, B, Callout, H2, H3, P, UL } from './prose';

// CAMP-56 — Terms of use.
//
// 🔴 What this document is trying to achieve, so that whoever edits it
// next does not undo it by accident.
//
// The strongest protection here is not a clause, it is a position: we
// publish information and we link. We do not take bookings, we do not
// combine travel services into one product, and we are not paid by the
// traveller. Directive (EU) 2015/2302 makes a "package organiser"
// strictly liable for the whole trip; a site that starts bundling a
// pitch with a ferry becomes one. Every sentence below that says what we
// are not is doing more work than any exclusion clause could.
//
// 🔴 What is deliberately NOT here: a blanket "we are liable for
// nothing". Directive 93/13/EEC Art. 6(1) says an unfair term "shall not
// be binding on the consumer", and its Annex lists exclusions of
// liability for death or personal injury (1(a)) and inappropriate
// exclusions of the consumer's remedies (1(b)) as the examples. A court
// does not soften such a term, it removes it — leaving the default rule,
// which is worse for us than the measured limit written below. The
// carve-outs are there because they are what makes the rest survive.
//
// 🔴 No link to the EU ODR platform. Most template terms still carry
// one; it was switched off on 20 July 2025 and Regulation (EU) 2024/3228
// repealed its legal basis. A dead statutory reference is worse than
// none.

export default function Terms() {
  return (
    <>
      <H2 id="what">1. What CampTribe is</H2>
      <P>
        CampTribe is an information service. We collect publicly available
        data about campsites, present it on a map and on pages you can read,
        and link out to other people&rsquo;s websites. That is the whole of
        what we do.
      </P>

      <Callout>
        <B>What we are not.</B> We are not a booking service, a travel agent
        or a tour operator. We do not sell, reserve or arrange
        accommodation, transport or any other travel service, we do not
        combine travel services into a package or a linked travel
        arrangement, and we take no payment from you. When you book
        anything, your contract is with that provider and not with us.
      </Callout>

      <P>
        We say this plainly because it decides who is responsible for what.
        A trip you plan using this site is your trip, arranged by you with
        the businesses you choose.
      </P>

      <H2 id="data">2. Where the information comes from, and what it is worth</H2>
      <P>
        Almost everything you see here is derived from{' '}
        <A href="https://www.openstreetmap.org/">OpenStreetMap</A>, a map
        anyone in the world may edit, together with the other open sources
        listed on our <A href="/legal/attribution">data and attribution</A>{' '}
        page. We re-import it about once a week.
      </P>
      <P>
        We have not visited these campsites. Nobody here has checked that a
        site exists, is open, has the facilities recorded against it, or
        will let you in. The information is as good as what volunteers have
        written down, and no better.
      </P>

      <H3>&ldquo;Unknown&rdquo; means unknown</H3>
      <P>
        Where our data does not say whether a campsite has something, we
        show that it is unknown rather than guessing. An absent shower icon
        is not a statement that there is no shower. Our filters say how many
        campsites they are leaving out for want of data, for the same
        reason.
      </P>

      <Callout>
        <B>Check before you travel.</B> Opening dates, prices, facilities and
        access change, and our copy of them can be months out of date.
        Contact the campsite. Whether camping is permitted at a given place
        is a question of local law and of the landowner&rsquo;s permission,
        and it differs between and within countries — including where wild
        camping is concerned. Finding a place on this map is not permission
        to camp there.
      </Callout>

      <H2 id="links">3. Links and affiliate links</H2>
      <P>
        We link to websites we do not run. We do not control them, we do not
        check them, and their content is their own.
      </P>
      <P>
        Some of those links are <B>affiliate links</B>: if you book or buy
        after following one, the provider may pay us a commission. That
        costs you nothing and does not change the price you pay. It does not
        change what we show you either — commission does not buy a place in
        our listings, a ranking or a recommendation. Wherever such a link
        appears, it is marked as one before you click it.
      </P>

      <H2 id="use">4. Using the site</H2>
      <P>You may read, search, link to and share anything here. You may not:</P>
      <UL>
        <li>
          take the underlying data in bulk and republish it in a way that
          breaks the <A href="/legal/attribution">Open Database License</A>{' '}
          it comes to us under — those conditions bind you exactly as they
          bind us;
        </li>
        <li>
          use automated means in a way that degrades the service for other
          people;
        </li>
        <li>
          use the site to do something unlawful, or to misrepresent a
          campsite, a business or a person.
        </li>
      </UL>
      <P>
        If you send us content — a correction, a photograph, a review — you
        keep it, and you give us permission to publish it here. You confirm
        that it is yours to give and that publishing it breaks nobody
        else&rsquo;s rights. We may decline or remove anything, and you can
        ask us to remove your own content at any time by writing to{' '}
        <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>.
      </P>
      <P>
        If you believe something here infringes your rights or is unlawful,
        write to the same address and tell us what and where. We will look at
        it and act where we should.
      </P>

      <H2 id="liability">5. Responsibility</H2>
      <P>
        We take reasonable care over this site, and we are telling you
        honestly what its information is and is not. Within that:
      </P>
      <UL>
        <li>
          we do not promise that the site is uninterrupted, error-free, or
          that any particular campsite, facility or route is as described;
        </li>
        <li>
          we are not responsible for what other businesses do — the
          campsites, the rental companies and the sites we link to;
        </li>
        <li>
          to the extent the law allows, we are not liable for loss that was
          not a foreseeable result of our breach, and our total liability to
          you is limited to one hundred euro.
        </li>
      </UL>

      <Callout>
        <B>What we do not take away, and could not.</B> Nothing here limits
        or excludes our liability for death or personal injury caused by our
        negligence, for fraud, or for anything else that the law does not
        allow us to exclude. If you are a consumer, you keep every right
        that your own country&rsquo;s consumer law gives you, and nothing in
        these terms is to be read as reducing them. A term that turns out to
        be unfair or unenforceable is simply removed; the rest continues to
        apply.
      </Callout>

      <H2 id="changes">6. Changes</H2>
      <P>
        We may change these terms. The version and the date it took effect
        are printed at the top of this page, and the previous wording is
        recorded in our public source repository, so it is always possible
        to establish which version applied on a given day. Continuing to use
        the site after a change means the new version applies to that use;
        it does not reach backwards.
      </P>

      <H2 id="law">7. Law and disputes</H2>
      <P>
        These terms are governed by Belgian law, and the courts of Belgium
        have jurisdiction.
      </P>
      <P>
        If you are a consumer resident in the European Union, that does not
        deprive you of the protection of the mandatory rules of your own
        country, and you may also bring proceedings in the courts where you
        live. If something has gone wrong, please write to{' '}
        <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A> first — it is
        faster than anything else and we would rather fix it.
      </P>
    </>
  );
}
