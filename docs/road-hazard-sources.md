# Road hazard and conditions: which EU sources we take, and which we refuse

CAMP-111. Written 28.09.2026. Every number below comes from a live request
made that day, and every licence verdict quotes the sentence it rests on,
with the URL and the date it was read. Nothing here is recalled.

## Why this card exists

The owner, 24.09.2026:

> I once drove through a storm and squalls in Croatia, and on the passes
> the car was simply being blown about, because there was black ice, and
> it happened instantly. Knowing in advance would have saved a life,
> because you should not take a camper van or a trailer into those
> conditions.

A high-sided camper in a squall on a mountain pass is different physics
from a car. The person has the right to know **before** they set off.

While this card was being checked, the Croatian service had this warning
live — the coincidence is worth recording, because it is the exact
geography of the story above:

```
cap:event      Yellow wind warning
cap:areaDesc   Velebit channel region      (EMMA_ID HR803)
cap:onset      2026-09-27T22:01:01+00:00
cap:expires    2026-09-28T21:59:59+00:00
cap:severity   Moderate     cap:certainty Likely     cap:urgency Future
sender         DHMZ – Croatian Meteorological and Hydrological Service
```

Read 28.09.2026 from
`https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-croatia`.

That is the whole product in one record: an official service already said
it, and the driver would not have found it across twenty sites.

## What this card does not promise

**We do not become an emergency service.** We mirror what official
services have already published, with a link to the primary source and
the time it was last updated, and we say plainly that the decision is the
driver's. The difference between "here is the Croatian met service's
warning" and "we say it is dangerous to drive" is enormous, legally and
morally, and we do not do the second.

**Data can go stale or fail to arrive.** Then the page must say "no fresh
data", never show empty. Emptiness reads as "all clear" — and on this
card that misreading could put someone on a pass in a squall. The
measurements below show this is not a hypothetical: both public
MeteoAlarm endpoints serve expired warnings as though they were current,
so the staleness has to be handled by us, on our side, every time.

---

## The sources table

*(filled in below — see each section for the evidence behind the verdict)*

---

## 1. MeteoAlarm (EUMETNET) — **TAKE**

The aggregator of the 27 national meteorological services. This is the
spine of the feature.

### Licence — permits commercial use, with seven conditions

Every ATOM feed carries its licence inline, in the `<rights>` element
(read 28.09.2026):

> Copyright © 2026 MeteoAlarm.Org. Licensed under terms equivalent to CC
> BY 4.0, with additional requirements for redistributing outlined in our
> Terms and Conditions.

The binding text is at
`https://meteoalarm.org/en/live/page/terms-and-conditions`
(read 28.09.2026; the page itself states "Last Updated: 15/03/2024").

Clause 4 settles the question of whether an aggregator may license other
people's data at all — the answer is that it does not claim to own it,
but clause 5 grants the terms anyway:

> The ownership of the Information provided on the MeteoAlarm Website and
> related Intellectual Property Rights remains with the MeteoAlarm
> Participants who originally generated them.

Clause 5 is the grant, and it is the operative text for us:

> All Information on the MeteoAlarm Website may be used and redistributed
> under terms equivalent to the Creative Commons Attribution 4.0
> International License (CC BY 4.0), along with the following additional
> requirements:

The seven requirements, quoted, each of which is a build constraint:

> If the Information being redistributed is modified in any way, it must
> be redistributed along with the same Information without any material
> change or modification.

> If the Information being redistributed spans more than one country, the
> source of the Information must always be displayed as "EUMETNET –
> MeteoAlarm".

> If the Information being redistributed spans a single country, the name
> of the relevant MeteoAlarm Participant (National Meteorological and
> Hydrological Service) must always be displayed.

> The time of issue of the Information being redistributed, as indicated
> on the MeteoAlarm Website at the time the Information is extracted,
> must be included in any redistribution.

> Any Information being redistributed through internet applications must
> include a link to the following URL: www.meteoalarm.org.

> Any Information being operationally redistributed must always be made
> available to users in real-time, with the delay between the publishing
> on the MeteoAlarm Website and the redistributor's website being on
> average less than five minutes and never longer than ten minutes.

> All redistributors must publish the following disclaimer: "Time delays
> between this website and the www.meteoalarm.org website are possible.
> For the most up-to-date awareness information as published by the
> participating National Meteorological and Hydrological Services, please
> refer to www.meteoalarm.org."

