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

Every verdict below is argued, with its quotation, in the section named.

| source | what it gives | licence verdict | coverage | latency | verdict |
| --- | --- | --- | --- | --- | --- |
| **MeteoAlarm** (§1) | official weather warnings: wind, ice, snow, storm | CC BY 4.0-equivalent **plus 7 conditions**, incl. a 5-minute redistribution rule | 27/27 feeds answer; 308 live warnings EU-wide when measured | licence demands <5 min, **but the public feed rebuilds every 30 min** (§8) | **TAKE**, and request EDR credentials |
| **EFFIS / GWIS** (§5) | wildfire hotspots and burnt-area perimeters | CC BY 4.0, no key, no registration | EU-wide, 18 362 fires this season | 2–3 h hotspots, daily perimeters | **TAKE** |
| **Fuel per station** (§6) | ES, FR, IT per-station prices | commercial reuse explicit in all three | ~45 000 stations | 30 min – 24 h | **TAKE 3** |
| **Tankerkönig** (DE) (§6) | German per-station prices | CC BY 4.0 live data only | national | live | **TAKE, on-demand only** (1 req/min) |
| **Cameras: Finland** (§3) | 809 roadside camera stations, stills | CC BY 4.0, *"even commercially"* | Finland | ~10 min | **TAKE** |
| **Cameras: Estonia** (§3) | links to the latest camera images | `CC_BY` | Estonia | live links | **TAKE** after manual key approval |
| **Open Charge Map** (§7) | EV/campervan charging points | CC BY 4.0 — **but only user-contributed records** | EU-wide | n/a | **TAKE**, with per-record attribution |
| Cameras: AT, IE (§3) | motorway webcams | **linking itself forbidden without written consent** | — | — | **REJECT** (partner route exists) |
| Cameras: SI, ES (§3) | traffic cameras | **non-commercial only** | — | — | **REJECT** |
| Cameras: NL, DK (§3) | — | — | no imagery published at all | — | **nothing to take** |
| **NAP / DATEX II** (§4) | closures, accidents, obstructions | 27 separate licences; NL best case has **none stated** | 2 of 6 sampled gave data anonymously | varies | **REJECT at launch** |
| Fuel: AT (§6) | per-station prices, open endpoint | **no licence exists for consumers** | — | — | **REJECT** pending an email |
| Fuel: PT, HU (§6) | per-station prices | **commercial use explicitly prohibited** | — | — | **REJECT** |
| Fuel: BE, GR, PL (§6) | — | — | not published per station | — | **nothing to take** |

Not checked, and therefore neither taken nor rejected: cameras and NAPs
for **Germany, Czechia, France, Italy, Poland, Portugal**; Swedish
cameras; Slovenian and Croatian fuel licences; EAFO's licence. "Not
checked" is not "negative", and none of these should be quoted as a
refusal later.

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

We take the **JSON API** and we filter it hard.

