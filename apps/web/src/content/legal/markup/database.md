CampTribe is not a copy of OpenStreetMap. It is a database built **from** OpenStreetMap, with fields we compute ourselves and records from other open sources joined onto it. This page describes how — which data we take, what we derive from it, what we add, and what we throw away.

> Under the Open Database License, our derived database carries the same licence as the data it comes from. This page is the description of our alterations that ODbL §4.6 entitles you to.

## The licence on this database {#licence}

OpenStreetMap is published under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Because we build a derived database from it and publish the result, **our database is under ODbL 1.0 as well**. That is a separate statement from crediting OpenStreetMap, and it applies to the collection of campsite records as a whole.

Individual records joined in from other sources keep their own licences, which are named on the [attribution page](/legal/attribution) and beside the data they appear in.

## What we take from OpenStreetMap {#taken}

Weekly extracts from Geofabrik, limited to the twenty-seven member states of the European Union. From each extract we keep objects tagged as places to stay with a vehicle or a tent, together with the tags that describe what a camper will find there — sanitation, water, power, connectivity, access — and the name, where the object has one.

We keep the OpenStreetMap object reference for every record, so any row can be traced back to the object it came from and compared with the current state of the map.

## What we compute, and how {#computed}

Each of the following is calculated by us and stored alongside the record. The coordinates each was computed at are stored with them, so a campsite that moves in a later import can be recognised as needing recomputation rather than silently keeping numbers about its old location.

**The distances are ours; several of the names are not.** Where an entry below names a nearby lake, town, shop or railway stop, that name is read from OpenStreetMap and passed on unchanged — it is their Content, under their licence, and only the measurement between it and the campsite is our derivation.

- **at** — the latitude and longitude the figures below were computed from. Kept so that stale derivations are detectable.
- **water** — the nearest lake, reservoir, river or coastline, with its distance in metres and its kind. Villages of water, so to speak, are not filtered: the nearest is the nearest.
- **town** — the nearest place tagged as a city or a town, with its distance and name. Villages are deliberately excluded: there are too many of them for the distance to mean anything.
- **supermarket** — the nearest shop that sells food, with its distance and name.
- **station** — the nearest railway stop, with its distance and name. A stop here is either a railway station (OpenStreetMap tag railway=station) or a halt (railway=halt), the smaller kind: a platform that usually has no staff and no ticket office. The record keeps the distance and the name and does not say which of the two it is, which is why the site says railway stop and not station.
- **elevation** — metres above sea level, from the Copernicus digital elevation model.
- **terrain** — the relief in metres and a word for it. Relief is the highest minus the lowest elevation across eight points on a one-kilometre circle plus the centre, so it describes the landscape the campsite sits in rather than the slope of its own ground. The words are fixed physical bands, not quantiles of our own data: under 25 m flat, 25–70 m rolling, 70–150 m hilly, above 150 m mountainous. Bands taken from our own distribution would re-label the same meadow every time a different country was imported.

### Which country and region a campsite is in

**This is ours too, and it decides the web address.** OpenStreetMap campsites do not carry a usable country or region tag — on a sample of 448 Slovenian campsites, not one had an administrative tag we could use — and the country a national extract is named after is wrong at the borders, because each extract carries a strip of its neighbours.

So we compute both from the position: the campsite’s point is tested against the [Natural Earth](https://www.naturalearthdata.com/) 1:10m administrative boundaries, and it takes the country and region of the polygon that contains it. For a campsite mapped as an area rather than a point we use a point guaranteed to lie on the area itself, not its average, which for a ring-shaped or concave site can fall outside it.

Where a point falls inside no polygon at all, it takes the **nearest** one, within a fixed limit. This is not a rarity: on the first Croatian import 367 campsites of 778 fell outside every polygon, because a 1:10m coastline smooths away the shores and small islands that Croatian campsites sit on. Every one was within 3.85 km of a Croatian polygon and the average was 593 m. Past the limit, the campsite keeps no region and gets no page at all, rather than being assigned a county by a guess.

### Names and web addresses

Where a campsite has no name in OpenStreetMap, we do not invent one: the record is shown by its object reference. Where it has a name, we show the operator’s own spelling on the page.

The web address is derived from the name: reduced to Latin letters and hyphens, and where that leaves nothing usable, built from the OpenStreetMap object reference instead. Where two campsites in one region would take the same address, the later one is given a numeric suffix. **An address is assigned once and then frozen**— if the campsite is renamed in OpenStreetMap later, the page keeps the address it was first published under, because a link that has been given out should not stop working.

## What we join in from elsewhere {#joined}

Some records are matched against other open datasets, and the match is a derivation of ours rather than a statement by either source. Where two records from **different** sources describe one campsite, one of them is shown and the other is hidden from listings — it is not deleted, and the data read through the link is credited to the source it came from.

**Duplicates inside OpenStreetMap itself are treated differently, and more bluntly.** The same campsite is often mapped twice there, once as a point and once as an area. At import, two records close enough to be the same place are merged into one and only the survivor is stored: within 200 metres when they carry the same name, within 50 metres when neither has one, and the mapped area wins over the single point. The record that loses is not kept. That is a real alteration to the data we took, which is why it is written here rather than left to be inferred from the counts.

The distance from a campsite to the bathing water and to the air quality station nearest to it is also ours: it is measured by us between their published positions and rounded to the metre.

Each campsite record also carries whether we consider its region large enough to publish an index page for, and whether a price list we hold is withheld from display. Both are decisions of ours about presentation, not facts any source stated.

**Those matched records are inside the derived database, not beside it.** A campsite we took from another open source and then compared against OpenStreetMap to remove a duplicate is a campsite of the same kind as the OpenStreetMap ones, and the comparison is what ties the two together. The description above, and the offer at the foot of this page, cover them as well — not only the records that came from OpenStreetMap to begin with.

The sources, their licences and what each contributes are listed on the [attribution page](/legal/attribution). Every figure drawn from them carries the date it was read.

## What we leave out {#dropped}

- Anything outside the twenty-seven member states of the European Union.
- Objects that OpenStreetMap has removed. We mark the record as missing rather than deleting it, so a campsite that disappears answers honestly instead of becoming an unexplained gap.
- Records a source publishes with no usable position, since a campsite without a location is not something we can show on a map or compute a distance from.
- Tag values that say nothing — an empty string is not an answer, and storing it as one turns “unknown” into “no”.

## Asking for a copy {#copy}

If this description is not enough for what you want to do, write to us and we will send the derived data itself. ODbL §4.6 gives you the choice between the two, and we would rather answer the question than have you guess.