**Verdict: commercial use is permitted.** CC BY 4.0 carries no
non-commercial and no share-alike restriction, and clause 5 adds none.

**But the sixth requirement is an architecture decision, not a footnote.**
"On average less than five minutes and never longer than ten minutes"
rules out a nightly or hourly refresh. A daily cron against this source
would put us in breach of the licence on every single day it ran. Either
we poll every few minutes, or we take the push interface (see below), or
we do not take this source at all.

Liability is disclaimed by them entirely (clause 3), which is one more
reason our wording must stay "the Croatian service says", never "it is
dangerous here":

> Under no circumstances are the MeteoAlarm Participants liable to you or
> any third party for any direct, indirect, incidental, consequential,
> special, or exemplary damages or lost profits arising from the use,
> redistribution, or misinterpretation of the provided Information.

### Coverage — all 27 answer, but that is not the same as covering 27

Every EU-27 country has a working feed. Measured 28.09.2026, ~14:50 UTC,
`https://feeds.meteoalarm.org/api/v1/warnings/feeds-<country>`: **27 of
27 returned HTTP 200.** So the card's question "does MeteoAlarm have
feeds for all 27" has the answer yes.

The useful question is a different one. Of those 27, three returned
literally `{"warnings":[]}` — Czechia, Luxembourg, Malta — and nine had
no live warning of any level at that moment. HTTP 200 is not coverage.

### The number that matters is much smaller than the feed suggests

This is the single most important measurement on the card. The feed is
not a list of current warnings; it is an archive with current warnings
mixed in.

Across all 27 countries, 28.09.2026:

| filter applied | entries left |
| --- | --- |
| everything the JSON API returns | **1 954** |
| after dropping `expires` in the past and `responseType: AllClear` | 1 038 |
| after also dropping `awareness_level: 1` (green — not a warning) | **308** |

So **308 genuinely actionable warnings EU-wide**, not 1 954: 271 yellow,
37 orange, 0 red. Green alone accounted for 730 of the 1 038 survivors —
the Netherlands contributed 475 green records and not one warning, which
is why its ATOM feed is empty while its JSON feed is the second largest.

The card's starting note said Croatia had "257 active warnings". Re-measured
today, Croatia returns **68 entries, of which 63 have already expired and
54 are explicitly `AllClear`, leaving 5 live warnings.** The original
figure counted the archive.

Worst staleness still being served, by country — the age of the oldest
already-expired entry the feed handed us:

| country | expired entries served | oldest, days past `expires` |
| --- | --- | --- |
| Estonia | 62 | 5.5 |
| Germany | 50 | 5.4 |
| Netherlands | 13 | 5.4 |
| Croatia | 63 | 5.3 |
| Spain | 135 | 4.9 |
| Austria | 104 | 4.1 |

### The provider's own documentation is wrong about this

The Redistribution Hub
(`https://meteoalarm.org/en/live/page/redistribution-hub`, read
28.09.2026) states:

> Disclaimer: Please note that warnings with the CAP element marked as
> "Cancel" are not included in the MeteoAlarm Feeds. Instead, these
> cancellations result in the referenced warnings being removed from the
> MeteoAlarm Feeds. Therefore, only active warnings are included.

"Therefore, only active warnings are included" is false as measured on
both public endpoints. The ATOM feeds — the ones aimed at redistributors
— carried **712 entries for the EU-27, of which 358 (50.3%) had already
expired**, the oldest by 1.7 days. Poland is the cleanest counter-example:
its ATOM feed served 69 entries, **every one of them expired at
2026-09-27T07:00:00+00:00**, more than 31 hours before we read it.

Believing that sentence is how a page ends up showing a driver a
day-old wind warning as though it were current. **We filter on `expires`
and on `awareness_level` ourselves, on every read, and we treat the
documentation as unverified.**

The two public endpoints also disagree with each other, in both
directions, and neither is a superset:

| | JSON `feeds-<country>` | legacy ATOM |
| --- | --- | --- |
| includes green (level 1) | yes | no |
| includes expired | yes (46.9% noise) | yes (50.3% expired) |
| geocodes | EMMA_ID + NUTS3/NUTS2/WARNCELLID/FIPS | EMMA_ID only |
| Netherlands | 488 entries | 0 entries |
| Poland | 69, all expired | 69, all expired |
| Ireland | 68 | 212 |

We take the **JSON API**, because only it carries the NUTS codes we need
to join a warning to a campsite, and we filter it hard.

