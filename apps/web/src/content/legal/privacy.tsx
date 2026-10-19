import { COMPANY } from '@/lib/legal';
import { A, B, Callout, H2, H3, P, UL } from './prose';

// CAMP-56 — Privacy. Rewritten for CAMP-324.
//
// 🔴 THIS DOCUMENT MUST DESCRIBE WHAT THE SITE ACTUALLY DOES ON THE DAY IT
// IS PUBLISHED — not what it is planned to do, and not what it used to do.
// A privacy policy describing processing that does not happen is a false
// statement about processing, which is its own breach. It cuts both ways:
// denying accounts that exist is the same defect as announcing analytics
// that are switched off.
//
// 🔴 WHAT CHANGED AND WHY (16.10.2026). Two statements here had stopped
// being true:
//
//   1. The old text DENIED THAT ACCOUNTS EXIST. Sign-in shipped with
//      CAMP-50, registration with CAMP-228, and the owner decided on 15.10
//      that accounts are part of the launch. Everything that leaned on that
//      denial — that we cannot know who you are, that there is nothing to
//      sign up to — leaned on nothing.
//   2. The old text NAMED THE CDN AS THE HOSTING PROVIDER. Cloudflare
//      Pages was ruled out (CAMP-61). Our own machine serves the pages;
//      Cloudflare sits in front of it as a CDN and reverse proxy. The
//      document named the wrong processor in that role and left the real
//      one — the server provider — out entirely.
//
// 🔴 THE CARD'S OWN CHECK WAS WRONG TWICE, AND BOTH WAYS ARE WORTH KNOWING.
// It asked for a grep over the CDN's company name to return nothing. But
// this document now names that company correctly, twice, in its real role.
// A guard built on the bare name stays red over true text, and the obvious
// way to make it green is to delete the truth.
//
// Narrowing the pattern to the two false claims is not enough either: a
// grep reads this comment block as readily as it reads the document, so
// explaining the defect here reintroduces it. Any check of this file must
// read the RENDERED PROSE, or at minimum strip comments first. That is why
// neither false claim is reproduced anywhere above.
//
// 🔴 A TRAP WORTH NAMING, AND IT SPRANG ON 19.10.2026. The text before
// 16.10 said we "do not receive these logs, do not store them and cannot
// search them" — true of someone else's infrastructure, and the web
// server is ours. That was replaced by "request logging on our own web
// server is switched off", which was measured and true on 15.10.
//
// It stopped being true on 19.10, when the owner decided to turn request
// logging on (CAMP-353). Not one line of application code changed: a
// sentence whose truth lives in server config goes stale in silence, and
// a privacy policy describing processing that does not happen is the same
// defect as one hiding processing that does.
//
// 🔴 THE RETENTION NUMBER BELOW EXISTS IN TWO PLACES. "Fourteen days"
// here, and `rotate 13` plus `daily` in infra/logrotate/camptribe-caddy
// (thirteen rotated files plus the active one). Change one and you have
// published a period we do not keep. The first draft of that config used
// the web server's own size-based rolling, which would have let a line
// live for months on quiet traffic while this page promised fourteen
// days.