> 🔴 **Correction, 05.10.2026 — the third attempt at this paragraph.**
>
> It first said the JSON API is taken "because only it carries the NUTS
> codes we need". I measured four countries and replaced that with
> "there is no NUTS code anywhere in it". Review measured eleven and
> that was false too, so I wrote "four schemes". Review then took a
> census of **all 27 feeds** — and four is wrong as well:
>
> | scheme | geocodes | where |
> | --- | --- | --- |
> | `EMMA_ID` | 26 318 | most member states |
> | `NUTS3` | 6 586 | France and Bulgaria |
> | `WARNCELLID` | 5 672 | Germany, alongside `EMMA_ID` |
> | `NUTS2` | 566 | Belgium and Hungary |
> | `FIPS` | 393 | Ireland |
> | `CISORP` | 6 | Czechia |
>
> **Six schemes.** CAMP-149 named `NUTS2` from its own 27-country
> measurement and I had dismissed it from a sample of eleven; it was
> right and I was not.
>
> **And then I over-counted the other way.** "Seven member states carry
> no area code" was the fourth generalisation in this paragraph's
> history, and it is wrong in both directions. Measured on all 27 feeds
> (2026-10-05), three states code nothing: Estonia (154 areas, 0 coded),
> Slovenia (8 / 0), Sweden (22 / 0). Four of the seven I named —
> Luxembourg, Malta, Romania, Slovakia — answer `{"warnings":[]}`,
> fifteen bytes holding no alert at all. That is an absence of data, not
> an absence of codes, and nothing about their geography is measurable
> from it. The same count missed Latvia, which codes 14 of its 508
> areas — partial, and the case hardest to see.
>
> 🔴 **The lesson is not about MeteoAlarm.** Three times in one day I
> replaced a generalisation with a narrower one drawn from a slightly
> wider sample, and each felt like a correction. A refutation is a claim
> too. Write the census or write the sample size; do not write "nowhere"
> from eleven of twenty-seven.
>
> What stands: the JSON API is the one to take, and the fetch keeps
> every `SCHEME:VALUE` pair, the free-text `areaDesc` and any polygon,
> because we do not yet know which we will need. Resolving them is
> CAMP-149, and it needs one geometry source per scheme — the
> MeteoAlarm geocode file answers `EMMA_ID` only, all 2 006 of its
> features.

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

This matters more than it looks. §8 shows the open feeds rebuild only
every 30 minutes, which is six times slower than the licence's own
five-minute rule allows — so the gated interface is not a nicety, it is
the only way to redistribute operationally and stay inside clause 5.

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

### Estonia — open, but a human has to approve the key

Verified on the Estonian open-data API 28.09.2026: the dataset "Images
from road cameras" (`avaandmed.eesti.ee/api/datasets/…`, HTTP 200)
carries `"license": "CC_BY"` on its distribution, and describes itself as
*"web links of the most recent images of roadside road cameras"* — so
linking to the image is the intended delivery model, not a workaround.

Usefully, the same record is declared as an ITS National Access Point
dataset (`dataStandardCl: DATEX_II`, `SRTI_DATA_TYPE:
WEATHER_CONDITIONS`), which makes Estonia one of the few countries where
the camera layer and the road-conditions feed are the same registration.

The gate is procedural: the API key needs manual human approval, so the
application has to be made well before the sprint that depends on it.

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

## 5. EFFIS / GWIS wildfire (Copernicus) — **TAKE**

The cleanest source on this card: open licence, no key, no registration,
and a better API than we expected.

### Licence — CC BY 4.0, commercial use allowed

Read 28.09.2026 at
`https://forest-fire.emergency.copernicus.eu/about-effis/data-license`
(HTTP 200):

> Unless otherwise indicated (e.g. in individual copyright notices),
> content owned by the EU on this website is licensed under the Creative
> Commons Attribution 4.0 International (CC BY 4.0) licence. This means
> that reuse is allowed, provided appropriate credit is given and changes
> are indicated.

EFFIS does run a data-request form, and the card was right to suspect an
extra condition — but checked, it does not reach us
(`/applications/data-and-services`, read 28.09.2026):

> For any request of data which is not not available through the EFFIS
> Web services (e.g. historic data, extracts of the fire database, or raw
> burned area perimeters) we kindly ask you to use our DATA REQUEST FORM

*(the doubled "not" is theirs)*. The form covers what the web services do
**not** serve. The WMS and WFS layers need no request, no registration and
no key.

### The card's remembered layer count was wrong

Re-measured 28.09.2026:
`https://maps.effis.emergency.copernicus.eu/gwis?service=WMS&request=GetCapabilities&version=1.3.0`
returned HTTP 200, 220 181 bytes — and parsing the XML gives **140 named
layers, 84 of them queryable**, not the 266 the card carried forward.
`gwis.globfire.finalperim` does exist, but with `queryable="0"`, so
`GetFeatureInfo` against it returns `LayerNotDefined`. The sister `/effis`
endpoint serves a further 67 named layers.