### Joining a warning to a campsite is a real piece of work

A warning does not carry a shape. Only **342 of 24 315 areas (1.4%)** had
an inline `polygon`, and only from Estonia, Latvia, Slovenia and Sweden.
Everything else is a code, and there are five different schemes:

| scheme | occurrences | who uses it |
| --- | --- | --- |
| EMMA_ID | 21 358 | most countries |
| NUTS3 | 5 350 | Bulgaria, France, Romania, Croatia |
| WARNCELLID | 2 160 | Germany (DWD-specific) |
| FIPS | 706 | Ireland |
| NUTS2 | 522 | Belgium, Hungary |

Hungary publishes at NUTS2 only, which is a region far larger than a
campsite's useful radius — a warning there will always be coarse, and we
should not pretend otherwise in the UI.

The geometry to resolve EMMA_ID exists and is public: a 33 MB GeoJSON at
`https://gitlab.com/meteoalarm-pm-group/documents/-/raw/master/MeteoAlarm_Geocodes_2026_07_31.json`
(HTTP 200, read 28.09.2026), **2 006 features, 1 741 Polygon and 265
MultiPolygon**, of which 1 900 are EU-27.

Three EU countries have **zero** features in it — **Estonia, Luxembourg
and Sweden**. Estonia and Sweden are recoverable because they are exactly
the countries that send inline polygons instead (186 and 18 areas
respectively). Luxembourg has neither, and also sent no warnings.

Two operational cautions, both measured:

