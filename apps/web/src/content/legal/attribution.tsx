import { COMPANY } from '@/lib/legal';
import { A, B, Callout, H2, H3, P } from './prose';

// CAMP-56 — Data and attribution.
//
// 🔴 This page is not a courtesy. Attribution and share-alike are
// CONDITIONS of the Open Database License, not requests: fail them and
// the licence to use OpenStreetMap data falls away, which is the entire
// dataset this site is built on. It is the one legal obligation where the
// risk runs against us hardest, and no term of ours can alter it.
//
// 🔴 Every entry below was checked against what the code actually does,
// not copied from a template. Elevation is Copernicus but reaches us
// through Open-Meteo's endpoint (compute-context.ts), the extracts are
// Geofabrik's, the boundaries are Natural Earth, the tiles are
// OpenFreeMap over OpenMapTiles' schema. Adding a source to the pipeline
// without adding it here is how attribution quietly stops being true.

export default function Attribution() {
  return (
    <>
      <P>
        Everything on this site is built from open data. This page says
        exactly what, from whom, and under which licence — both because we
        are required to and because you should be able to check us.
      </P>

      <H2 id="osm">Campsites, and the map</H2>
      <P>
        Campsite locations, names and facilities come from{' '}
        <A href="https://www.openstreetmap.org/">OpenStreetMap</A>, ©
        OpenStreetMap contributors, available under the{' '}
        <A href="https://opendatacommons.org/licenses/odbl/">
          Open Database License (ODbL) v1.0
        </A>
        . The country extracts we import are prepared by{' '}
        <A href="https://download.geofabrik.de/">Geofabrik</A>.
      </P>

      <Callout>
        <B>If you take this data, the licence goes with it.</B> You may copy,
        adapt and use it, including commercially. What you owe in return
        depends on what you make:
        <br />
        <br />
        If you publish an adapted <B>database</B>, ODbL&rsquo;s share-alike
        applies and you must offer that database under ODbL too. If you
        publish something produced <i>from</i> the data — a map image, a
        printed guide — that work does not itself become ODbL, but it must
        carry a notice saying it came from an ODbL database. Either way,
        OpenStreetMap contributors are credited, and you may not use
        technical measures to stop others exercising the same rights.
        <br />
        <br />
        Those conditions bind us exactly as they bind you, and neither of us
        can set them aside in terms of use. The{' '}
        <A href="https://opendatacommons.org/licenses/odbl/1-0/">
          licence text
        </A>{' '}
        is the authority; this paragraph is a summary and nothing more.
      </Callout>

      <H3>What we added</H3>
      <P>
        Distance to the nearest water, town, supermarket and station, the
        terrain description and the relief figure are computed by CampTribe
        from the sources on this page. They are our derivation, they carry
        the licences of what they were derived from, and they are estimates
        — see the <A href="/legal/terms">terms of use</A>.
      </P>

      <H2 id="datatourisme">French campsites: names, descriptions and stars</H2>
      <P>
        Campsites in France also come from{' '}
        <A href="https://www.datatourisme.fr/">DATAtourisme</A>, France’s
        national tourism data platform, whose records are written by
        regional tourist offices and aggregated by ADN Tourisme. It is
        published under the{' '}
        <A href="https://www.etalab.gouv.fr/licence-ouverte-open-licence/">
          Licence Ouverte 2.0 (Etalab)
        </A>
        , which permits commercial reuse worldwide and asks for
        attribution in return.
      </P>
      <P>
        It gives us three things OpenStreetMap does not carry at all: the
        campsite’s own description, its <B>official star classification</B>{' '}
        — the French state rating, not ours — and, for most sites, the
        operator’s website.
      </P>
      <Callout>
        <B>The licence asks for the date, not only the name.</B> It says a
        reuse must not mislead anyone about the information, its source or
        its date of last update. The records we hold were last touched
        anywhere between January 2022 and this week, so a single notice at
        the foot of the site would do exactly that. Every campsite page
        therefore carries its own “where this comes from” block naming the
        source, the licence, which fields came from it and the day that
        source last changed them — and says so plainly when nothing has
        changed in over two years.
      </Callout>
      <P>
        We do not translate those descriptions. They are quoted as
        published, in French, marked as French so that a screen reader
        pronounces them properly. A machine translation of somebody else’s
        words, printed as though it were theirs, would be the kind of
        invention this site exists not to do.
      </P>

      <H2 id="tiles">Background map tiles</H2>
      <P>
        Map imagery is served by{' '}
        <A href="https://openfreemap.org/">OpenFreeMap</A>, using the{' '}
        <A href="https://openmaptiles.org/">OpenMapTiles</A> schema, from
        OpenStreetMap data — © OpenStreetMap contributors, ODbL. The map is
        drawn in your browser by{' '}
        <A href="https://maplibre.org/">MapLibre GL JS</A> (BSD-3-Clause).
      </P>

      <H2 id="boundaries">Regions and boundaries</H2>
      <P>
        Which region a campsite belongs to is resolved against{' '}
        <A href="https://www.naturalearthdata.com/">Natural Earth</A>{' '}
        administrative boundaries, which are in the public domain. Natural
        Earth generalises coastlines, so a campsite on a spit or an island
        may sit just outside its own region&rsquo;s drawn outline; we assign
        it to the nearest boundary within five kilometres rather than
        leaving it without a region.
      </P>

      <H2 id="elevation">Elevation and terrain</H2>
      <P>
        Height above sea level and the relief figure come from the{' '}
        <A href="https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model">
          Copernicus DEM
        </A>{' '}
        at 90 m resolution, reached through{' '}
        <A href="https://open-meteo.com/">Open-Meteo</A>&rsquo;s elevation
        endpoint. Produced using modified Copernicus data.
      </P>
      <P>
        At 90 m a single reading is a description of the neighbourhood, not
        of the pitch. Treat metres as approximate.
      </P>

      <H2 id="type">Typefaces</H2>
      <P>
        Text is set in <B>Archivo</B> and <B>Archivo Narrow</B> by
        Omnibus-Type, released under the{' '}
        <A href="https://openfontlicense.org/">SIL Open Font License</A>, and
        served from our own domain rather than from a font network — so
        reading this page tells nobody else that you did.
      </P>
      <P>
        The labels drawn on the map itself are set in Noto Sans, which
        comes from the tile provider along with the imagery, not from us.
      </P>

      <H2 id="wrong">Something wrong on the map?</H2>
      <P>
        If a campsite is missing, closed or described incorrectly, the most
        useful thing you can do is fix it{' '}
        <A href="https://www.openstreetmap.org/">at OpenStreetMap</A> — the
        correction then reaches this site and every other one built on the
        same data, usually within a week.
      </P>
      <P>
        You are also welcome to write to{' '}
        <A href={`mailto:${COMPANY.email}`}>{COMPANY.email}</A>, including if
        you are the owner of a campsite listed here.
      </P>
    </>
  );
}