This is exactly why the project rule says a figure is measured, not
remembered — 266 would have survived indefinitely if nobody had counted.

### It is not WMS-tiles-only: there is a per-fire GeoJSON feed

The useful discovery. On the `/effis` endpoint (the `/gwis` WFS times
out):

```
…/effis?service=WFS&version=1.1.0&request=GetFeature
        &typename=ms:modis.ba.poly.season&outputformat=geojson
→ HTTP 200, 132 MB, 115 s, 18 362 features
```

Per-fire attributes include `FIREDATE`, `LASTUPDATE`, `COUNTRY`,
`PROVINCE`, `COMMUNE`, `AREA_HA`, land-cover breakdown and `PERCNA2K`
(share inside Natura 2000). Freshness was measured rather than assumed:
the maximum `LASTUPDATE` in the response was **2026-09-28 14:40:50** —
the same day as the query. Top EU-27 counts this season: Italy 2 145,
Spain 2 040, France 1 694, Portugal 1 323, Romania 666.

`maxfeatures` is honoured, which matters — 132 MB is not something to
fetch per page view.

### Latency, quoted

> Information on active fires is normally updated 6 times daily and made
> available in EFFIS within 2-3 hours of the acquisition of the
> MODIS/VIIRS images.

> Daily, two full image mosaics the European territory are processed in
> EFFIS to derive burnt area maps, every day.

with the resolution limit stated as:

> Burnt scars of approximately 30 hectares in size are mapped

So active-fire hotspots run 2–3 hours behind satellite; burnt-area
perimeters are daily and only catch fires above roughly 30 ha. **Neither
is an evacuation signal**, and the UI must not imply it is. This is
context for planning a trip, not a live emergency layer — which sits
comfortably inside what this card promises.

---

## 6. Fuel prices per station — **TAKE 3, plus Germany on a leash**

CAMP-55 already gives weekly per-country averages. Per-station is a
different matter, and the honest answer is four countries, not twelve.

| country | endpoint | open | commercial | verdict |
| --- | --- | --- | --- | --- |
| **Spain** | `sedeaplicaciones.minetur.gob.es` REST, 200, 12.2 MB, **11 498 stations**, refreshed every half hour | no key | **yes** | **TAKE** |
| **France** | `data.economie.gouv.fr` flux instantané v2, 200, **9 807 stations** | no key | **yes** | **TAKE** |
| **Italy** | `mimit.gov.it` CSV, 200, **23 999 stations** with coordinates, daily 08:00 | no key | **yes** | **TAKE** |
| **Germany** | Tankerkönig, 200 with a free key | key | yes, live data only | **TAKE, on-demand only** |
| Austria | `api.e-control.at/sprit/1.0/` 200, no key, no rate limit | yes | **no licence exists** | reject, pending an email |
| Portugal | DGEG API 200, real per-station JSON | yes | **explicitly forbidden** | reject |
| Slovenia | `goriva.si/api/v1/search/` 200, 551 stations | yes | unverified | hold |
| Croatia | `webservis.mzoe-gor.hr` 200, 912 stations | yes | unverified | hold |
| Hungary | `holtankoljak.hu` | robots.txt disallows | **no** | reject |
| Belgium | maximum prices only | — | — | not per-station |
| Greece | daily PDF per prefecture | — | — | not per-station |
| Poland | 68 datasets screened, no retail price field | — | — | does not exist |

The three clean licences, quoted:

- **Spain**, datos.gob.es: *"Las presentes condiciones generales permiten
  la reutilización de los documentos sometidos a ellas para fines
  comerciales y no comerciales."*
- **France**, Licence Ouverte 2.0: *"de l'exploiter à titre commercial"*,
  *"à des fins commerciales ou non, dans le monde entier"*.
- **Italy**, IODL 2.0: *"Tu puoi esercitare i diritti concessi con la
  presente licenza in modo libero e gratuito, anche qualora la finalità da
  Te perseguita sia di tipo commerciale."*

