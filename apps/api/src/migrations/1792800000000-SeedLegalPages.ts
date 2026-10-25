import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-365 — сім правових документів переїжджають із коду в базу.
 *
 * 🔴 ТЕКСТ ВБУДОВАНО, А НЕ ПРОЧИТАНО З ФАЙЛУ — І ПРИЧИНА НЕ ТА, ЩО Я
 * НАПИСАВ СПЕРШУ. Я стверджував, що міграції йдуть із `dist/`. Рецензія
 * #315 перевірила всі чотири шляхи запуску (`ci.yml`, `build-site`,
 * `backup-verify`, `camptribe-deploy`) — скрізь
 * `typeorm-ts-node-commonjs -d src/data-source.ts`, тобто з `src`.
 * Твердження було хибне.
 *
 * Справжня причина лишається: `apps/web` на хості API немає взагалі,
 * тож читати .md у рантаймі ніде. І правовий текст мусить бути
 * замороженим разом із кодом, який його поставив.
 *
 * 🔴 ДЖЕРЕЛО ТЕКСТУ — `src/content/legal/markup/*.md`, чия дослівна
 * рівність компонентам JSX доведена в #309 посимвольно (видимий текст)
 * і за скелетом елементів із якорями. Тобто сюди приїхало рівно те, що
 * читач бачив на сторінці, а не переказ.
 *
 * 🔴 ПІДСТАНОВКИ ЛИШАЮТЬСЯ ПІДСТАНОВКАМИ: `{{company.name}}` і решта
 * розкриваються при рендері (CAMP-188), інакше зміна адреси компанії
 * стала б обходом семи документів.
 *
 * Версії й дати набуття чинності взяті з `LEGAL_PAGES` — того самого
 * реєстру, яким сьогодні живе маршрут.
 *
 * 🔴 ПРИПИСКА ВІД CAMP-365, ТІЛЬКИ КОМЕНТАР: коли сторінка перемкнулась на
 * базу, файли `src/content/legal/markup/*.md` ВИДАЛЕНО разом із сімома
 * компонентами JSX — з `apps/web/src` текст правових документів прибрано.
 * Цей файл тепер ЄДИНИЙ відбиток засіяного тексту в репозиторії: з нього
 * читають юніт-тести (`apps/web/tests/unit/legal-cms.ts`), сторож
 * `scripts/ci/check-derived-fields.mjs` і `legal-seed.spec.ts`. Текст і
 * код міграції цією приміткою не змінено.
 */
export class SeedLegalPages1792800000000 implements MigrationInterface {
  name = 'SeedLegalPages1792800000000';

