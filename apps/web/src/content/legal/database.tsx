import { A, B, Callout, H2, H3, P, UL } from './prose';

// CAMP-186 — ODbL §4.6(b), as a page rather than a promise.
//
// 🔴 WHY THIS EXISTS, and it is not goodwill. ODbL 1.0 §4.4 puts our
// Derivative Database under ODbL the moment it is published, and §4.6
// then requires us to OFFER recipients one of two things:
//
//   (a) the entire Derivative Database, or
//   (b) "A file containing all of the alterations made to the Database
//       or the method of making the alterations to the Database (such as
//       an algorithm), including any additional Contents".
//
// This page is (b). It is the cheaper of the two and it is a condition,
// not a courtesy: fail it and the licence to use OpenStreetMap at all
// falls away, and OSM is the dataset this entire site stands on.
//
// 🔴 EVERY COMPUTED FIELD MUST APPEAR HERE BY NAME.
// `scripts/ci/check-derived-fields.mjs` reads the `SpotContext`
// interface in apps/api/src/osm/spot-context.ts and fails if a field it
// declares is missing from this file. "and so on" is not a method of
// making alterations; a field nobody wrote down is a hole in §4.6.
//
// So: when you add a computed field, this page is part of the change,
// and CI will say so if you forget.

export default function Database() {
  return (
    <>
      <P>
        CampTribe is not a copy of OpenStreetMap. It is a database built{' '}
        <B>from</B> OpenStreetMap, with fields we compute ourselves and
        records from other open sources joined onto it. This page describes
        how — which data we take, what we derive from it, what we add, and
        what we throw away.
      </P>

      <Callout>
        Under the Open Database License, our derived database carries the
        same licence as the data it comes from. This page is the
        description of our alterations that ODbL §4.6 entitles you to.
      </Callout>

      <H2 id="licence">The licence on this database</H2>

      <P>
        OpenStreetMap is published under the{' '}
        <A href="https://opendatacommons.org/licenses/odbl/1-0/">
          Open Database License 1.0
        </A>
        . Because we build a derived database from it and publish the
        result, <B>our database is under ODbL 1.0 as well</B>. That is a
        separate statement from crediting OpenStreetMap, and it applies to
        the collection of campsite records as a whole.
      </P>

      <P>
        Individual records joined in from other sources keep their own
        licences, which are named on the{' '}
        <A href="/legal/attribution">attribution page</A> and beside the
        data they appear in.
      </P>

      <H2 id="taken">What we take from OpenStreetMap</H2>

      <P>
        Weekly extracts from Geofabrik, limited to the twenty-seven member
        states of the European Union. From each extract we keep objects
        tagged as places to stay with a vehicle or a tent, together with
        the tags that describe what a camper will find there — sanitation,
        water, power, connectivity, access — and the name, where the
        object has one.
      </P>

      <P>
        We keep the OpenStreetMap object reference for every record, so any
        row can be traced back to the object it came from and compared with
        the current state of the map.
      </P>

      <H2 id="computed">What we compute, and how</H2>

      <P>
        None of the following is in OpenStreetMap. Each is calculated by us
        from open data and stored alongside the record. The coordinates
        each was computed at are stored with them, so a campsite that moves
        in a later import can be recognised as needing recomputation rather
        than silently keeping numbers about its old location.
      </P>

      <UL>
        <li>
          <B>at</B> — the latitude and longitude the figures below were
          computed from. Kept so that stale derivations are detectable.
        </li>
        <li>
          <B>water</B> — the nearest lake, reservoir, river or coastline,
          with its distance in metres and its kind. Villages of water, so
          to speak, are not filtered: the nearest is the nearest.
        </li>
        <li>
          <B>town</B> — the nearest place tagged as a city or a town, with
          its distance and name. Villages are deliberately excluded: there
          are too many of them for the distance to mean anything.
        </li>
        <li>
          <B>supermarket</B> — the nearest shop that sells food, with its
          distance and name.
        </li>
        <li>
          <B>station</B> — the nearest railway station, with its distance
          and name.
        </li>
        <li>
          <B>elevation</B> — metres above sea level, from the Copernicus
          digital elevation model.
        </li>
        <li>
          <B>terrain</B> — the relief in metres and a word for it. Relief
          is the highest minus the lowest elevation across eight points on
          a one-kilometre circle plus the centre, so it describes the
          landscape the campsite sits in rather than the slope of its own
          ground. The words are fixed physical bands, not quantiles of our
          own data: under 25 m flat, 25–70 m rolling, 70–150 m hilly, above
          150 m mountainous. Bands taken from our own distribution would
          re-label the same meadow every time a different country was
          imported.
        </li>
      </UL>

      <H3>Names</H3>

      <P>
        Where a campsite has no name in OpenStreetMap, we do not invent
        one: the record is shown by its object reference. Where it has a
        name, we normalise whitespace and case for sorting and for the web
        address, and show the operator’s own spelling on the page.
      </P>

      <H2 id="joined">What we join in from elsewhere</H2>

      <P>
        Some records are matched against other open datasets, and the match
        is a derivation of ours rather than a statement by either source.
        Where two records describe one campsite, one of them is shown and
        the other is hidden from listings — it is never deleted, and the
        data read through the link is credited to the source it came from.
      </P>

      <P>
        <B>Those matched records are inside the derived database, not
        beside it.</B> A campsite we took from another open source and then
        compared against OpenStreetMap to remove a duplicate is a campsite
        of the same kind as the OpenStreetMap ones, and the comparison is
        what ties the two together. The description above, and the offer at
        the foot of this page, cover them as well — not only the records
        that came from OpenStreetMap to begin with.
      </P>

      <P>
        The sources, their licences and what each contributes are listed on
        the <A href="/legal/attribution">attribution page</A>. Every figure
        drawn from them carries the date it was read.
      </P>

      <H2 id="dropped">What we leave out</H2>

      <UL>
        <li>
          Anything outside the twenty-seven member states of the European
          Union.
        </li>
        <li>
          Objects that OpenStreetMap has removed. We mark the record as
          missing rather than deleting it, so a campsite that disappears
          answers honestly instead of becoming an unexplained gap.
        </li>
        <li>
          Records a source publishes with no usable position, since a
          campsite without a location is not something we can show on a
          map or compute a distance from.
        </li>
        <li>
          Tag values that say nothing — an empty string is not an answer,
          and storing it as one turns “unknown” into “no”.
        </li>
      </UL>

      <H2 id="copy">Asking for a copy</H2>

      <P>
        If this description is not enough for what you want to do, write to
        us and we will send the derived data itself. ODbL §4.6 gives you
        the choice between the two, and we would rather answer the question
        than have you guess.
      </P>
    </>
  );
}