That is roughly **45 000 stations across ES, FR and IT** on
attribution-only terms, with no share-alike and no registration.

**Germany is a rate limit, not a legal problem.** Tankerkönig's live data
is CC BY 4.0 (*"Die Daten stehen unter der Creative-Commons-Lizenz 'CC BY
4.0'"*), but the historical archive is BY-NC-SA and explicitly says
*"Für kommerzielle Nutzung muss ein kostenpflichtiger Vertrag mit uns
abgeschlossen werden."* The binding constraint is throughput: *"die
Abfragefrequenz auf einen requet/Minute beschränkt"* (sic) plus a 25 km
radius, and they state that mirroring attempts *"werden geblockt (und
API-Keys deaktiviert)"*. So: on-demand lookup for a campsite the user is
actually looking at — yes. A nightly national sweep — no, and it would
get our key disabled. Going direct to MTS-K instead requires a
*Zulassung* as a Verbraucher-Informationsdienst from the Bundeskartellamt,
which is an owner step.

**Austria is the instructive rejection.** `api.e-control.at` answers 200
with no key and no rate limit, which makes it look like the easiest source
on the list. But the only published Nutzungsbedingungen govern the
stations *supplying* the prices — they *"regeln das Verhältnis zwischen
dem Nutzer (Betreiber von CNG-Tankstellen) und Energie-Control Austria"*
— and `spritpreisrechner.at/nutzungsbedingungen.html` is a 404. **An HTTP
200 is not a licence.** Under this project's rule, no permission means no
take, however convenient the endpoint.

Portugal is the blunt one: *"gratuita, podendo ser utilizada livremente.
É proibida a sua utilização para fins comerciais."*

Slovenia and Croatia are each one email away — the data is open and the
endpoints work; only the written permission is missing. Both endpoints
were reverse-engineered from the sites' own JavaScript, which is another
reason not to ship them on assumption.

For the countries we reject, we keep the CAMP-55 country averages and
**mark them visually as averages**, so the map never implies a precision
we do not have.

### What CAMP-154 found when it went to build this

Shipped 28.09.2026. The licences above were not re-derived; the
endpoints, the payloads and the join were measured, and four things
differ from what this section anticipated.

**1. The Spanish path in the table above does not answer.** The host is
right and the path is one letter out. `PrecioCarburantes` returns
**404**; the service is at **`PreciosCarburantes`**, plural:

    https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/

With that spelling it answers **200, 12 221 919 bytes in 16.7 s** —
the 12.2 MB this section recorded. `/ServiciosRESTCarburantes/` itself
answers 403, so the application was always there. The URL is now a
constant in `apps/api/src/fuel/stations.ts` rather than something each
caller retypes. Note also that the ministry's own catalogue has moved
to `sede.serviciosmin.gob.es`; the old host 302s to a 404.

**2. What the three feeds actually yielded**, anonymous GET, no key of
any kind on any of them — verified rather than assumed, because this
repository is public and has leaked a token before:

| | feed records | stations kept | price rows | matched to an `osm_route_poi` fuel point |
| --- | --- | --- | --- | --- |
| Spain | 11 496 | **11 309** | 22 163 | **9 352 (82.7%)** |
| France | 9 804 | **8 885** | 17 133 | **6 917 (77.9%)** |
| Italy | 23 998 | **21 189** | 42 209 | **19 049 (89.9%)** |
| | **45 298** | **41 383** | **81 505** | **35 318 (85.3%)** |

Read the other way — the way the page reads — we now hold a price for
**58.2%** of Spain's 16 063 OSM fuel points, **42.9%** of France's
16 110 and **68.5%** of Italy's 27 811. Every run reconciles: kept plus
rejected equals the feed's own count, itemised by reason, and the
importer throws if it does not.

