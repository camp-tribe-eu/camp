# Emergencies wider than fire: floods, drought, quakes, water, air, disease

CAMP-117, the sibling of `docs/road-hazard-sources.md`. Written 28.09.2026.
Every number below comes from a request made that day, and every licence
verdict quotes the sentence it rests on, with the URL and the date it was
read. Nothing here is recalled.

Fires (EFFIS) and weather warnings (MeteoAlarm) are already decided in
`docs/road-hazard-sources.md` and are not redone here.

## Why this card exists

The owner, 24.09.2026:

> Not only fires, but floods and other emergencies too — drought, or a
> disease outbreak — that is, everything we can show across all the EU
> countries.

The card listed four services that already publish this and called the
job "check the conditions and the formats, not find something". That
framing turned out to be half right. The formats are mostly there. The
**conditions** eliminated the single most important source on the list.

## The finding that reorganised this card

Our red line — *we mirror what official services published, we do not
assess risk* — has until now been our own policy. On this card it turns
out to be **the licence text of every Copernicus emergency service we
touched**.

From the CEMS terms and conditions, which govern EFAS, GloFAS, the Global
Flood Monitoring product, EDO, GDO, EFFIS and GWIS together
(`https://drought.emergency.copernicus.eu/terms&conditions`, HTTP 200,
read 28.09.2026):

> Data from the CEMS early warning and monitoring systems is provided for
> information purposes only. This means that the data does not constitute
> in any way an early warning for which only national/regional
> institutions are authorized within their region of responsibility.

The flood-specific licence says the same thing in stronger words
(CEMS-FLOODS datasets licence PDF, 53 369 bytes, linked from the EWDS
catalogue, read 28.09.2026):

> Data from CEMS EFAS & GloFAS is provided for information purposes only.
> This means that the data does not constitute in any way a flood warning
> for which only national/regional institutions are authorized within
> their region of responsibility.

So "EFAS: orange flood level in this basin" is not a phrasing we may use
either. The data is an **observation or a model output**, and the word
*warning* belongs to someone else. Everything below is written against
that sentence.

**Where it is enforced (CAMP-162).** Not by a grep for the words: the
planned MeteoAlarm layer says "warnings" in `map-layers.ts`, correctly,
and no CEMS term touches it. The rule is bound to the *source* — text
rendered beside data from a CEMS product must not contain "warning",
"danger", "risk" or "alert", and must carry the modified-data credit — so
`apps/web/tests/unit/cems-panels.spec.ts` renders the panel of every
CEMS-sourced layer and reads the HTML. A new CEMS layer (EDO, GFM) is one
`tests/unit/cems-panels/<source>.panel.ts` file; the header of the spec
says how, and it fails a layer tagged `terms: 'cems'` in `map-layers.ts`
that has no such file.

## What this card does not promise

**We do not become an emergency service, and now we can point at the
licence that says so.** We mirror what official services published, with
a link to the primary source and the time it was last updated, and the
decision stays the reader's.

**Never render empty when data is missing.** "No fresh data", never a
blank. Emptiness reads as "all clear". On this card that matters more
than on CAMP-111, because several of these sources are slow by design: a
drought indicator is 27 days old when it is perfectly healthy, and a
bathing-water classification is a year old when it is perfectly healthy.
A UI that cannot tell "old because that is the cadence" from "old because
the pipeline broke" will eventually show one as the other.

**Disease is different in kind**, and it is treated separately in §11.

---

## The matrix

Every verdict is argued, with its quotation, in the section named.
"Coverage" is what we measured, not what the provider claims.

| source | what it gives | licence verdict | coverage measured | latency measured | resolution | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **CEMS GFM** (§3) | observed flood extent from Sentinel-1 SAR | CEMS terms: reproduction, distribution, communication to the public; complemented by the Commission's CC BY 4.0 notice — but the grant names EFAS & GloFAS and reaches GFM by definition, not by name | 3 495 items over the EU box in 10 days; 180 today | **1 h 50 min** acquisition → product, measured on today's newest item | 20 m pixel | **TAKE**, with one email outstanding |
| **EDO / GDO** (§4) | drought: CDI, soil-moisture and precipitation anomalies | same CEMS terms; WMS declares `no fees`, `no constraints` | 26 of 27 countries carried a classified CDI pixel; Malta none | newest CDI dekad **2026-09-01** — 27 days | ~4.6 km grid, no point query | **TAKE**, drought is slow enough to survive it |
| **EEA air quality** (§9) | European Air Quality Index, per station and per point | CC BY 4.0, commercial use explicit in the EEA legal notice | 4 018 EU-27 stations on the roster, **3 213 reporting in one sampled hour**, 27/27 countries | station file **≈53 min** old when read | station, plus a 1 km modelled raster | **TAKE** |
| **EEA bathing water** (§8) | official quality class for every EU bathing site | CC BY 4.0 on the versioned record, commercial use explicit | **22 010 sites, 27/27 countries, 100% with coordinates** | **annual**; 2025 season published 02.06.2026 | point | **TAKE**, labelled as a season's classification, never as today's water |
| **EMSC** (§5) | earthquakes, Europe-wide, near real time | **CC BY 4.0, stated on each service we would use**; the carve-out covers the site and the database as infrastructure, not the data they distribute | 3 825 events in 30 days in the bbox, of which **63.3% Turkey** | one live push observed at **189 s** (n=1) | epicentre point | **TAKE**, with one design rule |
| **ECDC** (§11) | communicable-disease surveillance | CC BY 4.0, commercial use explicit — the licence is not the problem | 28 country names, **no ISO or NUTS code** | newest week in the data **2026-W37**, 15 days | country only | **NOT TAKEN** — and the lawyer question only exists if we ever do |
| **EFAS** (§1) | European flood forecasts and notifications | CEMS-FLOODS licence is fine; **access is not** | — | open route stops at **2026-08-24**, 35 days | 1 arcmin | **REFUSE** |
| **GloFAS** (§2) | global river-discharge forecasts | same licence, and it is open | current to **2026-09-28** | daily | ~0.05° | **REFUSE at launch** — it is discharge, not a warning, and the gap between the two is ours to fill illegally |
| **ERCC** (§6) | EU civil-protection daily products | not reached | — | — | — | **REFUSE** — one undocumented endpoint, PDF payload |
| **GDACS** (§7) | global multi-hazard alerts | its own disclaimer forbids decision-making use | 268 items, **5 in the EU box, 2 current** | feed rebuilt 17:35 GMT | country/event | **REFUSE** |
| **USGS** (§5) | earthquakes, global | US Public Domain — the cleanest licence here | **25 events** where EMSC had 3 825 | — | epicentre point | **nothing to take** for Europe |
| **River gauges** (§10) | live water level per station | FR and DE explicitly permit commercial reuse; SI, CZ unverified | 4 of 27 countries verified: FR 6 499, DE 786, CZ 545, SI 194 stations | FR obs 6 h 57 min old; SI 19:00 same day | station | **REFUSE as a pan-EU layer**, second phase per country |

### Not checked, and therefore neither taken nor refused

- National public-warning systems under Art. 110 EECC (DE NINA, NL-Alert,
  FR-Alert, IT-Alert, ES-Alert and the rest) — **not probed at all**.
  These are cell-broadcast to handsets by design; a public API is the
  exception, not the rule, and we should not assume either way.
- River gauges in **23 of the 27** member states. Verified: DE, FR, CZ,
  SI. Austria was attempted and no machine-readable endpoint was found,
  which is not the same as proving none exists.
- National in-season bathing-water / short-term-pollution alert systems,
  other than one probe at `beaches.ie`.
- ECDC data at sub-country resolution — searched for, not found, which is
  not proof it does not exist.
- The EMSC websocket's filtering options; none are documented and none
  were found, but absence was not confirmed.
- GDACS wildfire coverage of the EU **in fire season**. Our snapshot is
  from 28.09, when the European season is closing and the southern
  hemisphere's is opening. See §7.

None of these may be quoted later as a refusal.

---

## 1. EFAS — **REFUSE**

This is the source the card was built around, and it is the one we cannot
have. Not because of the licence, and not because of the format — because
of who is allowed to hold it.

### The real-time product is closed, and we are not eligible to open it

Measured 28.09.2026, anonymously:

```
GET https://european-flood.emergency.copernicus.eu/api/inline/notifications/
→ HTTP 403  {"detail":"Authentication credentials were not provided."}
```

That endpoint is the flood **notifications** — the actual warning product,
the thing that would say "this basin, this level, this day". The site
around it is a JavaScript shell (4 034 bytes for every path), so there is
nothing to read without an account.

The rule is stated plainly. From
`https://european-flood.emergency.copernicus.eu/api/news/efas-conditions-of-access/`
(HTTP 200, read 28.09.2026; the page's own `published_date` is
2026-02-25):

> EFAS real-time forecast and products (including notifications): only
> available to EFAS partners and EFAS third party partners

> EFAS forecasts and products more than 30 days old: freely available to
> all

And the definition of a partner, from
`.../api/news/become-efas-partner/` (HTTP 200, read 28.09.2026):

> Any national, regional or local authority with a legal obligation to
> provide flood forecasting services or that has a national role in flood
> risk management within its country and the European Commission
> Services, i.e. DG ECHO-ERCC, DG DEFIS and JRC.

A third-party partner is "any authority that contribute to flood risk
management within a country", nominated by the relevant EFAS partner. The
research category exists and is explicitly useless to us:

