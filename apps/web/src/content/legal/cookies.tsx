import { COMPANY } from '@/lib/legal';
import { A, B, Callout, H2, P, UL } from './prose';

// CAMP-56 — Cookies.
//
// 🔴 The rule this page has to be able to survive being tested against:
// nothing goes on the reader's device before they say yes, except the
// record of what they said. That is the ePrivacy Directive (2002/58/EC,
// Art. 5(3)) and it is the single thing supervisory authorities actually
// check with a browser and a devtools panel. Our e2e test does the same.
//
// 🔴 Reject is as prominent and as cheap as Accept. GDPR Recital 32 —
// "Silence, pre-ticked boxes or inactivity should not therefore
// constitute consent" — and Art. 7(3), which requires withdrawing to be
// as easy as giving. A banner where "Accept" is a button and "Reject" is
// a grey link three clicks deep is the most-fined pattern in Europe.

export default function Cookies() {
  return (
    <>
      <Callout>
        <B>Nothing is stored on your device until you choose.</B> The banner
        has two buttons, side by side, the same size. Choosing
        &ldquo;Reject&rdquo; is one click and costs you nothing: the whole
        site works exactly the same either way.
      </Callout>

      <H2 id="what">What we store</H2>

      <P>
        <B>Your choice itself.</B> When you answer the banner we keep a
        single entry in your browser&rsquo;s local storage recording what
        you chose, when, and which version of this policy was in force. It
        stays on your device, is never sent to us, and identifies nobody.
      </P>
      <P>
        It is stored whether you accept or reject — otherwise we would have
        to ask you the same question on every page, and a site that keeps
        asking until it gets a yes is not asking. Because it is strictly
        necessary to honour your decision, it does not itself need consent.
      </P>

      <P>
        <B>That is currently the only thing.</B> This site sets no analytics
        cookies, no advertising cookies and no third-party cookies today.
        If that changes, this page changes with it, in the same release, and
        the banner will ask before anything is set.
      </P>

      <H2 id="not">What we do not do</H2>
      <UL>
        <li>
          No advertising or cross-site tracking, and no data sold or shared
          with advertisers.
        </li>
        <li>
          No cookie walls: you are never asked to accept in order to read
          something.
        </li>
        <li>
          No pre-ticked boxes and no &ldquo;by continuing to browse you
          agree&rdquo;. Silence is not consent, and we do not pretend it is.
        </li>
      </UL>

      <H2 id="change">Changing your mind</H2>
      <P>
        You can change your answer at any time from the{' '}
        <B>Cookie settings</B> link in the footer of every page, and
        withdrawing is exactly as easy as giving. Clearing your
        browser&rsquo;s data for this site also erases the record, and the
        banner will simply ask again.
      </P>

      <H2 id="tiles">The map</H2>
      <P>
        The map fetches its background imagery from an external tile
        provider. That is a direct connection from your browser to them, the
        same as loading any image, and it sets no cookies through us. It is
        not something we can consent to on your behalf, which is why the map
        names its provider underneath itself and lets you switch.
      </P>

      <H2 id="contact">Questions</H2>
      <P>
        Write to <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>.
        What we do with personal data more broadly is on the{' '}
        <A href="/legal/privacy">privacy</A> page.
      </P>
    </>
  );
}