**3. The measurement date has to be per price, not per feed.** This
section treats freshness as a property of a source; it is a property of
a record. France's 8 760 diesel prices: 3 350 under a day old, 2 119 at
four to seven days, 1 193 at eight to thirty, **101 between one month
and one year**. Italy files a separate `dtComu` per grade, so one
Bologna forecourt's diesel and petrol were filed a day apart. Spain is
the exception — one `Fecha` for the whole snapshot, so every Spanish
price is exactly as old as the file. A page that stamped all of these
"fetched today" would be false on thousands of forecourts, so each
price carries its own source timestamp, is marked when over 7 days old
and is not shown at all past 30.

**4. Three traps in the payloads, each of which produces a plausible
wrong number rather than an error:**

- **Spain publishes at least one transposed coordinate.** IDEESS 16268
  in Tui, Pontevedra files `"Latitud": "-8,659472"` and
  `"Longitud (WGS84)": "42,037472"` — its own position written
  backwards, which would place it 42° east of the Horn of Africa. Three
  more Spanish and 116 Italian stations sit at (0, 0). A per-country
  bounding box rejects all of them.
- **France's petrol is two different fuels.** 6 799 stations post an
  `E10` price and 2 754 an `SP95` one, overlapping on 1 180 — so
  **5 619 stations have no SP95 at all**. Anything that folded them
  into one "petrol" figure would print E10's price under SP95's name at
  a third of the country. We store and print the source's own product
  name.
- **Italy's price file uses 59 `descCarburante` values**, 57 of them
  premium brands — `Blue Diesel` (5 685 rows), `HVOlution` (2 433),
  `Supreme Diesel` (1 592). A substring rule on `/diesel|gasolio/`
  sweeps them into the pump price. Only the exact strings `Gasolio` and
  `Benzina` are taken. Italy also files self-service and served prices
  separately (51 203 against 41 681); we prefer self-service and label
  the served one `(servito)`.

**The join is one-to-one inside 150 m**, and the radius is measured
rather than chosen: median gap 8.5 m, p90 56 m, p99 129 m, with only
250 of 35 318 matches in the last 15 m band. Widening to 300 m would
add 2 175 matches — all of them at the distance where the next station
down the road lives, which is where a wrong match is both most likely
and least visible. A unique index on `(osm_ref, grade)` makes a
regression in the matcher a failed import rather than one forecourt
showing another's price.

**What adversarial review then found, and what it changed.** Seven
defects, four inside the card's own rules, and the two that matter most
here are worth recording because both were *invisible in a passing
build*:

- **The safeguard sentence pointed the wrong way.** The rewrite said the
  country average was "not for any station listed **above**" while the
  average block renders **before** the stage list — so every station it
  disclaimed was below it — and a test asserted the inverted string,
  defending the mistake. It now names the row instead of a direction
  ("shown on that station's own row"), because a word that has to track
  the order of two JSX siblings in another file is a latent bug
  whichever way it points.
- **Attribution was computed and never rendered.** `displayPrices`
  resolved the ministry for every price and the component never read it,
  so the served row was the price and the date and nothing else. That is
  a **licence breach**, not a presentation gap: attribution is a
  condition of all three sources, and the CC BY bulletin on the same
  page was already getting it. The ministry is now named and linked on
  the row, and the refused-country gate — which also lived only in the
  renderer, leaving the public API free to serve an Austrian row — is
  now a `source IN (…)` predicate in the query itself.

Three guards were added for failures that all exited 0: a **per-grade
price floor** (renaming Italy's `Benzina` upstream halved the price rows
with every station counter unmoved), a **match-rate floor** (emptying
`osm_route_poi`, which a *different* weekly job owns, wrote 39 216 prices
and matched none), and a **second reconciliation for Italy's price
file**, which had been checked against nothing at all. Spain's import
also stopped stamping a dateless snapshot with our own fetch time — one
unparsable `Fecha` had turned 22 174 rows into "measured today".