> EFAS Research Project Partners have only limited, restricted access to
> EFAS forecasts and products, and cannot redistribute any EFAS
> information to individuals or institutions outside the signed
> agreement.

**A camping platform is not an authority with a legal obligation to
forecast floods.** This is not a door we can knock on; there is no
category we fit. Unlike ASFINAG in CAMP-111, where the refusal was "send
an email and maybe", here the refusal is structural.

### The open route exists and is 35 days old

The archive really is open to all through the Copernicus Early Warning
Data Store, and the catalogue API answers anonymously
(`https://ewds.climate.copernicus.eu/api/catalogue/v1/collections?limit=50`,
HTTP 200, 41 949 bytes, 12 collections).

Measured on `efas-forecast`, 28.09.2026:

| field | value |
| --- | --- |
| `cads:update_frequency` | **Weekly** |
| temporal extent end | **2026-08-24** |
| latest date in the retrieval constraints file | **2026-08-24** |
| blocks advertising September 2026 | **0** |
| `license` | `other` → CEMS-FLOODS datasets licence |

**Thirty-five days behind.** And the constraints file and the
documentation agree on why, which is the useful part — this is the rule
working, not a failure. From the dataset page
(`https://ewds.climate.copernicus.eu/datasets/efas-forecast`, HTTP 200,
126 802 bytes, read 28.09.2026):

> The hydrological forecasts are available from 2018-10-10 up until
> present with a 30-day delay. The real-time data is only available to
> EFAS partners.

A flood forecast delivered five weeks late is not a degraded product. It
is a different product, with no use to anybody deciding where to camp
this weekend.

### The provider also tells us not to use it this way

Three messages are live on the `efas-forecast` collection
(`.../collections/efas-forecast/messages`, HTTP 200, read 28.09.2026).
One of them, dated 2024-02-01 and still `"live": true`:

> Please note that accessing this dataset via CDS for time-critical
> operation is not advised or supported

Another, dated 2025-10-01, is a reminder of how wrong model output can
quietly be:

> Due to an error in the initial conditions, EFAS forecast data over
> Poland from 1 July to 30 September 2025 should not be used.

**Verdict: REFUSE.** The near-real-time product is legally closed to us,
the open product is 35 days stale by design, and the provider says in
writing that the open route is not for time-critical use. Nothing here is
fixable by engineering.

---

## 2. GloFAS — **REFUSE at launch**, and the reason is worth keeping

GloFAS is EFAS's global sibling, and the contrast is exact. Measured on
`cems-glofas-forecast` at the same moment, 28.09.2026:

| field | `efas-forecast` | `cems-glofas-forecast` |
| --- | --- | --- |
| update frequency | Weekly | **Daily** |
| temporal extent end | 2026-08-24 | **2026-09-28** (today) |
| latest date in constraints | 2026-08-24 | **2026-09-28** |
| licence | CEMS-FLOODS | CEMS-FLOODS (the identical PDF) |

So there *is* an open, current, EU-covering river-discharge forecast under
a licence that permits redistribution. Retrieval needs a free account —
`POST /api/retrieve/v1/processes/cems-glofas-forecast/execute` returned
**HTTP 401 `authentication required`** anonymously — which is an
inconvenience, not a barrier.

We still do not take it, and the reason is the whole point of this
document. GloFAS gives **river discharge in cubic metres per second on a
model grid**. It does not give a class, a colour or a statement. To put
it in front of a camper we would have to compare it to a return period
and then say what that means — and that step, from a number to "this
riverbank is a bad place to be tonight", is precisely the assessment the
CEMS licence reserves to national authorities and that our red line
forbids.

**Verdict: REFUSE at launch.** Not because the data is closed or stale —
it is neither — but because the only way to make it useful to a reader is
to do the thing we have promised not to do. If we ever want it, the
honest route is a national hydrological service that publishes an actual
classified warning, which is §10 and a per-country problem.

---

## 3. CEMS Global Flood Monitoring — **TAKE**

The find of this card, and it was not in the brief. GFM is the newest
CEMS component: it processes every incoming Sentinel-1 SAR scene and
publishes **where water is right now**. An observation, not a forecast —
which makes it both more useful to a camper and far safer for us, because
mirroring an observation requires no interpretation.

### It is genuinely open, and it is fast

Everything below was measured anonymously on 28.09.2026, with no key and
no account, through the EODC public STAC catalogue:

```
GET https://stac.eodc.eu/api/v1/collections              → 200, 287 756 B, 69 collections
     ... one of which is  GFM | Global Flood Monitoring
GET .../search?collections=GFM&bbox=-10,35,31,60
        &datetime=2026-09-18/2026-09-28                  → 200, numberMatched = 3 495
GET .../search?collections=GFM&bbox=-10,35,31,60
        &datetime=2026-09-28                             → 200, numberMatched = 180
```

The newest item at the time of the query:

```
id         ENSEMBLE_FLOOD_20260928T153725_VV_EU020M_E063N021T3
datetime   2026-09-28T15:37:25Z      (Sentinel-1 acquisition)
created    2026-09-28T17:28:09.577Z  (product available)
gsd        20.0 m
proj:shape 15000 × 15000             Equi7 tile EU020M
```

**One hour, fifty minutes and forty-four seconds from satellite to
published product.** That is the number this card was looking for, and it
belongs to the source nobody named.

The assets are Cloud-Optimized GeoTIFFs on plain HTTPS, and they serve
byte ranges to an anonymous client:

```
GET https://data.eodc.eu/collections/GFM_LAYERS/advisory_flags/...  (Range: bytes=0-2047)
→ HTTP 206, 2 048 bytes, image/tiff; application=geotiff
```

Thirteen assets per item. The ones that matter: `ensemble_flood_extent`
(the consensus flood mask), `ensemble_water_extent` (all observed water),
`reference_water_mask` (normal water, so the difference is the flood),
`exclusion_mask` and `advisory_flags` (where the method is unreliable),
plus three per-algorithm extents and their uncertainties. Being able to
subtract the reference water from the observed water, on the server, by
range request, is what makes this cheap enough to use.

### The licence, and one chain to be precise about