export default function Privacy() {
  return (
    <>
      <H2 id="who">Who is responsible</H2>
      <P>
        {COMPANY.name}, {COMPANY.city}, {COMPANY.country}, is the controller
        for personal data processed through this site. You can reach a
        person at <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>.
      </P>

      <Callout>
        <B>The short version.</B> You can use almost all of this site
        without an account, and we would rather you did. If you make one, we
        hold your email address, a one-way hash of your password, and
        whatever you save — trips, places, photos. No advertising, no
        tracking pixels, no third-party analytics, and nothing sold or
        shared. You can download everything we hold, or delete the account,
        from your account pages, without asking us.
      </Callout>

      <H2 id="what">What we process, and why</H2>

      <H3>Serving the pages</H3>
      <P>
        A page request passes through two hands. Cloudflare receives it
        first, as our content delivery network and reverse proxy, and it
        necessarily sees your IP address, the page asked for and your
        browser&rsquo;s user-agent string. It then forwards the request to
        our own server, which is where the site is actually hosted and which
        sees the same information in order to answer.
      </P>
      <UL>
        <li>
          <B>Who does it:</B> Cloudflare, Inc. as CDN and proxy, and Hetzner
          Online GmbH (Germany) as the provider of the machine that serves
          the site. Both act as our processors under Article 28 GDPR.
        </li>
        <li>
          <B>Legal basis:</B> our legitimate interests in operating the
          service and defending it from abuse — Article 6(1)(f) GDPR.
        </li>
        <li>
          <B>Kept for:</B> fourteen days on our own server, in the security
          log described next. Cloudflare keeps its own operational logs
          inside its platform under its retention policy; we do not export
          them, build profiles from them, or use them for anything but
          keeping the site up.
        </li>
      </UL>

      <H3>The security log</H3>
      <P>
        Our web server writes one line for every request it answers. We
        turned this on deliberately, and it is the one place on our machine
        where your IP address is written down. Sites get attacked; a log is
        the difference between knowing what happened and guessing.
      </P>
      <P>Each line holds:</P>
      <UL>
        <li>the time, to the second;</li>
        <li>
          your IP address as our content delivery network passes it to us,
          and the two-letter country code it derives from that address;
        </li>
        <li>
          the address of the page you asked for, the method, and the status
          we answered with;
        </li>
        <li>
          your browser&rsquo;s user-agent string, the TLS version and cipher
          it negotiated, how many bytes we sent, and how long we took.
        </li>
      </UL>
      <P>
        The rest of each line is about the connection rather than about
        you: which name the request arrived under, what your browser said
        it could accept, and the identifiers our content delivery network
        uses to trace a request through its own machines.
      </P>
      <P>
        It does <B>not</B> hold the contents of your cookies or of any
        authorisation header. The server writes the word REDACTED in their
        place before the line reaches the file, so a copy of this log is
        not a way to sign in as you.
      </P>
      <P>
        One thing it does hold is worth saying plainly, because it is easy
        to miss. Several tools on this site keep their state in the page
        address, so that a link can be reloaded or sent to someone: what
        you type into the site search, the filters you set on the map, and
        the answers you give the packing list and the trip cost
        calculator. While you are using them nothing is sent to us &mdash;
        they run in your browser. That address reaches us, and this log,
        when the page is <B>loaded</B> with it: because you reloaded, or
        because you or somebody else opened a saved link. Then whatever is
        in the address is written down with the rest of the line, and it
        goes when that line goes.
      </P>
      <UL>
        <li>
          <B>Who does it:</B> us, on our own server. The file can be read
          only by the account the web server runs as and by whoever
          administers the machine &mdash; not by the application that serves
          you &mdash; and it is appended to, never rewritten. Nothing copies
          it to anyone else.
        </li>
        <li>
          <B>Legal basis:</B> our legitimate interest in keeping this
          service secure &mdash; Article 6(1)(f) GDPR. Recital 49 names
          network and information security as exactly that kind of
          interest, and Article 32 requires us to take measures of this
          sort. We do not ask for your consent here, and saying so plainly
          is part of being honest about it: a security log that stops
          recording for whoever declines would not be a security log.
        </li>
        <li>
          <B>Kept for:</B> fourteen days. The server deletes older lines by
          itself, on a schedule, rather than waiting for someone to
          remember.
        </li>
        <li>
          <B>Not used for:</B> analytics, audience measurement, advertising,
          profiling, or any decision about you. It is read when something
          looks wrong, and otherwise it is not read at all.
        </li>
      </UL>
      <P>
        You can object to this under Article 21 GDPR by writing to us. We
        will weigh your objection against the security interest and tell you
        what we decided and why.
      </P>

      <H3>Your account, if you make one</H3>
      <P>
        An account exists so that what you save stays yours across devices.
        We hold the following, and nothing else:
      </P>
      <UL>
        <li>
          your email address, and whether you have confirmed it;
        </li>
        <li>
          a <B>hash</B> of your password — a one-way transformation, not the
          password. We cannot read it, recover it or tell you what it was;
        </li>
        <li>
          whether and when you agreed to receive our emails, recorded
          separately so that consent can be proven and withdrawn;
        </li>
        <li>
          sessions — the fact that a browser is signed in, and until when;
        </li>
        <li>
          what you saved: trips and their stops, saved places, photos you
          submitted, reviews you wrote.
        </li>
      </UL>
      <UL>
        <li>
          <B>Legal basis:</B> performance of the contract you entered into
          by creating the account — Article 6(1)(b) GDPR. For the newsletter
          flag specifically, your consent — Article 6(1)(a).
        </li>
      </UL>

      <H3>Email we send you</H3>
      <P>
        Confirming your address and resetting your password require us to
        send you an email, so your address passes to the mail system that
        carries it.
      </P>
      <UL>
        <li>
          <B>Who does it:</B> Hetzner Online GmbH (Germany), which operates
          our mailboxes and carries outgoing mail.
        </li>
        <li>
          <B>Legal basis:</B> performance of the contract — Article 6(1)(b)
          GDPR — for account mail; consent for anything we send you because
          you asked to hear from us.
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
          No automated decision-making that produces legal or similarly
          significant effects, and no profiling of you as a person —
          Article 22 GDPR does not arise. What you save is shown back to
          you; it is not used to score or categorise you.
        </li>
        <li>No selling, renting or sharing of personal data.</li>
        <li>
          No social-media buttons that report your visit back to a social
          network.
        </li>
      </UL>

      <H2 id="who-else">Who else sees it</H2>
      <P>
        Three processors, each acting only on our instructions under a
        contract that says so — Article 28 GDPR:
      </P>
      <UL>
        <li>
          <B>Hetzner Online GmbH</B>, Germany — the server that hosts the
          site and the database, and the mail system. Inside the EU, so no
          transfer question arises.
        </li>
        <li>
          <B>Cloudflare, Inc.</B> — content delivery network and reverse
          proxy in front of that server. Where this involves a transfer
          outside the European Economic Area, it is covered by the European
          Commission&rsquo;s Standard Contractual Clauses.
        </li>
      </UL>
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

      <H2 id="keep">How long we keep it</H2>
      <UL>
        <li>
          <B>Account data:</B> until you delete the account. We do not
          expire accounts for inactivity.
        </li>
        <li>
          <B>Sessions:</B> thirty days, then they expire on their own.
          Signing out ends one immediately; changing your password ends all
          of them.
        </li>
        <li>
          <B>Links we email you</B> — confirmation and password reset:
          one hour, and single-use.
        </li>
      </UL>

      <H2 id="rights">Your rights</H2>
      <P>
        Under the GDPR you may ask us to give you a copy of your personal
        data, correct it, delete it, restrict or object to our use of it, or
        hand it to someone else in a portable form. Where we rely on your
        consent you can withdraw it at any time, and withdrawing is as easy
        as giving it.
      </P>
      <P>
        For two of those you do not have to ask us at all. If you have an
        account, you can <B>download a file containing everything we hold
        about you</B> and you can <B>delete the account</B>, both from your
        account pages. Deleting ends your access in the same request — not
        in thirty days.
      </P>
      <Callout>
        <B>What deletion does not reach, and why.</B> One record survives:
        that a photo or a review was rejected, why, when, and for which
        place. It carries nothing that points back to you — no name, no
        address, not even a reference to the account that was deleted.
        Because no part of it identifies a person, it has stopped being
        personal data, and the right to erasure has nothing left to reach.
        We keep it to be able to account for our own moderation decisions.
        Separately, the licence you granted for photographs already
        published is a contract rather than personal data, so those
        photographs may remain — but your name comes off them on request.
        We would rather tell you where the line is than let you discover it.
      </Callout>
      <P>
        For anything else, write to{' '}
        <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>. We answer
        within one month, and if a request is complex enough to need longer
        we will tell you inside that month and say why — which is what
        Article 12(3) allows and requires.
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
        Reading this site needs no account and no age. Opening one requires
        you to be eighteen, and we ask you to confirm that rather than
        asking for your date of birth — a date we would then be holding and
        would have to protect, to answer a question that a yes already
        answers.
      </P>
      <P>
        This site is not aimed at children, and we do not knowingly open
        accounts for them or collect anything from them. If you believe a
        child has given us personal data, write to us and we will remove it.
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