- The file is dated `2026_07_31` and the Hub's own changelog lists
  repeated removals and refinements ("Removal of obsolete geocodes for
  Estonia", "Refinement of existing geocodes for France to improve
  accuracy"). Our join table will drift. It needs a re-sync and a test
  that fails when a warning arrives with a code we cannot resolve.
- The **shapefiles are distributed as Google Drive personal share links**
  (`drive.google.com/file/d/1c5YmDo4v1Oe2YYhlZZayS9bRqPtFfScq/view`). That
  is not a dependency a production build should have. The GitLab GeoJSON
  is the one to use.

One more integration trap: `awareness_type` is not consistently cased
across services. In a single day's data we saw `1; Wind` and `1; wind`,
`3; Thunderstorm` and `3; thunderstorm`, `4; Fog` and `4; fog`, `10; Rain`
and `10; rain`. Anything that keys off that string without normalising
will silently split one hazard into two.

Live hazard mix (the 1 038 non-expired records, before the green filter),
which tells us what the feature is actually about:

```
197  Rain          104  Fog                 7  flooding
189  low-temp       97  snow-ice            6  avalanches
154  Thunderstorm   97  high-temp           2  rain-flood
147  Wind           24  coastalevent        1  forest-fire
```

Wind is fourth by volume and first by relevance to a high-sided vehicle.

### There is a better interface, and it is gated

The API portal (`https://api.meteoalarm.org`, read 28.09.2026) advertises
an **EDR API for Re-users** — OGC Environmental Data Retrieval, with
"MQTT real-time warnings" and GeoJSON responses. That is precisely the
interface that makes the five-minute licence rule easy instead of
expensive, and it can answer "what is in force at this point" directly.

Measured: discovery is open, data is not.

| endpoint | status |
| --- | --- |
| `/edr/v1/collections` | 200 — one collection, `warnings`, bbox `[-35, 20, 55, 75]`, query type `locations` |
| `/edr/v1/collections/warnings/locations` | **401 Unauthorized** |
| `/edr/v1/collections/warnings/locations/HR803` | **401 Unauthorized** |
| `/metadata/v1` | 200 |
| `/metadata/v1/regions` | **401 Unauthorized** |

The open path is the legacy one, and the provider says so itself: the
ATOM feeds are "maintained for backward compatibility with existing
integrations". The portal also advertises a "Europe-wide aggregated feed",
and the deprecated pan-European RSS feed points at it explicitly —

> This RSS feed has been deprecated. Please use the Atom feed instead:
> https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-europe

— but that URL returns **HTTP 404**. There is no working EU-wide feed
today. It is 27 endpoints, polled separately, or nothing.

**Verdict: TAKE**, on the JSON country feeds with our own filtering, and
open a request for EDR credentials in parallel because the licence's
five-minute rule and the per-location query both point the same way.

---

## 2. Whether we may show a warning next to a campsite

Yes — and the licence tells us exactly how, which is a gift, because it
converts a legal question into a checklist.

Mirroring an official warning with a link is permitted by clause 5.
Saying "it is dangerous here" is us generating a new assertion, which no
licence covers and no disclaimer saves. **We do not do the second.**

Concretely, every place a warning appears must carry:

1. the issuing national service by name (single country) or "EUMETNET –
   MeteoAlarm" (more than one), per clause 5;
2. the time of issue as it stood when we extracted it, per clause 5;
3. a link to `www.meteoalarm.org`, per clause 5;
4. the disclaimer sentence, verbatim, per clause 5;
5. our own line that the decision is the driver's;
6. and, when the data is older than our freshness budget, **"no fresh
   data"** — never an empty space.

Point 6 is ours, not theirs, and the measurements above are why it is not
optional.

---

## 3. Traffic cameras — **REJECT as a pan-EU layer; TAKE two countries**

The owner's ask was "if there is a camera nearby, just look with your own
eyes." The suspicion in the card was that coverage is uneven and
embedding is often forbidden. That suspicion is confirmed, and the
reality is worse than uneven: **the most common answer in the EU is not
"no API", it is "no permission".**

| country | endpoint | open? | commercial reuse | verdict |
| --- | --- | --- | --- | --- |
| **Finland** | `tie.digitraffic.fi/api/weathercam/v1/stations` 200 | yes, anonymous | **yes, explicitly** | **TAKE** |
| **Estonia** | `tarktee.transpordiamet.ee`, dataset `CC_BY` | key, manual approval | yes | **TAKE, gated** |
| Austria | ASFINAG webcams page 200 | viewable | **no** | reject (partner route exists) |
| Ireland | TII `data.tii.ie` | viewable | **no** | reject |
| Slovenia | `promet.si` 200, GeoJSON 403 | no | **no** | reject |
| Spain | DGT page 200 | viewable | **no** | reject |
| Netherlands | no camera dataset on `opendata.ndw.nu` | — | — | nothing to take |
| Denmark | withdrawn by the road authority | — | — | nothing to take |
| Sweden | Trafikverket API 401 | key | unverified | not verified |
| DE, CZ, FR, IT, PL, PT | — | — | — | **could not verify** |

### Finland — verified, and this is the one we build on

Measured 28.09.2026: `https://tie.digitraffic.fi/api/weathercam/v1/stations`
returned HTTP 200 and **809 stations** (the request needs
`Accept-Encoding: gzip`, otherwise the API answers 406). Images are stills,
e.g. `https://weathercam.digitraffic.fi/C0150301.jpg`, `image/jpeg`.

Licence, read 28.09.2026 at `https://www.digitraffic.fi/en/terms-of-service/`:

> Fintraffic's open data is licensed under the Creative Commons 4.0 By
> license. It gives the right to distribute, remix, tweak, and build upon
> our data, even commercially, as long as you credit the source for the
> original creation.

The attribution string they require is given on the same page:

> Source: Fintraffic / digitraffic.fi, license CC 4.0 BY

Worth noting against the project's habit of measuring: Digitraffic's own
documentation describes "more than 470" road weather cameras. The API
returned 809 stations. The docs are stale; the endpoint is the truth.

### Austria — the clearest "no", and it forbids even linking

This one is worth quoting at length because it is the opposite of what
most people assume about a public road authority. From
`https://media.asfinag.at/media/lsgfvnz1/webcam-informationen-durch-webcampartner.pdf`
(HTTP 200, read 28.09.2026; document version 2.2, dated 20.03.2012):

> Eine Nutzung der Webcams in Form der Verlinkung bedarf der vorherigen
> Freigabe der ASFINAG. Eine Nutzung der Webcams in Form der Verlinkung
> ohne vorherige Abstimmung mit der ASFINAG ist nicht zulässig.

*(Use of the webcams in the form of linking requires ASFINAG's prior
approval. Use of the webcams in the form of linking without prior
agreement with ASFINAG is not permitted.)*

And the general terms
(`https://media.asfinag.at/media/b3fngdvg/webcam-informationen-nutzungsbedingunge_-august-2007.pdf`,
HTTP 200, read 28.09.2026):

> Die Webcam-Informationen dürfen ausschließlich zur privaten Nutzung
> verwendet werden.

*(The webcam information may be used exclusively for private use.)*

**Not merely "do not hotlink the image" — do not link at all without
written approval.** There is a legal route: the same document says
linking is in principle free of charge for an approved Webcam-Partner,
who must report access figures on request and whose access ASFINAG may
throttle. That is a business-development conversation, not an
engineering task, and it belongs to the owner.

### The other refusals, each in one sentence

- **Ireland**, `data.tii.ie/termsconditions.html`: *"you agree not to link
  your websites or any other third party website to the Site without the
  express prior written consent"*, and *"This Site is for your personal,
  non-commercial use."*
- **Slovenia**, `promet.si/sl/kolofon`: *"Dokumenti, objavljeni na teh
  spletnih straneh, so lahko reproducirani le v nekomercialne namene"* —
  non-commercial purposes only.
- **Spain**, `dgt.es/contenido/aviso-legal/`: unauthorised reproduction,
  distribution or *comercialización* "a no ser que sea para uso personal
  y privado" is an infringement of intellectual property rights.
- **Netherlands**: not a licence problem — there is simply no camera
  dataset on the NDW open-data portal.
- **Denmark**: the road authority removed the webcams from its own site.

### Verdict

**A pan-EU "look with your own eyes" layer is not legally available, and
no amount of engineering changes that.** Two of the twelve countries
checked are usable: Finland outright, Estonia after a manually approved
key. Six were not verified and must not be assumed either way.

So the feature ships as Finland plus Estonia, honestly labelled as such,
or it does not ship. Austria and Ireland can only ever be added through
signed permission. On the plus side, the privacy question largely
answers itself: these are low-resolution stills of road surfaces, and no
operator we read claims otherwise — though we found no operator clause
stating a non-identification rule either, so that remains unverified
context rather than evidence.

---

## 4. Traffic and road conditions via National Access Points — **REJECT at launch**

The ITS Directive obliges every member state to publish road data, and
the European Commission's index page is live
(`https://transport.ec.europa.eu/transport-themes/intelligent-transport-systems/road/action-plan-and-directive/national-access-points_en`,
HTTP 200, read 28.09.2026).

The index page itself carries no list. The list is a PDF —
`its-national-access-points.pdf`, HTTP 200, 290 KB, marked "updated
October 2025" — and it does contain all 27 member states, each once,
across five columns (MMTIS, RTTI, SRTI, SSTP, SSTP-EU). For this card the
column that matters is **SRTI: safety-related traffic information**, which
is where ice, wind, obstructions and accidents live.

The card's red flag was right. **"Twenty-seven integrations is not
'connect an API'" is an understatement.** Sampled on live requests:

| country | result |
| --- | --- |
| **Netherlands** | best case: `opendata.ndw.nu/veiligheidsgerelateerde_berichten_srti.xml.gz` HTTP 200, anonymous, DATEX II v3, **263 situation records** (220 VehicleObstruction, 26 Accident, 17 GeneralObstruction) |
| **Finland** | open and CC BY: `traffic-message/v1/messages` 200, `weather/v1/stations` 200 |
| Sweden | registration required (401) |
| Estonia | registration plus manual approval |
| AT, CZ, DK, ES, PL, FR, IT, GR, IE, HU, LT | root answers 200, but resolves to a portal shell or a catalogue page, not a feed |

**A 200 at the root is not access.** Of six countries sampled in depth,
two produced real data to an anonymous client. Several "NAPs" are only
catalogue entries pointing at a national open-data portal (Ireland →
`data.gov.ie`, Luxembourg → `data.public.lu`, Poland → `dane.gov.pl`),
with no DATEX feed behind them.

And the best case is itself blocked: **the Dutch SRTI feed states no
licence at all.** Under this project's rule — no explicit permission for
commercial use means the source is not taken — the Netherlands is
unavailable until someone obtains that permission in writing, however
open the data looks. The feed also contained no ice or wind records in
the sample, which are the two hazards this card exists for.

France is the tantalising one: `bison-fute.gouv.fr/directive-sti.html`
returns 200 and describes exactly the right content — *"route glissante,
véhicule en contresens, obstacle sur la voie, accident"* — but access runs
through a subscription step we could not complete, so whether a
convention is required is **unverified**.

**Verdict: REJECT at launch.** Twenty-seven separate portals, schema
dialects, licences and registrations, to obtain hazard data that
MeteoAlarm already delivers for weather in one consistent CAP format
across all 27. The road-specific extras — closures, accidents,
obstructions — are real value, but they are a second-phase feature bought
country by country against measured demand, starting with Finland (proven
feed and proven licence) and the Netherlands (proven feed, licence to be
obtained).

---

## New cards this spawns

*(see the end of the document)*