The governing text is the EFAS/GloFAS terms and conditions
(`https://european-flood.emergency.copernicus.eu/api/news/terms-and-conditions/`,
HTTP 200, read 28.09.2026; the document states "Last modified:
07/06/2023"). It defines its own scope first:

> The early warning and monitoring systems of the Copernicus EMS are
> composed of the European and Global Flood Awareness Systems (CEMS EFAS
> and GloFAS) **including the Global Flood Monitoring product**, the
> European and Global Drought Observatories (CEMS EDO and GDO) ...

and then grants:

> Subject to their compliance with the terms and conditions set forth
> herein, users are granted free access to the data of CEMS EFAS & GloFAS
> for the following purposes and within the limits allowed under
> applicable law: (a) reproduction; (b) distribution; (c) communication to
> the public; (d) adaptation, modification and combination with other data
> and information; (e) any combination of points (a) to (d).

**Be precise about what that is.** The grant names "CEMS EFAS & GloFAS",
and the same document defines that pair as including GFM — so GFM is
covered by reading the two sentences together, not by being named in the
grant itself. That is a reading, not a quotation, and it is the reason the
email in card 8 below is worth sending rather than skipping.

What the grant does *not* contain is any purpose limitation or
non-commercial clause. The same page states the terms are "complemented by
the terms of the Commission Legal Notice", which is where the explicit
CC BY grant lives (`https://commission.europa.eu/legal-notice_en`, HTTP
200, 152 103 bytes, read 28.09.2026):

> Unless otherwise indicated (e.g. in individual copyright notices),
> content owned by the EU on this website is licensed under the Creative
> Commons Attribution 4.0 International (CC BY 4.0) licence. This means
> that reuse is allowed, provided appropriate credit is given and changes
> are indicated.

The required attribution is fixed text, and it must be rendered:

> 'Generated using Copernicus Emergency Management Service information
> [Year]'

and, where we have processed it at all:

> 'Contains modified Copernicus Emergency Management Service information
> [Year]'

**The discrepancy:** the STAC collection record at EODC carries
`"license": "proprietary"` (read 28.09.2026). EODC hosts the data; the
Commission owns it and licenses it as above. The two statements point in
opposite directions.

So there are two open threads here, and one email closes both: *does the
CEMS EFAS & GloFAS grant cover the Global Flood Monitoring product, and
why does the STAC record say `proprietary`?* Until that reply exists this
is a **take with a known open question**, recorded here so that nobody
later mistakes the STAC field for the licence — and so that nobody
mistakes our reading of two adjacent sentences for a quotation.

### What the UI may say

"Copernicus observed surface water here at 15:37 UTC today" — yes, with
the acquisition time, the attribution notice, a link to the source, and
the exclusion mask honoured so we do not draw water where the method says
it cannot see. "This campsite is flooded" — no. Radar water is not a
statement about a campsite, and the licence says it is not a warning.

---

## 4. EDO / GDO drought — **TAKE**, with its documentation distrusted

The European Drought Observatory is now served from
`drought.emergency.copernicus.eu` (the old `edo.jrc.ec.europa.eu` URLs
redirect there, HTTP 200, checked 28.09.2026). It is open, it is free,
and it says so in its own capabilities document:

```
GET https://drought.emergency.copernicus.eu/api/wms
        ?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1
→ HTTP 200, 47 165 bytes, 26 named layers
   <Fees>no fees</Fees>
   <AccessConstraints>no constraints</AccessConstraints>
```

Licence: the CEMS terms quoted in §3, which name EDO and GDO directly.

### Drought is the one hazard whose cadence forgives us

The Combined Drought Indicator is published per **dekad** — ten-day
periods. Measured 28.09.2026 by asking the server for an impossible date
and reading the range it returns in the error:

| layer | what it is | `available_range` ends |
| --- | --- | --- |
| `cdiad` | **Combined Drought Indicator v4.1** | **2026-09-01** |
| `cdirc` | No-drought and recovery CDI v4 | 2026-09-01 |
| `smian` / `smang` | Soil Moisture Index anomaly | 2026-09-11 |
| `fpanv` | fAPAR anomaly (VIIRS) | 2026-09-11 |
| `spaST` | SPI ERA5 short term | 2026-09-11 |
| `rdria` | Risk of Drought Impact for Agriculture | 2026-09-11 |
| `snwvi` | Snow mask | 2026-09-11 |
| `spaLT`, `spcLT`, `spgTS` | long-term precipitation indices | 2026-08-01 |
| `twsan` | GRACE total water storage anomaly | 2026-07-01 |
| `smand` | Ensemble soil-moisture anomaly | **2024-07-01** |
| `cdinx` | CDI v4.1, all classes | **2024-01-01** |

The newest CDI describes 1–10 September. Read today, the freshest
statement about drought in Europe is **27 days old by issue date and 18
days old at the end of the period it covers** — and that is the service
working correctly. A drought does not turn over in a week. This is the
one hazard on the card where a monthly rhythm is honest, and the UI
should say the dekad out loud rather than implying currency.

**But two layers are years stale and still advertised.** `smand` stops in
July 2024 and `cdinx` in January 2024, and both are listed in the
capabilities document and on the service's own documentation page as
though they were current. Anything that walks the layer list and takes
what it finds will put 2024 data on a 2026 page.

### The documentation is wrong in four separate ways

This is the CAMP-111 pattern again, and it cost an afternoon to find.

1. **The capabilities document's time extents are false.** It advertises
   `cdiad` as `2012-01-01/2026-06-11/P10D`. The server actually serves
   2026-09-01 and rejects 2026-09-11 with
   `{"code":"DATE_OUT_OF_RANGE", ... "available_range": "2012-01-01 - 2026-09-01"}`.
   The error message is more truthful than the capabilities document.
   **Read the range from a deliberate out-of-range request, not from
   GetCapabilities.**

2. **GetFeatureInfo does not exist.** The capabilities document marks
   seven layers `queryable="1"`. Every GetFeatureInfo we sent — on
   `cdiad`, on `spaST`, on `rdria` — returned **HTTP 400
   `Invalid request type`**. There is no point query on this service. To
   answer "what is the drought class at this campsite" we must fetch the
   raster and sample it ourselves.

3. **The Low-Flow Index is advertised and not served.** Three layers
   (`lfinx_300_sms`, `_mds`, `_lgs`) appear in the capabilities document
   and on the WMS documentation page. A GetMap returns a 120-byte fully
   transparent PNG for every date tried, and a future date returns
   `{"code":"PRODUCT_NOT_FOUND"}`. That matters more than the others,
   because the Low-Flow Index is the one drought layer about **rivers**,
   which is the one a camper by the water would care about.

4. **The WCS answers only at the documented incantation.** `SERVICE=WCS&
   VERSION=2.0.1` returns an error; `VERSION=2.0.0` without `map=DO_WCS`
   returns **HTTP 502 `MAPSERVER_UPSTREAM_ERROR`**. With the exact
   parameters from the docs page it works. And it covers **7 of the 26
   WMS layers** — the Soil Moisture Index anomaly, one of the two
   headline EDO products, is not among them (`HTTP 500`).

### It is real data, not just pictures

The WCS does deliver, which is what makes the verdict a take:

```
GET .../api/wcs?map=DO_WCS&SERVICE=WCS&VERSION=2.0.0&REQUEST=GetCoverage
        &coverageID=cdiad&CRS=EPSG:4326&format=GEOTIFF&TIME=2026-09-01
→ HTTP 200, 2 190 894 bytes, GeoTIFF
```

Read back with GDAL: 1 824 × 1 200 pixels, origin (−25, 72), pixel
0.041667° — **about 4.6 km north–south**, single byte band. The grid spans
longitude −25 to 51 and latitude 22 to 72, so every EU-27 country's
European territory falls inside it; the French overseas departments do
not.

### Coverage, measured rather than assumed

Sampling a 12 × 12 grid of points inside each country's interior on the
2026-09-01 CDI raster, **26 of 27 countries carried at least one
classified pixel**. Malta carried none — at 4.6 km, Malta is about three
pixels, and none of them was classified in this dekad.

The shares vary enormously, and the reason matters:

```
100%  BE HU LU SK      96-97%  AT HR SI      81-87%  CZ DE IE NL RO
 94%  FR              37-50%  DK ES IT PL   13-19%  FI GR PT SE
0.7%  EE LT            3.5%  LV             0%  MT
```

**Caveat, and it is a real one: value 0 in this raster conflates "no
drought class here" with "outside the computed domain", and we did not
separate them.** An attempt to separate them using the SPI coverage was
abandoned because that product sits on a different grid and the
comparison would have been wrong. So the low numbers for the Baltics may
mean "no drought there in early September 2026", which is plausible, or
may mean a gap. **Not checked** — and it needs to be settled before any
UI implies an absence of drought rather than an absence of data.

### Settled 04.10.2026 (CAMP-163), and the answer was not what this said

Two things, and the first changes what value 0 MEANS.

**Value 0 is a measurement, not a gap.** The EDO factsheet for CDI
v4.1.1 (`/data/factsheets/factsheet_combinedDroughtIndicator_v4.pdf`),
Table 1, gives all seven levels, and the first of them is:

| value | level | interpretation |
| --- | --- | --- |
| 0 | No drought | "Normal conditions (No drought)" |
| 1 | Watch | precipitation deficit |
| 2 | *Warning* | soil moisture deficit |
| 3 | *Alert* | vegetation growth below normal |
| 4 | Recovery | conditions returned to normal after an episode |
| 5 | Temporary Soil Moisture recovery | above threshold, episode not closed |
| 6 | Temporary vegetation recovery | above threshold, episode not closed |

So "the low numbers for the Baltics" above are not low coverage; they
are mostly a reading of **no drought**, which is the good news this
layer exists to be able to give. The factsheet also supplies the reason
the conflation is real: the algorithm classifies "each pixel **in the
study domain**", and outside it the raster still carries 0 as fill.

🔴 Levels 2 and 3 are literally "Warning" and "Alert". Both are in
`RESERVED_WORDS`, so the official names may never reach a page; our
labels are built from the interpretation column instead.

**The domain was measured.** `ne_10m_ocean_mask` is advertised in
GetCapabilities and would have been the provider's own land/water
boundary; GetMap on it returns HTTP 400 `PRODUCT_NOT_FOUND`. So: a pixel
the algorithm has ever classified as anything but 0, in any dekad, is
inside the domain. Built from 59 dekads spanning 2012–2026, four seasons
a year, it covers 531 948 pixels of the EU-27 crop — and the last five
dekads added **0, 0, 0, 0, 0**, which is what makes it a measurement
rather than a hope. `scripts/edo/fetch-drought.mjs` refuses to write a
mask whose tail is still growing, because an unsaturated one calls
ordinary dry land "not covered" and hides a true "no drought".

**Malta is inside the domain.** The 0% in the table above is one
dekad's classification, not coverage: Malta carried a class in three of
the seven dekads first sampled. A UI that printed "no data" for Malta
would be making a false statement about a real place.

### Two more ways the documentation is wrong (5 and 6)

5. **`cdirc` and `cdiad` are the same raster.** They are published as
   separate products — "No Drought and Recovery CDI v.4" and "Combined
   Drought Indicator (CDI) v4.1" — with separate legend URLs. Fetched
   for 2026-09-11 and compared pixel by pixel: **0 differing pixels of
   2 188 800**, and a byte-identical legend PNG. There is no second
   layer to fetch.
6. **`ne_10m_ocean_mask` is advertised and not served.** In
   GetCapabilities, HTTP 400 `PRODUCT_NOT_FOUND` on GetMap. Same shape
   as the Low-Flow Index in (3).

### And the available range had already moved

This section records the newest dekad as **2026-09-01** (28.09.2026).
Probed again on 04.10.2026: `available_range` is **2012-01-01 -
2026-09-11**. Six days, one dekad. The number in a document is a
reading, not a fact — which is why the script asks on every run and
nothing here is hard-coded.

**Verdict: TAKE**, on the WCS GeoTIFF sampled by us, with the available
range read from an out-of-range probe every run, the two stale layers
excluded by name, and the dekad shown to the reader.

---

## 5. Earthquakes: **EMSC needs a lawyer, USGS has nothing to give Europe**

For Italy, Greece, Croatia and Romania this is not abstract, as the card
said. Two services could supply it, and they are not interchangeable — the
difference is a factor of a hundred and a half.

### USGS does not see European earthquakes

Same bounding box, same 30-day window, 29.08–28.09.2026:

| | EMSC | USGS |
| --- | --- | --- |
| events returned | **3 825** | **25** |
| Greece box, M≥2 | **399** | **10** |
| Italy box, M≥2 | **156** | **1** |
| smallest magnitude present, Greece | — | **4.2** |
| smallest magnitude present, Italy | — | **4.4** |

Every USGS event carried `net=us`: no European regional network feeds
into their catalogue, so over Europe USGS is effectively an M≈4.2+
service. A camper wants to know about the M3.5 that rattled the valley,
and USGS does not have it.

USGS has by far the cleanest licence on this entire card
(`https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits`,
read 28.09.2026):

> USGS-authored or produced data and information are considered to be in
> the U.S. Public Domain.

and asks only that "proper credit be given". It is a pleasure to read and
we cannot use it. **Nothing to take for Europe.**

*(Operational note for whoever tries this: that page returns HTTP 403 to
a default curl user-agent and 200 to a browser one.)*

### EMSC has the data, and a carve-out around it

EMSC's FDSN endpoint answers anonymously and fast — 3 825 events in
2.06 MB in 2.52 s — and its push interface works without credentials:
`wss://www.seismicportal.eu/standing_order/websocket` returned
**HTTP/1.1 101 Switching Protocols** with no key and no cookie.

Listening for 420 seconds on 28.09.2026 produced **5 messages**. One was
in the EU box: M3.5 Iceland region, origin 17:38:37.2Z, pushed
17:41:46.55Z — **189.4 seconds end to end**. That is a single observation
and must be labelled as one; a real latency figure needs a multi-day log.
The other four were India, the Philippines, Argentina and a same-day
*revision* of a Californian event from the previous day.

That last one is the trap, and it is worth stating so the next reader does
not fall in: across the 3 825 events, `lastupdate − time` has a median of
2 070.7 s. **That is a revision statistic, not a publication latency.**
`lastupdate` moves every time a seismologist refines a solution, in one
case 21 days after the event. Quoting 2 070 s as "EMSC latency" would be
wrong by an order of magnitude in the safe direction, which is the worst
kind of wrong.

The stream is **global with no server-side geographic filter** — 5 of 5
messages, 1 in the EU — so filtering is ours to do, client-side, on every
message.

### The licence splits the data from the database

From `https://www.seismicportal.eu/terms.html` (HTTP 200, 8 124 bytes,
read 28.09.2026), the grant:

> Datasets and products downloaded from our data services are provided
> under the Creative Commons Attribution 4.0 International (CC BY 4.0)
> license.

and, immediately after it, the carve-out:

> The website, data services, and databases themselves (as distinct from
> the datasets they provide) remain subject to standard copyright
> protection and are not covered by the CC BY 4.0 license above.
> Commercial reproduction or transmission, in whole or in part, in any
> form or by any means, requires prior written permission from
> EMSC-CSEM.

> Reasonable use of excerpts for personal, academic, educational, or
> research purposes is permitted without prior authorization, provided
> such use does not involve reproducing the website, data services, or
> databases in whole or in substantial part.

Read plainly: an individual earthquake record is CC BY 4.0 and we may show
it commercially. A continuously ingested, stored mirror of the feed starts
to look like reproducing the database, which is carved out — and "in
substantial part" is a term with EU case law behind it, not a phrase we
should interpret ourselves on a Friday afternoon.

Attribution, if we proceed: `Credit: EMSC-CSEM SeismicPortal,
https://www.seismicportal.eu`.

### 🔴 Re-read 04.10.2026: the per-service documentation settles it

The verdict above used to be **NEEDS A LAWYER**. It was reached from the
general terms page alone — and that page itself says where to look next:

> Refer to **the documentation for each web service** for further details.

We had not followed that sentence. Doing so, on the two interfaces we
would actually use:

**FDSN Event web service** (`seismicportal.eu/fdsn-wsevent.html`, read
04.10.2026):

> The data provided by this service is distributed under the Creative
> Commons Attribution 4.0 International (CC BY 4.0) license.

**Websocket / standing order** (`seismicportal.eu/realtime.html`, same
day):

> Data received via the websocket protocol is distributed under the
> CC BY 4.0 license.

Flat statements, no carve-out, no volume threshold, on the exact channels
we would consume. And the general terms defer to them by their own words.

Re-read with that, the carve-out reads as what it says it is: the
**website, the data services and the databases *themselves*** — the
infrastructure — are not CC BY 4.0, so nobody may clone SeismicPortal.
The data those services distribute is CC BY 4.0, and that is the thing we
take.

**Verdict: TAKE**, with one design rule and one honest residual.

🔴 **The design rule.** We consume events and show them; we do not rebuild
their catalogue as a product of our own. Concretely: a rolling window of
recent events, filtered to the EU, kept only while current, with
attribution on every view. Not a mirror, not an archive, not a
general-purpose earthquake API of our own.

⚠️ **The residual, named rather than hidden.** The carve-out sentence
still exists, and "in substantial part" has EU case law behind it. If we
ever drift from the rule above — long retention, bulk re-export, our own
query API over their events — the question comes back, and then it is a
lawyer's. The rule is what keeps it away, so it belongs in the card that
builds the layer, not only here.

Attribution we will print, their own wording: `Credit: EMSC-CSEM
SeismicPortal, https://www.seismicportal.eu`.

---

## 6. ERCC civil protection — **REFUSE**

The card asked whether the Emergency Response Coordination Centre
publishes machine-readable alerts. Measured 28.09.2026: effectively no.

The portal (`https://erccportal.jrc.ec.europa.eu/`, HTTP 200, 38 044
bytes) and its ECHO Daily Map and ECHO Flash pages are JavaScript-rendered
and contain **zero** feed, RSS, XML or JSON links in their HTML, and two
PDF links, both of which are the accessibility and privacy statements.

One undocumented endpoint was found — discovered inside a CSS
`background-image` URL, not from any documentation:

```
GET https://erccportal.jrc.ec.europa.eu/API/ERCC/Maps/GetLatestDailyMap
→ HTTP 200, application/json, 4 676 bytes
   Title            "ECHO Daily Map of 28 September 2026"
   PublishedOnDate  2026-09-28T18:53:39
   MainFileExtension "pdf"   ECDM_20260928_Mexico_POLO.pdf, 666.3 KB
```

So the **metadata** is machine-readable and the **substance is a PDF**.
And today's map is about Mexico: the ECHO Daily Maps are a global
product, not a European hazard feed.

Every attempt to list, search or page the products returned 404 —
including `Maps/Get?mapID=…`, which the JSON payload itself advertises in
its own `Api` field. A service that contradicts itself in the same
response is not a dependency.

**Verdict: REFUSE.** There is no supported, documented, listable ERCC
feed; one undocumented single-item endpoint can vanish without notice, and
its payload is a PDF about another continent.

---

## 7. GDACS — **REFUSE**, and its own disclaimer is the reason

GDACS looked like the obvious answer: one global multi-hazard feed, JRC
and UN, covering floods, fires, quakes, cyclones, drought and volcanoes.
The feed is real and large — `https://www.gdacs.org/xml/rss.xml`, HTTP
200, 823 387 bytes, **268 items**, channel rebuilt at 17:35:02 GMT on
28.09.2026.

The refusal is one sentence of theirs. From
`https://www.gdacs.org/About/overview.aspx` (read 28.09.2026):

> While we try everything to ensure accuracy, this information is purely
> indicative and should not be used for any decision making without
> alternate sources of information.

Showing a camper an alert for the place they are about to sleep **is**
decision-making. We would be using it for exactly the purpose its provider
tells us not to. That is not a risk to manage with a disclaimer of our
own; it is the source saying no.

Two measurements make the refusal easy anyway.

**GDACS promises CAP and does not deliver it.** All 268 items carry a
`<gdacs:cap>` URL. Three were fetched — a flood, an earthquake and a
volcano. Each returned HTTP 200 with `Content-Type: text/html`, an
identical 17 755 bytes, titled "GDACS Admin section". **CAP advertised on
100% of items, delivered on 0% of those sampled.** Same failure mode as
MeteoAlarm's Redistribution Hub in CAMP-111: the documentation describes a
service that is not there.

**And the EU content is thin.** Of 268 items, **5** fell inside the EU
bounding box, **3** named an EU-27 state, and **2** of those were current:
an Etna eruption (green) and a green flood alert in Italy. Alert levels
across the whole feed: 260 green, 8 orange, 0 red.

One caveat we must keep honest: 220 of the 268 items are wildfires and
**none** of them is in the EU — but this snapshot is from 28 September,
when the European fire season is closing and the southern hemisphere's is
opening (Australia 55, Brazil 54, Mozambique 33). That is a seasonal
observation, not evidence that GDACS never carries EU fires, and it should
be re-measured in July before anyone cites it.

**Verdict: REFUSE**, on the disclaimer alone.

---

## 8. EEA bathing water — **TAKE**, with the honest label

The card was right that this is directly usable: we already hold
distance-to-water for every campsite, and this is the official quality
classification for every bathing site in the Union. It is also the
best-measured source on this card, because two independent routes agreed
exactly.

### What we measured

Via the ArcGIS layer
`https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM_2025/MapServer`
(HTTP 200, no key) and independently via the bulk download
(`eea_t_bathing-water-status_p_1990-2025_v01_r00.zip`, **43 402 140
bytes**), both read 28.09.2026:

| | count |
| --- | --- |
| all sites, 2025 season | 22 289 (29 countries) |
| **EU-27 sites** | **22 010**, across **27 of 27 countries** |
| with usable coordinates | **22 010 — 100%** |
| classified | 21 399 |
| not classified | 611 |

Classification of the EU-27 sites for the 2025 season: **Excellent
18 655, Good 1 931, Sufficient 489, Poor 324.**

That is the rarest thing on this card: a source that genuinely covers all
27, with a coordinate on every record.

### It is annual, and the UI must never pretend otherwise

The latest season in the data downloaded today is **2025**. The 2025
release was published 02.06.2026; the 2024 release 19.06.2025 — a measured
June-to-June rhythm, not a policy we were told about. The EEA never
declares the cadence in machine-readable form: the catalogue's
`maintenanceAndUpdateFrequency` is null and the ISO XML shipped inside the
ZIP has no maintenance element at all.

The dataset's own README says what the classification is for:

> The BWD classification scheme aims to provide a meaningful picture of
> bathing water quality over the long term.

and how thinly it is sampled:

> At least four water samples per bathing water need to be collected and
> analysed — one taken before the bathing season and the other (at least)
> three during it

**Four samples a season is a reputation, not a reading.** So the label in
our UI is "official classification for the 2025 season", with the season
stated, and never anything that could be read as the state of the water
today. The 2026 season closing now will not be published until roughly
June 2027.

We looked for a live in-season signal and found none at the EEA: a
catalogue search returned 62 bathing-related records, every one an annual
status or an SDG indicator. National short-term-pollution systems exist in
some countries and are **not checked** beyond one probe.

### Licence

From the versioned catalogue record and from the ISO XML inside the ZIP
(read 28.09.2026):

> License CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
> Copyright holder: Directorate-General for Environment (DG ENV),
> European Environment Agency (EEA).

and the site-wide notice (`https://www.eea.europa.eu/en/legal-notice`,
page states "Modified 02 Jul 2026"):

> Information, documents and material available on this website and for
> which the EEA holds the rights of use are public and may be re-used
> without prior permission, free of charge, for commercial or
> non-commercial purposes, provided that the EEA is always acknowledged
> as the original source of the material and that the original meaning or
> message of the content is not distorted.

"The original meaning or message of the content is not distorted" is a
licence condition, not a nicety — and calling a 2025 seasonal
classification "water quality" without the year would distort it.

Two traps recorded so nobody falls in later:

- The **un-suffixed** service `BathingWater_Dyna_WM`, which looks like the
  current one, still describes itself as showing "the latest (2022)"
  season. Use the year-suffixed service and check the year.
- The **parent** Datahub record — the URL the item page exposes — returns
  null for every licence field. The licence exists only on the versioned
  record. Anyone checking the landing page alone will conclude there is no
  licence.

The map service's own `copyrightText` also notes that the coordinates come
from member-state authorities, so our attribution should name both: *EEA,
bathing waters data and coordinates: Member States authorities.*

**Verdict: TAKE.**

### Taken — CAMP-168, 28.09.2026

Implemented in `apps/api/src/bathing/` (fetch, parse, import, the read
query) and rendered by `apps/web/src/components/bathing-water.tsx`. Three
things that were learned in the doing and are not in the survey above:

- **The source does not speak ISO.** Greece arrives as `EL`, the
  Eurostat code; ISO 3166-1 leaves `EL` unassigned and our member list
  holds `gr`. A membership check without a translation refuses **1 734 of
  the 22 010** rows, silently, and the coverage report then reads 26 of
  27 countries. The alias lives in `apps/api/src/osm/eu.ts` as
  `NON_ISO_COUNTRY_CODE`, kept separate from the Åland one because Åland
  is a subdivision and Greece is a member state under another spelling.

- **The radius is 2 000 m, and it is not chosen from coverage.** The
  coverage curve has no knee — it climbs to 62% at 10 km — so choosing on
  it always argues for the largest number. It is examined on a different
  field: CAMP-33 already labels every campsite's nearest water
  sea/lake/river, from OpenStreetMap, and the EEA category either agrees
  with that label or does not. **The raw curve is confounded**, and this
  paragraph used to read it as if it were not: agreement falls from 86.3%
  (0–500 m) through 63.3% (1.5–2 km) to 47.2% (4.5–5 km), but over the
  same bands the coastal share of the campsites falls from 45.7% to 7.5%
  and the river share rises from 20.0% to 54.3%, and rivers agree far
  less often than the sea does at any distance. Re-weighted to the
  0–500 m mix the curve reads 86.3% → 73.1% by the 1.5–2 km band and is
  then flat — 71–74% to 5 km, against 35–38% if the categories were
  unrelated. So the data show where the decline **ends**, not a distance
  beyond which the water is unrelated: kind agreement cannot say where
  "near" stops, and 2 000 m is a judgement placed where the decline stops.
  The figures, the per-kind table and the reasoning are in
  `apps/api/src/bathing/nearby.ts`; `report-coverage.ts` reprints all of
  it, and fails if its band table does not reproduce its own radius sweep.

- **What it yields**: **18 605 of 61 558 campsites (30.2%)** have a
  designated bathing water within 2 km — 18 082 with a class, 523 whose
  nearest one the authorities did not classify — and all 27 member
  states are represented.

---

## 9. EEA air quality — **TAKE**

The card's reasoning was right: smoke from a fire a hundred kilometres
away is a reason not to make camp, and an index is exactly the kind of
already-published statement we are allowed to mirror.

### Measured, 28.09.2026

The European Air Quality Index viewer is backed by a public blob store
that answers anonymously, with no key and no rate-limit header:

| | measured |
| --- | --- |
| station roster | **4 643** stations, all `operational:1` |
| **EU-27 on the roster** | **4 018**, across **27 of 27 countries** |
| stations with an index value in one sampled hour (16:00Z) | **3 400** total, **3 213 in the EU-27**, 27 countries |
| per-station file age when read | `Last-Modified` 16:48:00 GMT, read 17:41:12 GMT → **≈53 minutes** |
| index per arbitrary point | **yes** — a 1 000 m modelled raster, values 1–6; an `identify` at Lake Balaton returned `2` |

The gap between 4 018 on the roster and 3 213 reporting in that hour is
the important number: **about one station in five is silent in any given
hour**, which is exactly the condition that must render as "no fresh data"
rather than as a clean map.

Cadence and caveats, quoted from the viewer's own About text
(`https://airindex.eea.europa.eu/AQI/index.html`, read 28.09.2026):

> The index is defined hourly and it consists of two independent layers:
> the stations layer and the modelled layer.

> By default, the Air Quality Index depicts the situation 3 hours ago.
> Additionally, users can select any hour within the past 48 hours and
> also view forecast values for the next 48 hours.

> ... using a combination of Up-To-Date (UTD) data reported by EEA member
> countries (data is not formally verified by countries) and a forecast
> of the air quality level following a downscaling of the forecast
> provided by the Copernicus Atmospheric Monitoring Service (CAMS).

> The air quality index is not a tool for checking compliance with air
> quality standards and cannot be used for this purpose.

Two of those are build constraints. **The data is not formally verified**,
so our wording is "as reported to the EEA", never "the air quality is".
And a per-station file we sampled carried 307 hourly slots of which **66
were flagged as modelled** — CAMS forecast, not measurement. Anything that
renders a forecast slot as an observation is misrepresenting the source,
and the flag is right there in the payload.

The raw-concentration download service is separate, unauthenticated (its
OpenAPI document declares no security schemes at all), and genuinely
continuous: a Maltese station's Parquet file carried `Last-Modified`
17:38:01 GMT when read at ≈17:46 GMT — **eight minutes old**. The only
documented limit is a 600 MB size cap. We do not need concentrations for
this feature, but it is worth knowing the door is open.

### Licence

From the catalogue record for the E1a/E2a time series, read 28.09.2026:

> License CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
> Copyright holder: European Commission.

and for the EEA-processed products, the same licence with "Copyright
holder: European Environment Agency (EEA)". Plus the site-wide EEA notice
quoted in §8, which states commercial reuse explicitly.

**Attribution must name both**, because the copyright holder differs
between the measurements and the EEA's processing of them — an
inconsistency inside the EEA's own catalogue, recorded here as a fact
about the source rather than a problem to solve.

One more stale-documentation note for the file: the official "How to use
Air Quality Downloads" PDF, dated 2026-05-05, still describes the verified
dataset as covering "2013 to 2022" while the catalogue titles the same
service "2013-now". Three reporting years out of date, in a document
revised this year.

### 🔴 Answered in writing — EEA Enquiry Service, case #309009, 01.10.2026

The survey above reached **TAKE** by inference, and CAMP-177 then stopped
the merge because the inference had a hole: the catalogue record the index
is built from (`908fbf25-…`) says access is `restricted`, the neighbouring
record says CC-BY 4.0, and the index itself has no record at all. We asked
the EEA rather than pick the reading we liked. They replied in a day.

**1. Which record governs the index — none of them.**

> The standard EEA's copyright legal notice applies to the EU Air quality
> index that you are interested in.

The `restricted` record governs the near-real-time measurements *under*
the index, not the index. The index has no catalogue record because it
does not need one: the site-wide notice carries it.

**2. Commercial re-use is granted, and the obligation is to name the
source.** From [the legal notice](https://www.eea.europa.eu/en/legal-notice),
*Copyright notice*, read 01.10.2026:

> ... may be re-used without prior permission, free of charge, for
> commercial or non-commercial purposes, provided that the EEA is always
> acknowledged as the original source of the material and that the
> original meaning or message of the content is not distorted. Such
> acknowledgment must be included in each copy of the material.

and from the reply:

> EEA reports, graphs and data can generally be re-used and reproduced for
> both non-commercial and commercial purposes provided that the EEA is
> clearly acknowledged as the source ...

🔴 **No verbatim credit string exists.** We asked for one; they did not
give one, and `copyrightText` is empty on all five image services. So the
page prints two sentences and the distinction matters: `AIR_ATTRIBUTION`
is the EEA's own sentence about who **developed** the index — true, theirs,
checkable against their page — and `AIR_SOURCE_CREDIT`
(`Source: European Environment Agency (EEA).`) is the acknowledgement the
terms actually require. The first alone never says the word *source* and
does not discharge the obligation.

**3. ©Esri is a condition with a trigger, not an exemption.**

> Should you reproduce the EU Air quality index map, please mention ©Esri
> in addition to the EEA acknowledgement.

We do not reproduce their map: we read the value for one point and draw it
in our own markup. **The day any EEA raster appears as a visible layer on
our map — including as a basemap overlay or a tile source — `©Esri` goes
next to the EEA credit, in the same span.** Whoever adds that layer owns
this sentence.

**4. CAMS needs no separate credit, while we show the EEA's product.**

> If you intend on displaying the EEA AQI as supplied by the EEA, rather
> than separately extracting and redistributing the underlying CAMS data,
> a separate CAMS credit may not be necessary.

We display the index as the EEA supplies it, including its gap-filled
values. If we ever pull CAMS directly, [their licence](https://ads.atmosphere.copernicus.eu/licences/licence-to-use-copernicus-products)
requires, verbatim:

> Generated using Copernicus Atmosphere Monitoring Service information
> [Year]

for unmodified products, `Contains modified Copernicus Atmosphere
Monitoring Service information [Year]` for modified ones, and a statement
that neither the European Commission nor ECMWF is responsible for any use
made of the information.

### 🔴 The EEA catalogue pattern: an empty parent record is not an absent licence

Twice out of two, the grant was not on the record the link points at.

| record | what it says |
| --- | --- |
| `778ef9f5` — air quality **download service** | no constraint fields at all |
| `fe809728` — the **dataset** under it | `License CC-BY 4.0 (...). Copyright holder: European Environment Agency (EEA).` |
| bathing water, **parent** Datahub record (§8) | every licence field `null` |
| bathing water, **versioned** record | CC BY 4.0 |

Anyone checking us who opens only the page we link would conclude the data
has no licence. So would we, if we stopped there — and on the first pass of
§8 we nearly did.

**How to look**, rather than trusting the Datahub page:

```
https://sdi.eea.europa.eu/catalogue/datahub/api/records/<uuid>/formatters/xsl-view?language=eng&approved=true
```

That view prints *Resource constraints → Use constraints → Other
constraints*, which is where the licence actually lives. The Datahub item
page renders none of it.

**Verdict: TAKE**, on the index (not the concentrations), with the modelled
flag honoured, the "as reported, not verified" wording, silence rendered as
silence, and **both** credits printed — the EEA's sentence and the source
acknowledgement their terms require.

### Taken — CAMP-164, 29.09.2026

Implemented in `apps/api/src/air/` (fetch, parse, import, the read query,
three reports) and rendered by `apps/web/src/components/air-quality.tsx`.
What was learned in the doing, and is not in the survey above. Every
number is from a run on 29.09.2026 with the command in brackets.

- **Where the data is.** Read out of the viewer's own scripts
  (`https://airindex.eea.europa.eu/AQI/script/data.js` and `init.js`),
  not from a catalogue. A public blob store,
  `dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/`,
  holds `content/index.json` (four weekly roster files),
  `content/raw_stations.json.<yymmddNN>` (4 643 stations, 1.8 MB),
  `map/<hour>.json` (one index per station for one hour) and
  `current/<station>.json` — about 305 hourly slots per station, from
  eleven days back to 39 hours ahead, each carrying `aqi_<pollutant>`,
  `val_<pollutant>` and **`modelled_<pollutant>`**. The 1 km index is an
  ArcGIS ImageServer,
  `air.discomap.eea.europa.eu/arcgis/rest/services/AQMobile_2025/MOSAIC_GLOBAL_AQI/ImageServer`,
  levels 1–6, with a time window of 2026-09-28T00Z to 2026-10-01T12Z. The
  folder name says `noRunningMeans`, and it means it: these indices are
  built from *hourly* concentrations; the About text's sentence about
  24-hour running means is inside an HTML comment in the viewer's markup.
  The `AQMobile_2025` year is a trap of the same kind as the bathing
  water's: `AQMobile` (no year) still exists, and `…/AQMobile_2026?f=json`
  answers HTTP 200 with an empty service list.

- **A station's newest hour is never a measurement.** In 240 of 240
  stations drawn at random the slot of the current hour was entirely
  gap-filled by the model [`report-lag.ts`, 20:07 UTC]. Reports arrive
  late: across all 4 018 stations the newest hour in which *at least one
  pollutant was reported* lay 1 h back for 1 005, 2 h for 1 676, 3 h for
  338, 4 h for 66, and further back or nowhere for the rest — 514 have no
  file at all [`import.ts`, 20:38 UTC]. So the page shows that hour, and
  never the newest one; a station whose every recent hour is a model
  estimate has **no reading**, and the column that would hold one refuses
  it (`reading_basis IN ('reported','mixed')`). This is the card's first
  display requirement, and it is a property of the data before it is a
  property of the wording: taking the newest slot would have filed a model
  output under a station's name and printed "as reported to the EEA" over
  it on every station in Europe.

- **The budget is four hours, not the 2–3 §12 guessed.** 3 085 of the
  3 504 stations that hold a reading (88.0%) are within 4 h, 3 019 within
  3 h; the tail has no gap, so four hours is the last hour that still holds
  1% of the roster and is stated as a judgement (`AIR_FRESH_FOR_HOURS` in
  `source.ts`, with the table). One station in five is silent — 922 of
  4 018 (22.9%) were not within it at the second import [20:53 UTC] — and
  each of them renders "no fresh data".

- **Three traps in the files.** `aqi: 0` is *no data*, not the best air
  there is. `modelled_SO2: 1` sits beside `aqi_SO2: 0` and `val_SO2: null`
  — 190 of 240 sampled files (79.2%) contain such a slot, 6.6% of all
  their pollutant-slots — because the flag is 1 when there is nothing to
  flag, so counting it makes almost every station look partly modelled. And the headline
  index equals its culprit's own index in 74 649 of 74 649 slots read, so
  a slot where it does not is a file we have misunderstood and is skipped.

- **`getSamples` silently ignores every point past the first 1 000.**
  1 000, 1 001, 2 000 and 3 000 random points over Europe each returned
  the same 496 samples, the largest `locationId` was 999 every time, and
  there was no error and no `exceededTransferLimit`. A dropped point looks
  exactly like a point outside the model. Batches are 499 points plus a
  sentinel (Lake Balaton) sent last; if the sentinel's sample does not
  come back the whole call throws.

- **The source does not speak ISO — except that this one does.** This
  roster spells Greece `GR` (58 stations), not `EL`; the bathing water
  layer of the same agency spells it `EL`. Nothing relies on which: every
  prefix goes through `normaliseCountry`. The roster carries no country
  field — the country is the first two characters of the code — and its
  **40 prefixes were enumerated, not assumed**: 27 EU (4 018 stations)
  and 13 outside the Union (AD AL BA CH GE IS ME MK NO RS TR UA XK, 625
  stations) [`import.ts`]. A prefix in neither list is a third outcome:
  the importer prints it, refuses those stations, writes everything else
  and exits 3 — "everything not in this list" is asked on every run, and
  today it returns 0. `air_quality_stations.country` is also a CHECK
  against the 27, so the database refuses what a parser let through.

- **The radius is 15 km, and it is a judgement.** The coverage curve has
  no knee (36.2% of campsites within 15 km, 51.0% within 20, 92.1%
  within 50). It is examined on a different field, the 1 km model, which
  does not assimilate the stations: how often the modelled level at a
  campsite equals the modelled level at its nearest station, 15 000
  campsites, six hours, three runs [`report-coverage.ts --proxy`].
  Agreement in the cases that matter (either end level 3 or worse) falls
  from 66.7–68.3% (0–5 km) to 56.8–57.2% (10–15 km) and then 5–10 points
  further in the 15–20 km band, in all three runs; from 35 km the answer
  depends on which hours were used, and nothing is claimed there. The
  model is smooth — 84–87% agreement across 50 km, 14–21 points above
  chance — so this bounds how far a station could be trusted and does not
  say a station is a good stand-in. What a bigger radius costs is on the
  page: a campsite whose station is silent says "no fresh data" although
  the model has a value for it — 3 525 of 61 557 pages (5.7%) at 15 km,
  4 928 (8.0%) at 20 km.

- **What it yields, over all 61 557 live campsites** [`report-coverage.ts`,
  `import.ts`, 20:53 UTC]: a station within 15 km on 22 273 (36.2%), of
  which 18 748 hold a reading inside the budget and 3 525 say "no fresh
  data"; the 1 km model on 38 618 (62.7%); neither on 666 (1.1%): the
  raster returns no value at their point. By country IT 115, DK 107,
  DE 79, PL 54, GR 52, FR 46, ES 36, PT 31 (the Azores among them),
  HR 28, EE 27 …; their coordinates are coastlines and islands. Why the
  raster is empty there was not investigated. All 27 member states have
  stations and campsites; no country sits at zero.

- **Licence and attribution — two things §9 could not see, and one it did
  not look for.**
  1. There is no `copyrightText` to take the attribution from. It is `''`
     on all five image services; the blob store carries no metadata; the
     viewer prints base-map credits and nothing else; and the catalogue
     has no record for the index (title searches for "air quality index",
     "European Air Quality Index" and "up-to-date air quality" return
     nothing). The page prints the one sentence the viewer says about who
     made it — it names DG ENV and the EEA, as §9 requires — and
     `verify-attribution.ts` fails if it ever leaves the viewer page.
  2. **The catalogue disagrees with itself about the inputs.** Record
     `fe809728-9cec-41c0-a9be-3a8f04600974` ("Air Quality download service
     for verified and Up To Date data, 2013-now", changed 2026-09-25):
     "License CC-BY 4.0 … Copyright holder: European Environment Agency
     (EEA)." Record `908fbf25-7769-49f5-a4c6-e54b265e44e7` ("Near real time
     measurements of the concentration of air pollutants for the current
     year", changed 2025-10-09): access constraint `restricted`, and "Use
     by external users is possible under conditions. Please contact the
     data point of contact referenced in this metadata record." The index
     is built from the up-to-date data. Nothing says which applies to the
     index; the TAKE verdict above rests on the site-wide legal notice
     ("EEA materials are published under the CC-BY license"). This wants
     one email to the EEA or a lawyer's read, not more engineering.
  3. The modelled values, and the gap-filling inside a station reading,
     are derived from CAMS — the Copernicus *Atmosphere* Monitoring
     Service, not CEMS, so neither the CEMS credit nor CAMP-162's wording
     gate applies. Whether Copernicus's own credit line binds a re-user of
     the EEA's downscaled product was not checked.

- **Not done, and what each costs.** The refresh is not scheduled: one run
  is 230.6 MB down (3 504 station files of about 66 KB, six at a time)
  and two minutes four seconds, so every two hours fits the four-hour
  budget and costs about 2.8 GB a day of the EEA's bandwidth (12 × 231 MB). A page whose data stops
  coming says "no fresh data" by itself. The lag was measured on one
  evening; rerun `report-lag.ts` across a day before trusting four hours.
  A campsite beside a silent station gets no model line under the
  "no fresh data" (5.7% of pages); showing one is a change in `airState`
  and one query in the import. The EEA's health advice for each level is
  not reproduced, on purpose.

---

## 10. River water levels — **REFUSE as a pan-EU layer**

For a campsite on a riverbank this is the most concrete threat on the
card, and there is no European answer to it.

The pan-European candidates all fail for the reasons already given: EFAS
is closed and 35 days stale (§1), GloFAS is model discharge rather than a
level at a gauge (§2), and the Global Runoff Data Centre is a historical
archive — its main host `www.grdc.bafg.de` did not even resolve on
28.09.2026, though `grdc.bafg.de` and `portal.grdc.bafg.de` answered 200.

National services do exist, they work, and they have nothing in common.
Four sampled 28.09.2026, all without a key:

| country | endpoint | stations | latency measured |
| --- | --- | --- | --- |
| **FR** | `hubeau.eaufrance.fr/api/v2/hydrometrie/referentiel/stations` | **6 499** | latest observation 10:40Z, read 17:37Z → **6 h 57 min** |
| **DE** | `pegelonline.wsv.de/webservices/rest-api/v2/stations.json` | **786** | not measured |
| **CZ** | `opendata.chmi.cz/hydrology/now/data/` | **545** JSON files | directory stamped 17:40, 15-minute steps |
| **SI** | `arso.gov.si/xml/vode/hidro_podatki_zadnji.xml` | **194** | `datum` 2026-09-28 19:00 — near real time |

Two licences are clean and quotable:

- **France**, `hubeau.eaufrance.fr/page/conditions-generales`: *"Les Jeux
  de données sont donc librement et gratuitement utilisables et
  réutilisables, y compris dans un but commercial."*
- **Germany**, `pegelonline.wsv.de/gast/nutzungsbedingungen` (page states
  "Stand: 21.05.2024"), under DL-DE→Zero-2.0: *"Die bereitgestellten Daten
  und Metadaten dürfen für die kommerzielle und nicht kommerzielle Nutzung
  ... vervielfältigt ... werden"*.

**Slovenia and Czechia are not verified** — the data came back, the licence
page was not found and read. Do not treat them as open.

The schemas share nothing at all: France gives `code_station` and 38
fields, Germany `uuid`/`number`/`shortname` and 10, Slovenia Slovene
element names with `vodostaj` and `pretok`, Czechia a nested
`objList[].tsList[].tsData[]` in centimetres. Different identifiers,
different units, different time semantics, four different languages —
**for four countries.**

**Verdict: REFUSE as a pan-EU layer.** This is not one integration, it is
twenty-seven, and CAMP-111 already concluded the same thing about National
Access Points for the same reason. It becomes a second-phase feature,
bought country by country against measured demand, and France and Germany
are the two to start with because their licences are already settled and
their station counts are large.

---

## 11. ECDC and disease — **NOT TAKEN**

> 🔴 **Re-read 04.10.2026.** The heading used to say NEEDS A LAWYER, and
> that was misleading in a specific way: it put a question on the owner's
> lawyer list for a feature **that does not exist and may never**.
>
> Measured, not recalled: `grep -rli "ecdc|communicable|disease"` across
> `apps/` and `scripts/` returns **nothing**. We show no disease data
> anywhere. Not a line.
>
> The analysis below stays, because it is correct and it is what the
> decision rests on. But its conclusion belongs where it can act: this is
> a **precondition on a feature**, not an open risk. The regulatory
> question — whether software that tells a traveller a place is unsafe
> engages the Medical Device Regulation — turns on **the wording we would
> choose**, and a lawyer cannot answer it until that wording exists.
>
> So: nothing to ask, nothing to fix, nothing on anyone's list. If we ever
> build it, the question comes back with the proposed wording attached,
> and then it is worth an hour of counsel.


The card was right to flag this as the most dangerous item, and the
research changed *why*. The expectation was that the licence would block
us. It does not. The licence is one of the most permissive on this entire
card.

From ECDC's intellectual property notices
(`https://www.ecdc.europa.eu/en/ecdc-intellectual-property-notices`, HTTP
200, read 28.09.2026; `/en/copyright` redirects here):

> Unless otherwise stated, information and documents made publicly
> available on ECDC web pages and for which ECDC owns the copyright are
> licenced in accordance with the CC BY 4.0 licence ... They may be
> reproduced, adapted and/or distributed, totally or in part,
> irrespective of the means and/or the formats used, **for commercial or
> non-commercial purposes** provided that the following three conditions
> are cumulatively met ...

and, for the surveillance data specifically, the exact attribution string:

> "Dataset provided by ECDC based on data provided by public health
> authorities, scientific institutes or health care providers in the
> relevant reporting countries and/or by WHO."

Their Open Data Policy goes further and describes our use case as an
objective:

> Enable third-party data analysis, tools and web applications for
> broader and more tailored disease prevention and control and risk
> communication

So the permission is there. The verdict is still **needs a lawyer**, and
it rests on four measured facts rather than on caution.

### 1. The data is too old and too coarse to be a warning

The one genuinely machine-readable ECDC source is their weekly respiratory
repository on GitHub, licensed EUPL-1.2. Downloaded and parsed
28.09.2026:

```
ILIARIRates.csv   2 486 072 bytes, 35 371 data rows
fields            survtype, countryname, yearweek, indicator, age, value
newest yearweek   2026-W37        (week ending 2026-09-13 — 15 days behind)
countries         28 distinct values, as free-text NAMES
```

**No ISO code, no NUTS code — a country name string, and nothing finer.**
The flagship weekly product, the Communicable Disease Threats Report, is a
**PDF** (week 39, 3 049 926 bytes, dated 25.09.2026) whose respiratory
section is itself headed "week 38". Its prose mentions "186 areas affected
by West Nile virus ... in 16 countries", so sub-country detail exists —
but no downloadable file carrying those areas was found.

A camper wants to know about *this valley*. ECDC publishes *this country,
a fortnight ago*.

### 2. The fast channel is explicitly outside the open-data promise

The Open Data Policy states its own scope limit: it does not apply to
"event-based surveillance data, such as data deriving from EpiPulse Events
or the Early Warning and Response System". **The outbreak-alerting channel
— the part that would actually be timely — is not covered by the
permission we just quoted.**

### 3. The regulatory question is real and is not ours to answer

Software that tells a traveller a place is unsafe because of disease may
engage the Medical Device Regulation. The Commission's own guidance
(MDCG 2019-11, `https://health.ec.europa.eu/system/files/2020-09/md_mdcg_2019_11_guidance_en_0.pdf`,
read 28.09.2026) quotes MDR Art. 2(1):

> "medical device" means any instrument, apparatus, appliance, **software**
> ... intended by the manufacturer to be used ... for one or more of the
> following specific medical purposes: — diagnosis, prevention,
> monitoring, prediction, prognosis, treatment or alleviation of disease

and the carve-out that probably saves us, if we stay inside it:

> "Simple search", which refers to the retrieval of records by matching
> record metadata against record search criteria or to the retrieval of
> information does not qualify as medical device software

> Software must have a medical purpose on its own to be qualified as a
> medical device software (MDSW). It should be noted that **the intended
> purpose as described by the manufacturer** of the software is relevant
> for the qualification and classification of any device.

That last sentence is the whole risk in one line: **what we say the
feature is for decides what it legally is.** "Here is ECDC's published
bulletin, with a link" and "avoid this region, there is an outbreak" are
not two wordings of the same feature; they may be two different regulatory
categories. That is a lawyer's determination, not an engineer's, and a
lawyer can only make it against a specific proposed wording.

*Caveats on our own evidence, recorded honestly:* these MDR quotations are
second-hand, from the Commission's guidance PDF, because EUR-Lex returned
HTTP 202 with zero bytes on three attempts; and the June 2025 revision of
that guidance was **not read**. We also searched for and did **not find**
any ECDC statement reserving health advice to national authorities — its
absence is not evidence either way.

### 4. Their own liability position

> The ECDC data have undergone routine validation. They are provided "as
> is" ... **Users are solely responsible for their own re-use of the
> data.**

**Verdict: NEEDS A LAWYER**, and the question to put to one is narrow and
cheap: *may we display an ECDC bulletin verbatim, attributed and linked,
as a country-level informational panel with an explicit date, without the
feature being characterised as having a medical purpose?* If the answer is
no, we lose a feature whose data is 15 days old and country-coarse anyway
— which is a small loss. If the answer is yes, we must never render it as
advice, and the ECDC logo is out regardless: *"Its use is prohibited
without the prior written permission of ECDC."*

Nothing about disease ships before that answer exists in writing.

---

## 12. Freshness: three different kinds of old

CAMP-111 established that a green pipeline serving a stale archive is the
realistic failure. This card adds a complication: **here, old is often
correct.**

| source | healthy age | stale means |
| --- | --- | --- |
| GFM flood extent | ~2 h after a Sentinel-1 pass, but passes are days apart at a given place | the *acquisition* time must be shown, not the fetch time |
| EDO CDI | **up to 30 days** — it is a dekadal product | more than ~40 days and a dekad was skipped |
| EEA air quality | ~1 h; the viewer itself defaults to 3 hours ago | more than 2–3 h, or the station drops off the hourly file |
| EEA bathing water | **up to 12 months** | no new season by July |
| EMSC | seconds to minutes | the websocket has gone quiet, which looks identical to a calm week |

Four clocks, four budgets, and one rule that does not vary: **when the
budget is exceeded, say "no fresh data" — never draw nothing.**

Two failure modes on this card are specifically invisible:

- **A quiet earthquake feed and a calm month look the same.** The alarm
  must be on the connection, not on the count of events.
- **A silent air-quality station and a clean-air station look the same.**
  One station in five was silent in the hour we sampled, so this is the
  normal case, not the edge case.

And one that is specifically dangerous: **GFM only knows what the
satellite has seen.** A place Sentinel-1 last passed three days ago has no
flood extent because there is no observation, not because there is no
flood. "Last observed by Copernicus on ..." is the only honest caption.

---

## New cards this spawns

Eight. The first three are the feature, the next two make it safe, and
the last three are the questions that have to be answered by somebody
other than an engineer.

### The feature

1. **GFM flood-extent layer.** Query the EODC STAC for `GFM` over a
   campsite's bounding box, take `ensemble_flood_extent` minus
   `reference_water_mask`, honour `exclusion_mask`, and read the COGs by
   range request rather than downloading tiles. Caption every result with
   the Sentinel-1 acquisition time and the Copernicus attribution notice.
   Acceptance test: a campsite whose newest GFM item is four days old must
   render "last observed 4 days ago", not an empty map.

2. **EDO drought panel.** Fetch the CDI GeoTIFF per dekad through the WCS
   (`map=DO_WCS`, `VERSION=2.0.0`), sample it at the campsite, and show the
   dekad. Read the available range from a deliberate out-of-range request
   on every run — **never from GetCapabilities, which is wrong by three
   months.** Exclude `smand` and `cdinx` by name; they stop in 2024.

3. **EEA air-quality index at a campsite**, from the station roster plus
   the 1 km modelled raster for points with no nearby station. Render the
   `modelled_*` flag differently from a measurement, use the wording "as
   reported to the EEA, not formally verified", and show "no fresh data"
   for a station missing from the current hour. **Done in CAMP-164 —
   see "Taken — CAMP-164" under §9.**

### Making it safe

4. **Per-source freshness budgets, with the dekadal and annual cases
   built in.** One budget per source from the table in §12, and a test
   that a source at its healthy age renders normally while a source past
   its budget renders "no fresh data". The bug this prevents is a 2025
   bathing-water class or a 27-day-old CDI being flagged as broken — and
   its mirror image, a genuinely dead feed passing as normal.

5. **A wording gate.** One test per source asserting that the rendered
   text contains the attribution the licence demands and does **not**
   contain the words "warning", "danger" or "risk" against any CEMS
   product. The CEMS licence says its data "does not constitute in any way
   an early warning"; that sentence should be enforceable in CI, not
   remembered.

### Owner and counsel, not engineering

6. **The ECDC question to a lawyer** (§11), phrased as narrowly as it is
   written there. Nothing about disease ships before the answer is in
   writing.

7. **The EMSC question** (§5): written permission from EMSC-CSEM for the
   ingest we actually want, or a lawyer's read on whether a rolling
   EU-filtered window is "reasonable use of excerpts". One email may
   settle it.

8. **Two corrections to ask the sources for**, both cheap and both making
   our own build safer: ask the CEMS flood team to confirm in writing that
   the EFAS & GloFAS grant covers the Global Flood Monitoring product and
   to correct EODC's STAC record, which says `"license": "proprietary"`
   (§3) — that one reply closes the only open question under a **take**
   verdict on this card, so it goes first; and EDO's
   GetCapabilities advertises time extents three months out of date, a
   Low-Flow Index that returns nothing, and `queryable="1"` on layers with
   no GetFeatureInfo (§4).

---

## What we refused, in one sentence each

- **EFAS** — because its real-time notifications are reserved to
  authorities with a legal flood-forecasting mandate, which we can never
  be, and the route that is open to everyone stops 35 days ago by design.
- **GloFAS** — because it is open and current but gives cubic metres per
  second, and the only way to make that mean something to a camper is to
  perform the risk assessment its own licence reserves to national
  institutions.
- **ERCC** — because its daily product is a PDF behind a single
  undocumented endpoint that 404s on every attempt to list it, and today's
  edition is about Mexico.
- **GDACS** — because its own overview page says the information "should
  not be used for any decision making", every CAP link we sampled returns
  an HTML admin page instead of CAP, and only two of its 268 items were
  current inside the EU.
- **USGS earthquakes for Europe** — because it returned 25 events where
  EMSC returned 3 825, with nothing below M4.2 in Greece.
- **A pan-EU river-level layer** — because four countries produced four
  incompatible schemas in four languages, two of the four licences are
  unverified, and twenty-three were not checked at all.
- **Any wording of the form "flood warning", "drought alert" or "it is
  dangerous here"** — because the CEMS licence states in its own words
  that its data "does not constitute in any way an early warning", and no
  disclaimer of ours repairs a phrase the licence forbids.

---

## How to re-check this in six months

Every claim above is a URL, a date and a quotation. The seven things most
likely to have moved:

1. **The EFAS 30-day embargo.** If the notifications API ever opens to
   non-authorities, §1 collapses and this card is worth rewriting. Re-probe
   `/api/inline/notifications/` and re-read
   `/api/news/efas-conditions-of-access/`.
2. **GFM's licence position.** Two things to look at: whether the EODC
   STAC record still says `proprietary`, and whether the EFAS/GloFAS terms
   (last modified 07/06/2023 when we read them) have been reissued naming
   the Global Flood Monitoring product in the grant clause rather than
   only in the scope sentence. Either change closes the open question in
   §3; neither happening means the email in card 8 still has not been
   answered.
3. **The EDO available ranges.** Expect the CDI to be one to three dekads
   behind — that is healthy. What would be news is the Low-Flow Index
   starting to serve data, or `smand` and `cdinx` still stopping in 2024.
4. **The 3 213-of-4 018 air-quality figure.** It is one hour on one day,
   and it will differ every hour. What should not change is the shape:
   expect roughly one station in five to be silent. If a future
   measurement shows near-total reporting, the "no fresh data" logic can
   relax — until then it cannot.
5. **The 2026 bathing-water season**, due around June 2027 on the observed
   June-to-June rhythm. If July 2027 arrives with no 2026 release, the
   cadence assumption is wrong.
6. **The EMSC 189-second figure.** It is a **single** observation and must
   never be quoted as a property of the service. Replace it with a
   multi-day websocket log before anything depends on it. The median of
   `lastupdate − time` is a revision statistic and is not latency.
7. **The MDR guidance.** We read MDCG 2019-11 (2019); revision 1 from June
   2025 exists and was **not read**. Anyone reopening §11 should start
   there, and should get the MDR text from EUR-Lex directly, which refused
   us on 28.09.2026 with HTTP 202 and an empty body.