**Austria stayed out, and there is a mechanical reason as well as a
policy one.** The page renders only prices whose `source` has an
attribution entry, and only three exist. Verified in a browser on the
Dolomites-and-Tyrol route, which crosses both countries: the Austrian
station *Diskonttank* renders "We hold no price for this station" while
the Italian *Agip* 75 m off the next stage shows `Gasolio €2.445/l`
with the day it was measured.

---

## 7. Open Charge Map — **TAKE, with a real UI obligation**

The suspicion in the card was share-alike. That suspicion is now out of
date, and the actual constraint is different and more interesting.

Licence, read 28.09.2026 at `https://openchargemap.org/about/terms`
(HTTP 200, page states "updated 01/04/2022"):

> Data contributed to us by our users which we then redistribute is
> licensed under a Creative Commons Attribution 4.0 International (CC BY
> 4.0).

OCM moved off CC BY-SA — *"we are moving from the CC-BY-SA 4.0 license to
CC-BY 4.0"* — so **there is no share-alike clause to infect our own
database**. And OCM describing itself as *"a non-commercial, non-profit
service"* is a statement about the organisation, not a restriction on
data users.

The real constraints, each quoted, and (a) is the one that matters:

> Data imported from 3rd party Data Providers is copyright the original
> Data Provider in each case and is not provided under the same terms as
> the user-contributed data detailed above.

**So the CC BY 4.0 covers only the user-contributed records.** This is the
same trap as any aggregator: the licence on the tin does not cover the
imported cargo. We must read each POI's `DataProvider` and filter, not
bulk-assume.

> Use of our API or data in an application or service requires that the
> appropriate Data Provider attribution (including license terms) be
> provided in a way which is visible the end user.

Per-record provider name **and its licence text**, rendered where the user
can see it — not in a buried credits page. That is a UI requirement, not a
footnote.

> You agree that we may substitute this license at any point (where
> applicable) for an alternative Open Data license

So we pin the licence we ingested under, per record, with a date.

An API key is required: a live call without one returned **HTTP 403**,
*"You must specify an API key using the key query parameter or x-api-key
header."* Obtaining it needs a registered account, so **no payload was
sampled** — the data shape remains unverified, and the key is an owner
step.

The credible EU alternative is worth recording: under **AFIR Article 20**
operators must publish static charging data (updated within 24 hours) and
dynamic availability (within one minute) to the National Access Points,
and **DATEX II became mandatory for NAP charging submissions on
14.04.2026**. That is first-party and legally mandated rather than
crowd-sourced — but it is 27 endpoints again, with all the problems of
section 4. EAFO's licence **could not be verified**.

---

## 8. Freshness: the constraint that shapes the build

Three findings collide here, and together they decide the architecture.

1. The licence requires operational redistribution "on average less than
   five minutes and never longer than ten minutes".
2. Both public endpoints serve expired warnings — up to 5.5 days past
   `expires` on the JSON API, 1.7 days on ATOM.
3. The page must never render empty when data is missing, because
   emptiness reads as "all clear".

So the pipeline needs three separate clocks, and they are easy to
conflate:

| clock | what it measures | what it must do |
| --- | --- | --- |
| `expires` | is this warning still in force? | drop the record — on every read, never trust the feed |
| feed age | when did MeteoAlarm last publish? | if older than our budget, say "no fresh data" |
| our lag | when did *we* last succeed? | must stay under 5 minutes to satisfy the licence |

### The public feeds rebuild every 30 minutes — so they cannot meet the licence

This was measured, and it overturns the obvious assumption. Polling the
feed-level `<updated>` element once a minute for 14 minutes looked static
at first — which is why an early draft of this document recorded it as
"nothing changed in that window". It was wrong. Held for longer, the
timestamps stepped:

```
15:06:40  croatia=2026-09-28T14:35:39.018280Z  spain=2026-09-28T14:35:07.096018Z
15:07:41  croatia=2026-09-28T15:05:39.080560Z  spain=2026-09-28T15:05:08.322563Z
```

