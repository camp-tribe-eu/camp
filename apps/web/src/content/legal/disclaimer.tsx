import { COMPANY } from '@/lib/legal';
import { A, B, Callout, H2, H3, P, UL } from './prose';

// CAMP-56 item 4 — the disclaimer, as its own page.
//
// 🔴 It was folded into the terms at first, and that was under-delivering
// against the card, which asks for it separately AND in the reader's way
// at the moment they act on what we told them. Its words: "дрібний лінк у
// футері юридично слабший — попередження має бути видиме В МОМЕНТ ДІЇ".
//
// That is not pedantry about page counts. A warning is worth what it is
// worth at the moment somebody relies on the information, and a link at
// the bottom of a page is read by nobody who is already deciding where
// to sleep tonight. So this page exists, and components/travel-notice.tsx
// puts the short version on the campsite page itself.
//
// 🔴 The honesty here is also the defence. Every sentence below is a true
// statement about how this data is produced. A disclaimer that describes
// a real limitation is worth far more than one that tries to exclude
// liability wholesale — see the note at the top of terms.tsx.

export default function Disclaimer() {
  return (
    <>
      <Callout>
        <B>Nobody from CampTribe has visited these campsites.</B> Everything
        here is derived from open data that volunteers maintain. Check with
        the campsite before you rely on any of it.
      </Callout>

      <H2 id="where">Where the information comes from</H2>
      <P>
        Campsite locations, names and facilities come from{' '}
        <A href="https://www.openstreetmap.org/">OpenStreetMap</A>, which
        anyone in the world may edit. We re-import it about once a week. The
        surroundings we show — distance to water, to a town, to a
        supermarket, the elevation and the terrain — are{' '}
        <B>calculated by us</B> from that data and from a 90-metre elevation
        model, not observed.
      </P>
      <P>
        The full list of sources and their licences is on the{' '}
        <A href="/legal/attribution">data and attribution</A> page.
      </P>

      <H2 id="what">What that means in practice</H2>
      <UL>
        <li>
          A campsite shown here may have closed, changed hands, changed its
          prices or its season, or stopped taking the kind of vehicle you
          have.
        </li>
        <li>
          A facility we show may not exist any more, and one we do not show
          may exist — an absent shower is not a statement that there is no
          shower, only that nobody recorded one.
        </li>
        <li>
          Distances and elevations are computed from models. At 90 metres a
          height reading describes the neighbourhood, not the pitch.
        </li>
        <li>
          A location can be wrong. Access roads, gates, height limits and
          surfaces are not something we know at all.
        </li>
      </UL>

      <H3>Whether you may camp there is not our answer to give</H3>
      <P>
        Camping rules differ between countries, between regions inside a
        country, and between one field and the next. Wild camping is
        restricted or forbidden in much of Europe, protected areas have their
        own rules, and private land needs the owner&rsquo;s permission.
      </P>
      <Callout>
        <B>Finding a place on this map is not permission to camp there.</B>{' '}
        That permission comes from the landowner and from the law where you
        are, and it is your responsibility to establish both.
      </Callout>

      <H2 id="routes">Routes and planning</H2>
      <P>
        Where we show a route or a distance, it is informational. We do not
        know the height, weight or length of your vehicle, and we do not
        check whether a road can carry it. Bridges, tunnels, weight limits,
        seasonal closures and surface conditions are for you and your
        navigation to establish before you set off.
      </P>

      <H2 id="safety">Your safety is yours</H2>
      <P>
        Weather, water levels, fire risk, wildlife and road conditions change
        faster than any dataset. Use official and local sources for those,
        and treat anything here as a starting point rather than an
        assurance.
      </P>

      <H2 id="better">Help us be less wrong</H2>
      <P>
        If something here is wrong, the most useful thing you can do is
        correct it{' '}
        <A href="https://www.openstreetmap.org/">at OpenStreetMap</A> — the
        fix then reaches this site and every other one built on the same
        data. You are also welcome to write to{' '}
        <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>, including if
        you own a campsite listed here.
      </P>
      <P>
        What this does and does not make us responsible for is set out in the{' '}
        <A href="/legal/terms#liability">terms of use</A>.
      </P>
    </>
  );
}