  private readonly pages = [
    {
      slug: 'terms',
      title: 'Terms of use',
      summary:
        'What CampTribe is, what it is not, what you can rely on, and who may open an account.',
      version: '1.1',
      effectiveFrom: '2026-10-16',
      body: `## 1. What CampTribe is {#what}

CampTribe is an information service. We collect publicly available data about campsites, present it on a map and on pages you can read, and link out to other people’s websites. That is the whole of what we do.

> **What we are not.** We are not a booking service, a travel agent or a tour operator. We do not sell, reserve or arrange accommodation, transport or any other travel service, we do not combine travel services into a package or a linked travel arrangement, and we take no payment from you. When you book anything, your contract is with that provider and not with us.

We say this plainly because it decides who is responsible for what. A trip you plan using this site is your trip, arranged by you with the businesses you choose.

## 2. Where the information comes from, and what it is worth {#data}

Almost everything you see here is derived from [OpenStreetMap](https://www.openstreetmap.org/), a map anyone in the world may edit, together with the other open sources listed on our [data and attribution](/legal/attribution) page. We re-import it about once a week.

We have not visited these campsites. Nobody here has checked that a site exists, is open, has the facilities recorded against it, or will let you in. The information is as good as what volunteers have written down, and no better.

### “Unknown” means unknown

Where our data does not say whether a campsite has something, we show that it is unknown rather than guessing. An absent shower icon is not a statement that there is no shower. Our filters say how many campsites they are leaving out for want of data, for the same reason.

> **Check before you travel.** Opening dates, prices, facilities and access change, and our copy of them can be months out of date. Contact the campsite. Whether camping is permitted at a given place is a question of local law and of the landowner’s permission, and it differs between and within countries — including where wild camping is concerned. Finding a place on this map is not permission to camp there.

## 3. Links and affiliate links {#links}

We link to websites we do not run. We do not control them, we do not check them, and their content is their own.

Some of those links are **affiliate links**: if you book or buy after following one, the provider may pay us a commission. That costs you nothing and does not change the price you pay. It does not change what we show you either — commission does not buy a place in our listings, a ranking or a recommendation. Wherever such a link appears, it is marked as one before you click it.

## 4. Using the site {#use}

### Accounts are for adults

You must be eighteen to open an account. Reading the site needs neither an account nor an age — we ask this only of people who register, because an account is a contract and because what we help you plan is a journey by road.

We ask you to confirm your age. We do not ask for your date of birth, because we would then be holding it, and the least data that answers the question is the right amount. If we learn that an account belongs to someone under eighteen, we will close it.

### What you may and may not do

You may read, search, link to and share anything here. You may not:

- take the underlying data in bulk and republish it in a way that breaks the [Open Database License](/legal/attribution) it comes to us under — those conditions bind you exactly as they bind us;
- use automated means in a way that degrades the service for other people;
- use the site to do something unlawful, or to misrepresent a campsite, a business or a person.

If you send us content — a correction, a photograph, a review — you keep it, and you give us permission to publish it here. You confirm that it is yours to give and that publishing it breaks nobody else’s rights. We may decline or remove anything, and you can ask us to remove your own content at any time by writing to [{{company.email}}](mailto:{{company.email}}).

If you believe something here infringes your rights or is unlawful, write to the same address and tell us what and where. We will look at it and act where we should.

## 5. Responsibility {#liability}

We take reasonable care over this site, and we are telling you honestly what its information is and is not. Within that:

- we do not promise that the site is uninterrupted, error-free, or that any particular campsite, facility or route is as described;
- we are not responsible for what other businesses do — the campsites, the rental companies and the sites we link to;
- to the extent the law allows, we are not liable for loss that was not a foreseeable result of our breach, and our total liability to you is limited to one hundred euro.

> **What we do not take away, and could not.** Nothing here limits or excludes our liability for death or personal injury caused by our negligence, for fraud, or for anything else that the law does not allow us to exclude. If you are a consumer, you keep every right that your own country’s consumer law gives you, and nothing in these terms is to be read as reducing them. A term that turns out to be unfair or unenforceable is simply removed; the rest continues to apply.

## 6. Changes {#changes}

We may change these terms. The version and the date it took effect are printed at the top of this page, and the previous wording is recorded in our public source repository, so it is always possible to establish which version applied on a given day. Continuing to use the site after a change means the new version applies to that use; it does not reach backwards.

## 7. Law and disputes {#law}

These terms are governed by Belgian law, and the courts of Belgium have jurisdiction.

If you are a consumer resident in the European Union, that does not deprive you of the protection of the mandatory rules of your own country, and you may also bring proceedings in the courts where you live. If something has gone wrong, please write to [{{company.email}}](mailto:{{company.email}}) first — it is faster than anything else and we would rather fix it.`,
    },
    {
      slug: 'privacy',
      title: 'Privacy',
      summary:
        'What we hold about you, who else touches it, and the two things you can do yourself without asking us.',
      version: '2.0',
      effectiveFrom: '2026-10-16',
      body: `## Who is responsible {#who}

{{company.address}} is the controller for personal data processed through this site. You can reach a person at [{{company.email}}](mailto:{{company.email}}).

> **The short version.** You can use almost all of this site without an account, and we would rather you did. If you make one, we hold your email address, a one-way hash of your password, and whatever you save — trips, places, photos. No advertising, no tracking pixels, no third-party analytics, and nothing sold or shared. You can download everything we hold, or delete the account, from your account pages, without asking us.

## What we process, and why {#what}

### Serving the pages

A page request passes through two hands. Cloudflare receives it first, as our content delivery network and reverse proxy, and it necessarily sees your IP address, the page asked for and your browser’s user-agent string. It then forwards the request to our own server, which is where the site is actually hosted and which sees the same information in order to answer.

- **Who does it:** Cloudflare, Inc. as CDN and proxy, and Hetzner Online GmbH (Germany) as the provider of the machine that serves the site. Both act as our processors under Article 28 GDPR.
- **Legal basis:** our legitimate interests in operating the service and defending it from abuse — Article 6(1)(f) GDPR.
- **Kept for:** fourteen days on our own server, in the security log described next. Cloudflare keeps its own operational logs inside its platform under its retention policy; we do not export them, build profiles from them, or use them for anything but keeping the site up.

### The security log

Our web server writes one line for every request it answers. We turned this on deliberately, and it is the one place on our machine where your IP address is written down. Sites get attacked; a log is the difference between knowing what happened and guessing.

Each line holds:

- the time, to the second;
- your IP address as our content delivery network passes it to us, and the two-letter country code it derives from that address;
- the address of the page you asked for, the method, and the status we answered with;
- your browser’s user-agent string, the TLS version and cipher it negotiated, how many bytes we sent, and how long we took.

The rest of each line is about the connection rather than about you: which name the request arrived under, what your browser said it could accept, and the identifiers our content delivery network uses to trace a request through its own machines.

It does **not** hold the contents of your cookies or of any authorisation header. The server writes the word REDACTED in their place before the line reaches the file, so a copy of this log is not a way to sign in as you.

One thing it does hold is worth saying plainly, because it is easy to miss. Several tools on this site keep their state in the page address, so that a link can be reloaded or sent to someone: what you type into the site search, the filters you set on the map, and the answers you give the packing list and the trip cost calculator. While you are using them nothing is sent to us — they run in your browser. That address reaches us, and this log, when the page is **loaded** with it: because you reloaded, or because you or somebody else opened a saved link. Then whatever is in the address is written down with the rest of the line, and it goes when that line goes.

- **Who does it:** us, on our own server. The file can be read only by the account the web server runs as and by whoever administers the machine — not by the application that serves you — and it is appended to, never rewritten. Nothing copies it to anyone else.
- **Legal basis:** our legitimate interest in keeping this service secure — Article 6(1)(f) GDPR. Recital 49 names network and information security as exactly that kind of interest, and Article 32 requires us to take measures of this sort. We do not ask for your consent here, and saying so plainly is part of being honest about it: a security log that stops recording for whoever declines would not be a security log.
- **Kept for:** fourteen days. The server deletes older lines by itself, on a schedule, rather than waiting for someone to remember.
- **Not used for:** analytics, audience measurement, advertising, profiling, or any decision about you. It is read when something looks wrong, and otherwise it is not read at all.

You can object to this under Article 21 GDPR by writing to us. We will weigh your objection against the security interest and tell you what we decided and why.

### Your account, if you make one

An account exists so that what you save stays yours across devices. We hold the following, and nothing else:

- your email address, and whether you have confirmed it;
- a **hash** of your password — a one-way transformation, not the password. We cannot read it, recover it or tell you what it was;
- whether and when you agreed to receive our emails, recorded separately so that consent can be proven and withdrawn;
- sessions — the fact that a browser is signed in, and until when;
- what you saved: trips and their stops, saved places, photos you submitted, reviews you wrote.

- **Legal basis:** performance of the contract you entered into by creating the account — Article 6(1)(b) GDPR. For the newsletter flag specifically, your consent — Article 6(1)(a).

### Email we send you

Confirming your address and resetting your password require us to send you an email, so your address passes to the mail system that carries it.

- **Who does it:** Hetzner Online GmbH (Germany), which operates our mailboxes and carries outgoing mail.
- **Legal basis:** performance of the contract — Article 6(1)(b) GDPR — for account mail; consent for anything we send you because you asked to hear from us.

### Your cookie choice

If you answer the cookie banner, we store that answer — and only that answer — on your own device, so we do not have to ask again. It never reaches our servers and it identifies nothing. The details are on the [cookies](/legal/cookies) page.

### Writing to us

If you send us an email, we have your email address and whatever you put in the message, for as long as it takes to deal with it and for a reasonable period afterwards.

- **Legal basis:** our legitimate interest in answering people who write to us — Article 6(1)(f) GDPR.

### What we do not do

- No advertising and no advertising networks.
- No automated decision-making that produces legal or similarly significant effects, and no profiling of you as a person — Article 22 GDPR does not arise. What you save is shown back to you; it is not used to score or categorise you.
- No selling, renting or sharing of personal data.
- No social-media buttons that report your visit back to a social network.

## Who else sees it {#who-else}

Three processors, each acting only on our instructions under a contract that says so — Article 28 GDPR:

- **Hetzner Online GmbH**, Germany — the server that hosts the site and the database, and the mail system. Inside the EU, so no transfer question arises.
- **Cloudflare, Inc.** — content delivery network and reverse proxy in front of that server. Where this involves a transfer outside the European Economic Area, it is covered by the European Commission’s Standard Contractual Clauses.

That is the complete list. Nobody else receives personal data from this site, except where we are legally required to disclose it — and if that list ever grows, this page grows with it in the same release.

## The map {#map}

The map draws its background tiles from an external provider, which means your browser connects to that provider directly and it can see your IP address and which tiles you asked for, in the same way any image on the web works. We do not send it anything about you, and it sets no cookies through us. Which provider is in use is shown under the map, and you can switch it.

## How long we keep it {#keep}

- **Account data:** until you delete the account. We do not expire accounts for inactivity.
- **Sessions:** thirty days, then they expire on their own. Signing out ends one immediately; changing your password ends all of them.
- **Links we email you** — confirmation and password reset: one hour, and single-use.

## Your rights {#rights}

Under the GDPR you may ask us to give you a copy of your personal data, correct it, delete it, restrict or object to our use of it, or hand it to someone else in a portable form. Where we rely on your consent you can withdraw it at any time, and withdrawing is as easy as giving it.

For two of those you do not have to ask us at all. If you have an account, you can **download a file containing everything we hold about you** and you can **delete the account**, both from your account pages. Deleting ends your access in the same request — not in thirty days.

> **What deletion does not reach, and why.** One record survives: that a photo or a review was rejected, why, when, and for which place. It carries nothing that points back to you — no name, no address, not even a reference to the account that was deleted. Because no part of it identifies a person, it has stopped being personal data, and the right to erasure has nothing left to reach. We keep it to be able to account for our own moderation decisions. Separately, the licence you granted for photographs already published is a contract rather than personal data, so those photographs may remain — but your name comes off them on request. We would rather tell you where the line is than let you discover it.

For anything else, write to [{{company.email}}](mailto:{{company.email}}). We answer within one month, and if a request is complex enough to need longer we will tell you inside that month and say why — which is what Article 12(3) allows and requires.

> **If we get it wrong.** You can complain to a data protection authority. Ours is the Belgian [Gegevensbeschermingsautoriteit / Autorité de protection des données](https://www.gegevensbeschermingsautoriteit.be/), and you may also complain to the authority where you live or work.

## Children {#children}

Reading this site needs no account and no age. Opening one requires you to be eighteen, and we ask you to confirm that rather than asking for your date of birth — a date we would then be holding and would have to protect, to answer a question that a yes already answers.

This site is not aimed at children, and we do not knowingly open accounts for them or collect anything from them. If you believe a child has given us personal data, write to us and we will remove it.

## Changes {#changes}

The version of this policy and the date it took effect are at the top of the page. Earlier versions are in our public source repository, so what applied on any given day can be established exactly.`,
    },
    {
      slug: 'cookies',
      title: 'Cookies',
      summary:
        'Nothing is stored on your device until you say yes, and saying no is one click.',
      version: '1.0',
      effectiveFrom: '2026-09-23',
      body: `> **Nothing is stored on your device until you choose.** The banner has two buttons, side by side, the same size. Choosing “Reject” is one click and costs you nothing: the whole site works exactly the same either way.

## What we store {#what}

**Your choice itself.** When you answer the banner we keep a single entry in your browser’s local storage recording what you chose, when, and which version of this policy was in force. It stays on your device, is never sent to us, and identifies nobody.

It is stored whether you accept or reject — otherwise we would have to ask you the same question on every page, and a site that keeps asking until it gets a yes is not asking. Because it is strictly necessary to honour your decision, it does not itself need consent.

**That is currently the only thing.** This site sets no analytics cookies, no advertising cookies and no third-party cookies today. If that changes, this page changes with it, in the same release, and the banner will ask before anything is set.

## What we do not do {#not}

- No advertising or cross-site tracking, and no data sold or shared with advertisers.
- No cookie walls: you are never asked to accept in order to read something.
- No pre-ticked boxes and no “by continuing to browse you agree”. Silence is not consent, and we do not pretend it is.

## Changing your mind {#change}

You can change your answer at any time from the **Cookie settings** link in the footer of every page, and withdrawing is exactly as easy as giving. Clearing your browser’s data for this site also erases the record, and the banner will simply ask again.

## The map {#tiles}

The map fetches its background imagery from an external tile provider. That is a direct connection from your browser to them, the same as loading any image, and it sets no cookies through us. It is not something we can consent to on your behalf, which is why the map names its provider underneath itself and lets you switch.

## Questions {#contact}

Write to [{{company.email}}](mailto:{{company.email}}). What we do with personal data more broadly is on the [privacy](/legal/privacy) page.`,
    },
    {
      slug: 'disclaimer',
      title: 'What we do and do not know',
      summary:
        'Nobody from CampTribe has visited these campsites. What that means before you drive somewhere.',
      version: '1.0',
      effectiveFrom: '2026-09-23',
      body: `> **Nobody from CampTribe has visited these campsites.** Everything here is derived from open data that volunteers maintain. Check with the campsite before you rely on any of it.

## Where the information comes from {#where}

Campsite locations, names and facilities come from [OpenStreetMap](https://www.openstreetmap.org/), which anyone in the world may edit. We re-import it about once a week. The surroundings we show — distance to water, to a town, to a supermarket, the elevation and the terrain — are **calculated by us** from that data and from a 90-metre elevation model, not observed.

The full list of sources and their licences is on the [data and attribution](/legal/attribution) page.

## What that means in practice {#what}

- A campsite shown here may have closed, changed hands, changed its prices or its season, or stopped taking the kind of vehicle you have.
- A facility we show may not exist any more, and one we do not show may exist — an absent shower is not a statement that there is no shower, only that nobody recorded one.
- Distances and elevations are computed from models. At 90 metres a height reading describes the neighbourhood, not the pitch.
- A location can be wrong. Access roads, gates, height limits and surfaces are not something we know at all.

### Whether you may camp there is not our answer to give

Camping rules differ between countries, between regions inside a country, and between one field and the next. Wild camping is restricted or forbidden in much of Europe, protected areas have their own rules, and private land needs the owner’s permission.

> **Finding a place on this map is not permission to camp there.** That permission comes from the landowner and from the law where you are, and it is your responsibility to establish both.

## Routes and planning {#routes}

Where we show a route or a distance, it is informational. We do not know the height, weight or length of your vehicle, and we do not check whether a road can carry it. Bridges, tunnels, weight limits, seasonal closures and surface conditions are for you and your navigation to establish before you set off.

## Your safety is yours {#safety}

Weather, water levels, fire risk, wildlife and road conditions change faster than any dataset. Use official and local sources for those, and treat anything here as a starting point rather than an assurance.

## Help us be less wrong {#better}

If something here is wrong, the most useful thing you can do is correct it [at OpenStreetMap](https://www.openstreetmap.org/) — the fix then reaches this site and every other one built on the same data. You are also welcome to write to [{{company.email}}](mailto:{{company.email}}), including if you own a campsite listed here.

What this does and does not make us responsible for is set out in the [terms of use](/legal/terms#liability).`,
    },
    {
      slug: 'attribution',
      title: 'Data and attribution',
      summary:
        'Where every map, boundary and elevation on this site comes from, and the licences we are bound by.',
      version: '1.0',
      effectiveFrom: '2026-09-23',
      body: `Everything on this site is built from open data. This page says exactly what, from whom, and under which licence — both because we are required to and because you should be able to check us.

## Campsites, and the map {#osm}

Campsite locations, names and facilities come from [OpenStreetMap](https://www.openstreetmap.org/), © OpenStreetMap contributors, available under the [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/). The country extracts we import are prepared by [Geofabrik](https://download.geofabrik.de/).

> **If you take this data, the licence goes with it.** You may copy, adapt and use it, including commercially. What you owe in return depends on what you make:
>
> If you publish an adapted **database**, ODbL’s share-alike applies and you must offer that database under ODbL too. If you publish something produced *from* the data — a map image, a printed guide — that work does not itself become ODbL, but it must carry a notice saying it came from an ODbL database. Either way, OpenStreetMap contributors are credited, and you may not use technical measures to stop others exercising the same rights.
>
> Those conditions bind us exactly as they bind you, and neither of us can set them aside in terms of use. [How this database is made](/legal/database) is the description of our own alterations that §4.6 entitles you to, and it says how to ask for the data itself instead. The [licence text](https://opendatacommons.org/licenses/odbl/1-0/) is the authority; this paragraph is a summary and nothing more.

### What we added

Distance to the nearest water, town, supermarket and railway stop, the terrain description and the relief figure are computed by CampTribe from the sources on this page. They are our derivation, they carry the licences of what they were derived from, and they are estimates — see the [terms of use](/legal/terms).

## French campsites: names, descriptions and stars {#datatourisme}

Campsites in France also come from [DATAtourisme](https://www.datatourisme.fr/), France’s national tourism data platform, whose records are written by regional tourist offices and aggregated by ADN Tourisme. It is published under the [Licence Ouverte 2.0 (Etalab)](https://www.etalab.gouv.fr/licence-ouverte-open-licence/), which permits commercial reuse worldwide and asks for attribution in return.

It gives us three things OpenStreetMap does not carry at all: the campsite’s own description, its **official star classification** — the French state rating, not ours — and, for most sites, the operator’s website.

> **The licence asks for the date, not only the name.** It says a reuse must not mislead anyone about the information, its source or its date of last update. The records we hold were last touched anywhere between January 2022 and this week, so a single notice at the foot of the site would do exactly that. Every campsite page therefore carries its own “where this comes from” block naming the source, the licence, which fields came from it and the day that source last changed them — and says so plainly when nothing has changed in over two years.

We do not translate those descriptions. They are quoted as published, in French, marked as French so that a screen reader pronounces them properly. A machine translation of somebody else’s words, printed as though it were theirs, would be the kind of invention this site exists not to do.

## Background map tiles {#tiles}

Map imagery is served by [OpenFreeMap](https://openfreemap.org/), using the [OpenMapTiles](https://openmaptiles.org/) schema, from OpenStreetMap data — © OpenStreetMap contributors, ODbL. The map is drawn in your browser by [MapLibre GL JS](https://maplibre.org/) (BSD-3-Clause).

## Regions and boundaries {#boundaries}

Which region a campsite belongs to is resolved against [Natural Earth](https://www.naturalearthdata.com/) administrative boundaries, which are in the public domain. Natural Earth generalises coastlines, so a campsite on a spit or an island may sit just outside its own region’s drawn outline; we assign it to the nearest boundary within five kilometres rather than leaving it without a region.

## Elevation and terrain {#elevation}

Height above sea level and the relief figure come from the [Copernicus DEM](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model) at 90 m resolution, reached through [Open-Meteo](https://open-meteo.com/)’s elevation endpoint. Produced using modified Copernicus data.

At 90 m a single reading is a description of the neighbourhood, not of the pitch. Treat metres as approximate.

## Typefaces {#type}

Text is set in **Archivo** and **Archivo Narrow** by Omnibus-Type, released under the [SIL Open Font License](https://openfontlicense.org/), and served from our own domain rather than from a font network — so reading this page tells nobody else that you did.

The labels drawn on the map itself are set in Noto Sans, which comes from the tile provider along with the imagery, not from us.

## Something wrong on the map? {#wrong}

If a campsite is missing, closed or described incorrectly, the most useful thing you can do is fix it [at OpenStreetMap](https://www.openstreetmap.org/) — the correction then reaches this site and every other one built on the same data, usually within a week.

You are also welcome to write to [{{company.email}}](mailto:{{company.email}}), including if you are the owner of a campsite listed here.`,
    },
    {
      slug: 'database',
      title: 'How this database is made',
      summary:
        'What we take from OpenStreetMap, what we compute ourselves, what we join in, and what we leave out.',
      version: '1.0',
      effectiveFrom: '2026-10-04',
      body: `CampTribe is not a copy of OpenStreetMap. It is a database built **from** OpenStreetMap, with fields we compute ourselves and records from other open sources joined onto it. This page describes how — which data we take, what we derive from it, what we add, and what we throw away.

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

If this description is not enough for what you want to do, write to us and we will send the derived data itself. ODbL §4.6 gives you the choice between the two, and we would rather answer the question than have you guess.`,
    },
    {
      slug: 'notice',
      title: 'Legal notice',
      summary: 'Who operates this site and how to reach a human.',
      version: '1.0',
      effectiveFrom: '2026-09-23',
      body: `## Who operates this site {#operator}

CampTribe is operated by **{{company.name}}**.

Registered office: **{{company.street}}**, {{company.city}}, {{company.country}}

Enterprise number (KBO) and VAT number: **{{company.enterpriseNumber}}**

Email: [{{company.email}}](mailto:{{company.email}})

That address reaches a person and is the right one for everything — questions, corrections, data protection requests, complaints and legal notices alike.

## What this site does {#what}

CampTribe publishes information about campsites, derived from open data, and links to other people’s websites. It does not sell, book or arrange accommodation, transport or any other travel service, and it takes no payment from readers. The [terms of use](/legal/terms) set this out in full.

## Responsibility for content {#content}

The campsite information here comes from [open data sources](/legal/attribution), chiefly OpenStreetMap, which anyone may edit. We have not inspected these places. Where we link to other websites, their content is theirs and we do not control it.

> **Something unlawful or infringing?** Write to [{{company.email}}](mailto:{{company.email}}) saying what it is and where you found it. We will look at it promptly and remove or correct whatever we should.

## The other pages {#pages}

[Terms of use](/legal/terms) · [Privacy](/legal/privacy) · [Cookies](/legal/cookies) · [Data and attribution](/legal/attribution)`,
    },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const p of this.pages) {
      // 🔴 «ПРОПУСТИТИ, ЯКЩО Є» — ЦЕ БУВ МОВЧАЗНИЙ ПРОВАЛ, І РЕЦЕНЗІЯ
      // #315 довела його прогоном.
      //
      // `legal_pages` належить Directus (CAMP-89), тож на проді рядок
      // може існувати ДО цієї міграції. Заміряно: рядок `terms` v0.9 із
      // текстом «OUTDATED LEGAL TEXT» → міграція друкує «executed
      // successfully» → база й далі віддає застарілий правовий
      // документ. Гірше: сторінка з перекладом лише `nl` → англійський
      // текст не зʼявляється НІКОЛИ, бо міграція вже позначена
      // виконаною і вдруге не піде.
      //
      // Тому тепер три випадки, і жоден із них не тихий:
      //   немає    → вставляємо;
      //   є і ЗБІГАЄТЬСЯ → нічого не робимо (повторний прогін чистий);
      //   є і РІЗНЕ → кидаємо, назвавши slug.
      //
      // Кинути означає зупинити деплой. Для правового документа це
      // правильна ціна: людина мусить вирішити, чия версія чинна.
      const rows: Array<{ id: string; body: string | null }> =
        await queryRunner.query(
          `SELECT lp.id, t.body
             FROM legal_pages lp
             LEFT JOIN legal_page_translations t
               ON t.legal_page_id = lp.id AND t.language_code = 'en'
            WHERE lp.slug = $1`,
          [p.slug],
        );

      if (rows.length === 0) {
        const inserted: Array<{ id: string }> = await queryRunner.query(
          `INSERT INTO legal_pages (slug, version, effective_from, status)
           VALUES ($1, $2, $3, 'published') RETURNING id`,
          [p.slug, p.version, p.effectiveFrom],
        );
        await queryRunner.query(
          `INSERT INTO legal_page_translations
             (legal_page_id, language_code, title, plain_summary, body)
           VALUES ($1, 'en', $2, $3, $4)`,
          [inserted[0].id, p.title, p.summary, p.body],
        );
        continue;
      }

      const [row] = rows;
      if (row.body === null) {
        // Сторінка є, англійського перекладу немає — саме той
        // напівстан, який попередня редакція лишала назавжди.
        await queryRunner.query(
          `INSERT INTO legal_page_translations
             (legal_page_id, language_code, title, plain_summary, body)
           VALUES ($1, 'en', $2, $3, $4)`,
          [row.id, p.title, p.summary, p.body],
        );
        continue;
      }

      if (row.body !== p.body) {
        throw new Error(
          `legal_pages «${p.slug}» уже містить ІНШИЙ англійський текст ` +
            `(${row.body.length} символів проти ${p.body.length} у міграції). ` +
            'Міграція не перезаписує правовий документ мовчки: вирішіть, ' +
            'чия версія чинна, і або приведіть базу до коду, або ' +
            'позначте цю міграцію виконаною вручну.',
        );
      }
      // Збіглось — нічого робити, і це не привід мовчати про решту.
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 🔴 ВИДАЛЯЄМО ЛИШЕ ТЕ, ЩО ПОСАДИЛИ. Попередня редакція робила
    // беззастережний DELETE і була асиметрична до `up()`: той
    // відмовлявся чіпати чужий рядок, а цей його знищував. Заміряно
    // рецензією на тій самій базі: відкат зніс рукотворний `terms`
    // v0.9 і каскадом забрав голландський переклад `cookies`, якого
    // міграція ніколи не створювала.
    for (const p of this.pages) {
      const rows: Array<{ id: string }> = await queryRunner.query(
        `SELECT lp.id
           FROM legal_pages lp
           JOIN legal_page_translations t
             ON t.legal_page_id = lp.id AND t.language_code = 'en'
          WHERE lp.slug = $1 AND t.body = $2`,
        [p.slug, p.body],
      );
      if (rows.length === 0) continue;
      await queryRunner.query(`DELETE FROM legal_pages WHERE id = $1`, [
        rows[0].id,
      ]);
    }
  }
}