Croatia advanced by **exactly 30 minutes** (14:35:39.018 → 15:05:39.080),
Spain by 30 minutes and 1.2 seconds. Two independent countries, stepping
together, to the second. That is not content changing — **it is a
half-hourly scheduled rebuild**, each country at its own fixed offset.
One transition was observed, so the interval is measured rather than
merely assumed, but it is a single interval and should be re-measured over
a longer window before anything depends on the exact figure.

There is propagation on top: the build stamped 15:05:39 first reached us
at 15:07:41, roughly two minutes later.

**The consequence is the important part.** Clause 5 requires that the
delay between publication on the MeteoAlarm website and ours be "on
average less than five minutes and never longer than ten minutes". If the
public feed itself only republishes every 30 minutes, a warning issued at
14:36 is not visible on it until 15:05. **No polling frequency on our side
can close that gap — the delay is upstream of us.**

So the open path is not merely inconvenient, it is **structurally
incapable of satisfying the licence's own freshness rule**. This moves the
EDR/MQTT credential request (card 6 below) from an optimisation to the
only compliant route for operational redistribution, and it is the
strongest argument in this document for making that request early.

Until those credentials exist, the honest options are to show warnings
with an explicit "as published by MeteoAlarm at HH:MM" stamp and accept
that we are a mirror on a half-hour cadence, or not to ship the live layer
at all. What we must not do is imply a freshness we do not have.

The one silver lining: because `<updated>` moves on a schedule rather than
on content, it is still a cheap change detector — poll it, compare one
timestamp, and only re-parse the payload when it steps.

**The failure mode to design against is not "the fetch errored".** It is
"the fetch succeeded and returned a stale archive", which is exactly what
these endpoints do by default. A green pipeline with 5-day-old wind
warnings on the page is the realistic bad outcome here, and it looks
healthy from every angle except the one that matters.

---

## New cards this spawns

Eleven, and the order matters: the first three are the feature, the next
three make it safe, and the rest are country-by-country widening.

### The feature

1. **MeteoAlarm ingest with hard filtering.** Poll the 27 JSON country
   feeds, drop anything whose `expires` has passed, anything with
   `responseType: AllClear`, and anything at `awareness_level 1` (green).
   Normalise the `awareness_type` casing. Acceptance test: feed a fixture
   containing Poland's 28.09.2026 payload — 69 entries, all expired — and
   the output must be zero warnings, not 69.

2. **The geography join.** Ingest the 2 006-feature geocode GeoJSON,
   resolve EMMA_ID, NUTS3, NUTS2, WARNCELLID and FIPS, and fall back to
   the inline CAP polygon for Estonia and Sweden, which have no geocode
   features at all. Must fail loudly on an unresolvable code rather than
   silently dropping the warning.

3. **The campsite warning panel**, carrying all six display obligations
   from §2: issuing service, time of issue, link to meteoalarm.org, the
   verbatim disclaimer, our "the decision is yours" line, and **"no fresh
   data"** whenever the freshness budget is exceeded.

### Making it safe

4. **A staleness alarm that is not blind.** It must fire on "the fetch
   succeeded and returned an archive", not merely on HTTP errors. The
   measurements in §1 are its fixtures: an endpoint that returns 200 with
   5-day-old records is the realistic failure, and a naive health check
   calls it green.

5. **A licence-obligations test.** One test per condition in clause 5,
   asserting the attribution, the timestamp, the link and the disclaimer
   are actually rendered — because a licence breach is invisible until it
   is expensive.

6. **Request MeteoAlarm re-user credentials** (EDR API + MQTT) from
   `meteoalarm@geosphere.at`. **Do this first, not last.** §8 shows the
   public feeds rebuild only every 30 minutes, so they cannot satisfy the
   licence's own five-minute rule at any polling frequency — the delay is
   upstream of us. The push interface is not an optimisation here, it is
   the only compliant route for operational redistribution. Owner step,
   and it gates how honestly card 3 can describe itself.

### Widening, each independently shippable

7. **EFFIS wildfire layer** from the per-fire GeoJSON WFS, with
   `maxfeatures` — never the unbounded 132 MB response — and worded as
   trip-planning context, not an evacuation signal.

8. **Fuel per station for ES, FR, IT**, with the CAMP-55 country averages
   kept for everyone else and visually marked as averages.
   **Done — CAMP-154, 28.09.2026.** 41 383 stations, 81 505 price rows,
   35 318 of them joined to an `osm_route_poi` fuel point. See the
   measurements at the end of §6, including the one-letter error in the
   Spanish path recorded above.

9. **Tankerkönig on-demand for Germany**, one request per minute, per
   campsite the user is actually viewing. Explicitly not a nightly sweep.

10. **Camera layer for Finland and Estonia only**, labelled honestly as
    two countries. Estonia needs its API key approved by a human, so apply
    before the sprint that needs it.

11. **Open Charge Map with per-record provider attribution**, filtering on
    each POI's `DataProvider` rather than assuming the CC BY 4.0 reaches
    imported records, and pinning the licence per record with a date.

### Owner emails, not engineering

Four sources are blocked only by a missing piece of paper, and each is one
message: **ASFINAG** (Austrian camera partner status), **E-Control**
(Austrian fuel licence — `office@e-control.at`), **MGRT / MZOE**
(Slovenian and Croatian fuel), and **Rijkswaterstaat / NDW** (a licence
for the Dutch SRTI feed, which is otherwise the best road-hazard source
in the EU). None of them is a technical obstacle.

---

## What we refused, in one sentence each

- **A pan-EU camera layer** — because Austria and Ireland forbid even
  linking without written consent, Slovenia and Spain forbid commercial
  reuse, and the Netherlands and Denmark publish no images at all; two of
  twelve countries are usable, so the honest product is two countries.
- **Twenty-seven NAP integrations at launch** — because a 200 at a NAP
  root is not access, only two of six sampled yielded data to an anonymous
  client, and the best of them states no licence at all.
- **Austrian fuel prices** — because the endpoint is open and the licence
  does not exist, and an HTTP 200 is not permission.
- **Portuguese and Hungarian fuel prices** — because both say, in their own
  words, that commercial use is prohibited.
- **Belgian, Greek and Polish per-station fuel** — because it is not
  published per station; there is nothing to refuse or take.
- **Any wording of the form "it is dangerous here"** — because no licence
  covers an assertion we generate ourselves, and no disclaimer repairs it.

---

## How to re-check this in six months

Every claim above is a URL, a date and a quotation, so the refutation path
is short. The four things most likely to have moved:

1. **The 308 figure** — it is a single moment on 28.09.2026 and will differ
   every hour. What should *not* change is the ratio: expect roughly half
   the feed to be expired and most of the remainder to be green. If a
   future measurement shows the feeds clean, the filtering can relax —
   until then it cannot.
2. **MeteoAlarm's terms** — dated 15/03/2024 when read. The five-minute
   rule is the clause to re-read, because the whole architecture rests on
   it — and today the public feeds cannot meet it.

2a. **The 30-minute rebuild cadence** — inferred from one observed
   transition on two countries. Re-measure it over several hours before
   building a freshness budget on the exact number. If it turns out to be
   shorter, or variable, the compliance picture in §8 changes with it.
3. **The EDR API's 401** — if it opens, or MeteoGate ships its promised
   "free access to the public", items 1 and 6 above collapse into
   something much smaller.
4. **`meteoalarm-legacy-atom-europe`** — it 404s today while the
   deprecated RSS feed points at it. If it starts working, 27 polls become
   one.

Three defects at the source are worth reporting to
`meteoalarm@geosphere.at` rather than merely working around: the broken
pan-European ATOM feed, the Redistribution Hub's false claim that "only
active warnings are included", and the shapefiles being served from
personal Google Drive links.
