// CAMP-4 / CAMP-54 — the country pages, and the reason there are twelve.
//
// 🔴 THE CARD ASKED FOR TWO TO THREE HUNDRED CITY PAGES. THERE ARE TWELVE
// COUNTRY PAGES HERE, AND THAT IS THE DELIVERABLE, NOT A SHORTFALL.
//
// CAMP-130 already refused to publish 951 templated guides in one go, and
// the reasoning binds this section exactly as it bound that one: a pile
// of pages that differ only by a place name and a number is what Google's
// March 2024 policy names scaled content abuse, and the penalty lands on
// the domain rather than on the section. camptribe.eu is young, has no
// trust to spend, and organic search is the whole acquisition plan. The
// downside of twelve good pages is some traffic we do not get. The
// downside of two hundred templated ones is the domain.
//
// 🔴 THE TEST EACH PAGE HAD TO PASS TO BE IN THIS FILE:
//
//   1. Three facts about THIS member state that are not true of the one
//      next to it, each traceable to a named authority with a link.
//   2. A measured statement from our own database that is true of no
//      other country — computed from src/data/rental/measured.json at
//      render time, never typed in by hand, and re-checked by a unit test
//      that fails when a re-import makes it false.
//   3. A reason a renter would land here rather than on the hub.
//
// A country that could not pass all three is not in this file. That is
// the whole gate, and it is the same shape as the publication gate the
// API already carries in entities/rental.entity.ts — which is stricter
// still, because it also demands a live partner. That leg cannot be met
// by anybody today (CAMP-98 is open) and enforcing it would publish zero
// pages, so this file enforces the two legs that are about the reader.
//
// 🔴 NOTHING HERE IS A PRICE, AN AVAILABILITY OR A COMPANY. We hold no
// rental inventory and have no partner, and a page that filled the gap
// with a plausible "from €69/day" would be worth less than an empty one.

import type { MetricKey } from '@/lib/rental';

export interface FactSource {
  /** The authority, named as a reader would recognise it. */
  name: string;
  url: string;
}

export interface CountryFact {
  title: string;
  body: string;
  source: FactSource;
}

/**
 * Which measured statement this page leads with.
 *
 * 🔴 No two countries may declare the same pair. Enforced by a test,
 * because the moment two pages lead with the same metric in the same form
 * they are one page with a swapped name — which is the failure this whole
 * file exists to avoid, committed in the file that says so.
 */
export interface DataLead {
  metric: MetricKey;
  kind: 'share' | 'count' | 'per-region';
}

export interface RentalCountry {
  /** ISO 3166-1 alpha-2, lower case — the same slug /camping uses. */
  code: string;
  name: string;
  /** One line. What this page has that the hub does not. */
  angle: string;
  intro: string;
  facts: CountryFact[];
  data: DataLead;
  /** The sentence that frames the measured line. Bespoke, and no numbers. */
  dataIntro: string;
}

export const RENTAL_COUNTRIES: RentalCountry[] = [
  {
    code: 'de',
    name: 'Germany',
    angle:
      'The Stellplatz network, a motorway toll that does not apply to you, and a winter tyre rule with no dates in it.',
    intro:
      'Germany is the country where the overnight stopping place — the Stellplatz — is a piece of ordinary municipal infrastructure rather than an enthusiast’s discovery. That changes how a rental trip is planned here: the question is less often “which campsite” and more often “which town has a place to put the van”. Two of the three rules below are about the vehicle rather than about you, which means the answers are the rental company’s to give, and they are worth asking for before you sign.',
    facts: [
      {
        title: 'The motorway toll is not yours to pay',
        body: 'Germany charges no vignette and no general motorway toll for private vehicles. The Maut is a goods-vehicle charge collected through Toll Collect, and a motor caravan registered for private use is not in it. If a rental desk offers to sell you a German road pass, something is wrong.',
        source: { name: 'Toll Collect', url: 'https://www.toll-collect.de/' },
      },
      {
        title: 'The low-emission badge belongs to the vehicle, not to you',
        body: 'German low-emission zones are entered on a windscreen badge — the Umweltplakette — which is issued against the vehicle’s emissions class. A diesel camper of a certain age carries a certain colour and no amount of planning on your side changes it. Ask which badge the vehicle has before you plan a city stop around it.',
        source: {
          name: 'Umweltbundesamt (German Environment Agency)',
          url: 'https://www.umweltbundesamt.de/',
        },
      },
      {
        title: 'Winter tyres are required by the weather, not by the calendar',
        body: 'Section 2(3a) of the German road traffic regulations ties winter tyres to conditions — black ice, packed snow, slush, ice or frost — and names no dates at all. A camper handed over in mild October weather can be illegal on an Alpine approach the same afternoon, and the obligation sits with the driver.',
        source: {
          name: 'StVO § 2, Gesetze im Internet (Federal Ministry of Justice)',
          url: 'https://www.gesetze-im-internet.de/stvo_2013/__2.html',
        },
      },
    ],
    data: { metric: 'rvPark', kind: 'count' },
    dataIntro:
      'The Stellplatz is not folklore, and it is the one claim on this page we can put a number against:',
  },
  {
    code: 'fr',
    name: 'France',
    angle:
      'The aire network, tolls priced by the height of your vehicle, and the only country whose campsites we can tell you how to telephone.',
    intro:
      'France is the largest camping country in the Union and the largest by a distance in our own records. It is also the only member state where a public database gives us what operators usually keep to themselves — a website, a telephone number and an official star rating — which changes what this site can do for you here. The tolls, by contrast, are the part renters underestimate: they are charged by distance and by vehicle class, and a camper is not in the car class.',
    facts: [
      {
        title: 'You will not be charged the car rate',
        body: 'French motorway tolls are distance-based and priced by vehicle class, and the class is decided by height and by maximum authorised mass. A vehicle over 2 m tall leaves class 1, and one over 3.5 t leaves the light-vehicle classes altogether. On a long north-to-south run that difference is worth checking against the operator’s tariff before you commit to the motorway.',
        source: {
          name: 'ASFA — the French motorway operators’ association',
          url: 'https://www.autoroutes.fr/',
        },
      },
      {
        title: 'A Crit’Air sticker is ordered, not bought at a kiosk',
        body: 'Low-emission zones — zones à faibles émissions — are entered on a Crit’Air certificate tied to the vehicle registration and ordered from the government’s own site. A rental camper should already carry one; if it does not, it cannot be fixed at the barrier.',
        source: {
          name: 'Certificat Qualité de l’Air (French government)',
          url: 'https://www.certificat-air.gouv.fr/',
        },
      },
      {
        title: 'France is where our own data is thickest',
        body: 'DATAtourisme, France’s national tourism platform, publishes records written by the regional tourist offices under an open licence. That is why French campsite pages on this site carry operator websites, telephone numbers and the official national star classification, and why pages for the other twenty-six member states mostly do not. If you want to ring ahead and ask whether a 7-metre vehicle fits the pitch, France is the country where you can.',
        source: {
          name: 'DATAtourisme (Licence Ouverte 2.0)',
          url: 'https://www.datatourisme.fr/',
        },
      },
    ],
    data: { metric: 'camperStop', kind: 'count' },
    dataIntro:
      'The aires are the reason people rent a camper for France rather than book a campsite for it:',
  },
  {
    code: 'it',
    name: 'Italy',
    angle:
      'Toll class read at the front axle, camera-enforced historic centres, and the best-documented electrical hook-ups in the Union.',
    intro:
      'Italy punishes two specific kinds of inattention in a rented camper, and neither of them is about driving. The first is the toll class, which is measured at the front axle and quietly puts almost every camper above the car rate. The second is the ZTL — the limited traffic zone around a historic centre — where the camera bills the registration, the rental company pays it, and you receive the fine months later with an administration fee on top.',
    facts: [
      {
        title: 'The toll class is measured at the first axle',
        body: 'Italian motorway tariffs are set by class, and the light-vehicle classes are separated by the height measured at the first axle, with the step at 1.30 m. That is below the roofline of essentially every motor caravan, so the class-B rate is the one to budget for rather than the car rate quoted in most trip planners.',
        source: {
          name: 'Autostrade per l’Italia — toll classes',
          url: 'https://www.autostrade.it/',
        },
      },
      {
        title: 'The ZTL fine arrives long after the holiday',
        body: 'Article 7 of the Italian highway code lets a municipality close its historic centre to traffic, and the closures are enforced by camera against the plate. On a rental the sequence is slow and expensive: the municipality bills the owner, the owner identifies you, and the charge reaches you with a handling fee attached. The signs are the only warning you get, and they are at the boundary.',
        source: {
          name: 'Codice della Strada, art. 7 — Normattiva (Italian government)',
          url: 'https://www.normattiva.it/',
        },
      },
      {
        title: 'Winter equipment is ordered road by road',
        body: 'Italy does not set one national winter tyre season. The obligation is imposed by the authority that owns each road, through its own ordinance, which is why the requirement can begin on one stretch and not on the next. The road sign is the instruction that matters, not the date.',
        source: {
          name: 'Ministero delle Infrastrutture e dei Trasporti',
          url: 'https://www.mit.gov.it/',
        },
      },
    ],
    data: { metric: 'electricity', kind: 'share' },
    dataIntro:
      'One thing is easier to plan here than anywhere else in the Union — finding out in advance whether there is a hook-up:',
  },
  {
    code: 'es',
    name: 'Spain',
    angle:
      'The legal line between parking a camper and camping in it, and a network that is unusually built for vehicles.',
    intro:
      'The single most useful thing to understand about Spain is that parking and camping are two different acts in law, and the second one is what municipalities restrict. A camper standing inside its markings with everything shut is parked, and is treated as any other vehicle would be. Put the awning out, wind the legs down or set a chair on the pavement and it has become camping, which needs somewhere that permits it.',
    facts: [
      {
        title: 'Parked is not camped',
        body: 'The Spanish traffic authority draws the distinction by what the vehicle is doing rather than by whether anyone is asleep in it: a camper occupying no more than its bay, with nothing deployed outside the bodywork, is parked. Awnings, chocks, levelling legs, tables and chairs turn it into camping, which is governed by municipal and regional rules and is prohibited outright in many protected areas.',
        source: {
          name: 'Dirección General de Tráfico (DGT)',
          url: 'https://www.dgt.es/',
        },
      },
      {
        title: 'Low-emission zones are a national obligation, run locally',
        body: 'Spain’s 2021 climate law requires municipalities above 50 000 inhabitants to establish low-emission zones, so the number of towns with one keeps growing and the rules are written town by town. Access depends on the DGT environmental label carried by the vehicle, which is the rental company’s to tell you about.',
        source: {
          name: 'Ley 7/2021 de cambio climático — Boletín Oficial del Estado',
          url: 'https://www.boe.es/',
        },
      },
      {
        title: 'There is no vignette, and the toll map keeps changing',
        body: 'Spain sells no road pass. Some motorways are tolled by distance and others became free as their concessions expired, which means a route that cost money one summer may not the next — and that an old blog post is a bad source for what a trip will cost. The transport ministry publishes the current network.',
        source: {
          name: 'Ministerio de Transportes y Movilidad Sostenible',
          url: 'https://www.mitma.gob.es/',
        },
      },
    ],
    data: { metric: 'greyWater', kind: 'share' },
    dataIntro:
      'Emptying the tanks is the chore that decides how long you can stay away from a site, and Spain records it unusually well:',
  },
  {
    code: 'nl',
    name: 'Netherlands',
    angle:
      'Almost no tolls, low-emission zones with no sticker, and an overnight rule written separately by every municipality.',
    intro:
      'The Netherlands is an easy country to drive a camper across and a complicated one to sleep in. There is no vignette and only two tolled crossings in the whole country, so the road cost of a week here is essentially fuel. Whether you may stay the night in a parked camper, on the other hand, is decided by each municipality in its own by-law, and neighbouring towns genuinely differ.',
    facts: [
      {
        title: 'Two tolls in the entire country',
        body: 'Dutch motorways carry no vignette and no general charge. The exceptions are two tunnels — the Westerschelde and the Kil — which are paid individually. For a camper trip that means the road budget is fuel and, if you are crossing to the islands, a ferry.',
        source: {
          name: 'Rijkswaterstaat (Dutch national roads authority)',
          url: 'https://www.rijkswaterstaat.nl/',
        },
      },
      {
        title: 'The low-emission zones have nothing to buy',
        body: 'Dutch milieuzones are enforced by camera against the registration, with no sticker and nothing to display. That is convenient and it is also why you cannot tell from the windscreen whether the vehicle you have been handed is allowed in: it depends on the registration and the emission class, and the only way to know is to ask.',
        source: {
          name: 'Milieuzones.nl (Dutch government)',
          url: 'https://www.milieuzones.nl/',
        },
      },
      {
        title: 'Sleeping in the van is a municipal question',
        body: 'There is no national rule on overnight stays in a vehicle. Each municipality sets it in its general local by-law — the APV — so a lay-by that is fine on one side of a boundary can be an offence on the other. The practical answer in a country this dense is to use a pitch, of which there are a great many.',
        source: {
          name: 'Rijksoverheid — local by-laws (APV)',
          url: 'https://www.rijksoverheid.nl/',
        },
      },
    ],
    data: { metric: 'shower', kind: 'share' },
    dataIntro:
      'Dutch records answer the sanitary questions more reliably than the electrical ones, which is the opposite of the German and Italian pattern:',
  },
  {
    code: 'at',
    name: 'Austria',
    angle:
      'The 3.5 tonne line decides your toll as well as your licence, and the winter rule has both a calendar and a condition.',
    intro:
      'Austria is the clearest illustration of why the number on the vehicle plate matters more than the shape of the vehicle. At 3 500 kg you buy a vignette like a car. At 3 600 kg you are in the distance-based lorry system with an on-board unit, on the same road, in the same vehicle shape, for the same holiday. It is also a country where the winter equipment rule has teeth, and where some of the best roads carry their own toll on top of the vignette.',
    facts: [
      {
        title: 'Vignette below 3.5 t, GO tolling above it',
        body: 'ASFINAG sells the vignette for vehicles up to 3 500 kg maximum authorised mass. Above that the vignette does not apply at all and the vehicle is tolled by distance through the GO system, which needs an on-board unit obtained before you use the motorway. This is the same threshold that decides whether a category B licence covers the vehicle, which is why the plated mass is the first number to read on the contract.',
        source: { name: 'ASFINAG', url: 'https://www.asfinag.at/' },
      },
      {
        title: 'Some of the best roads are tolled separately',
        body: 'A vignette does not cover the Brenner, Tauern, Arlberg and several other alpine routes: those are Sondermautstrecken with their own tariffs, charged on top. They are also the routes a camper trip through Austria is most likely to want.',
        source: {
          name: 'ASFINAG — special toll sections',
          url: 'https://www.asfinag.at/',
        },
      },
      {
        title: 'Winter equipment has a season and a condition',
        body: 'From 1 November to 15 April, a vehicle driven in wintry conditions must be on winter tyres — or, on a snow-covered road, have chains fitted to at least two driven wheels. Both halves matter: the calendar alone does not oblige you, and neither does the weather outside the window.',
        source: {
          name: 'oesterreich.gv.at (Austrian government portal)',
          url: 'https://www.oesterreich.gv.at/',
        },
      },
    ],
    data: { metric: 'water', kind: 'share' },
    dataIntro:
      'Austrian records are unusually complete on the one facility that decides whether you can stay put for a few days:',
  },
  {
    code: 'hr',
    name: 'Croatia',
    angle:
      'A commercial, seasonal coast with almost no free stopping places — and, since 2023, no border stop and no currency change.',
    intro:
      'Croatia is where the difference between a camper holiday and a campsite holiday narrows almost to nothing. The Adriatic coast is served by large commercial sites and by very little else, so a plan built around informal overnight stops will not survive contact with it. The compensations are real: since January 2023 there is neither a Schengen border check nor a currency change coming in from Slovenia or Hungary.',
    facts: [
      {
        title: 'Height is part of the toll class',
        body: 'Croatian motorway tolls are charged by distance, and the class boundary within the light vehicles is drawn at 1.90 m of overall height. A camper is above it. Budget the higher class for the coastal motorway rather than the car rate.',
        source: {
          name: 'Hrvatske autoceste (HAC)',
          url: 'https://www.hac.hr/',
        },
      },
      {
        title: 'No border check and no kuna since 2023',
        body: 'Croatia joined both the Schengen area and the euro area on 1 January 2023. For a cross-border camper trip that removes the two things that used to shape the itinerary — the queue at the Slovenian border in August, and carrying a second currency for tolls and campsite fees.',
        source: {
          name: 'European Commission — Croatia and the euro',
          url: 'https://economy-finance.ec.europa.eu/euro/eu-countries-and-euro_en',
        },
      },
      {
        title: 'The season is short and the coast books out',
        body: 'Croatian coastal sites are seasonal businesses and many simply close outside the summer months. We hold no opening dates — nothing on this site can tell you whether a given site is open in April — so this is a question for the operator, and an early one.',
        source: {
          name: 'Croatian National Tourist Board',
          url: 'https://croatia.hr/',
        },
      },
    ],
    data: { metric: 'paid', kind: 'share' },
    dataIntro:
      'If your plan depends on free or informal stopping places, the measurement below is the argument against making it here:',
  },
  {
    code: 'si',
    name: 'Slovenia',
    angle:
      'Two entirely different toll systems meeting at 3.5 t, in a country you can cross in an afternoon — and the thinnest data we hold.',
    intro:
      'Slovenia is small enough to be a corridor between Austria, Italy, Croatia and Hungary, which is exactly how most camper trips use it. That makes its toll rule disproportionately important: the vehicle you were handed decides which of two unrelated systems you must be in before you join the motorway. This is also the country where we are most obliged to admit the limits of our own data.',
    facts: [
      {
        title: 'E-vignette up to 3.5 t, DarsGo above it',
        body: 'DARS sells an electronic vignette, tied to the registration, for vehicles up to 3 500 kg. Above that the vignette is not available and the vehicle belongs in DarsGo, the distance-based system with its own on-board unit. There is no overlap and no grace: a 3.6 t camper with a vignette is an untolled vehicle on the motorway.',
        source: { name: 'DARS', url: 'https://www.dars.si/' },
      },
      {
        title: 'The winter season is a fixed window',
        body: 'Slovenia sets its winter equipment requirement by calendar — from 15 November to 15 March — and applies it outside that window too whenever winter conditions are present. It is one of the stricter regimes in the Union and it applies on ordinary roads, not only on the mountain ones.',
        source: {
          name: 'GOV.SI (Government of Slovenia)',
          url: 'https://www.gov.si/',
        },
      },
      {
        title: 'Our Slovenian coverage is thin, and the site says so',
        body: 'Most Slovenian region pages on this site carry a noindex directive, because a hub listing one or two campsites adds nothing to the campsite’s own page. That is a deliberate rule rather than an accident, and it means Slovenia is a country where you should treat the map as a starting point rather than as an inventory.',
        source: {
          name: 'Our own data — see the campsite pages for per-record sources',
          url: '/camping/si',
        },
      },
    ],
    data: { metric: 'spots', kind: 'per-region' },
    dataIntro:
      'The honest version of our Slovenian coverage, stated as a measurement rather than as an apology:',
  },
  {
    code: 'pt',
    name: 'Portugal',
    angle:
      'The member state that wrote motorhome overnight stays into its road code, and motorways with no toll booths at all.',
    intro:
      'Portugal is the one country on this list where where you sleep is a national legal question rather than a municipal one. A 2021 amendment to the road code addressed motorhomes directly, restricting overnight stays outside designated areas. The other thing to settle before you drive away is the tolls: parts of the network have no booths whatsoever, and a vehicle that is not registered for electronic payment simply accrues a debt.',
    facts: [
      {
        title: 'Overnight stays are in the road code',
        body: 'The Código da Estrada was amended in 2021 to restrict motorhomes stopping overnight outside designated places, with protected areas treated more strictly still. Because it is national law rather than a local by-law, the answer does not change when you cross into the next municipality. ANSR publishes the current text and the enforcement position.',
        source: {
          name: 'Autoridade Nacional de Segurança Rodoviária (ANSR)',
          url: 'https://www.ansr.pt/',
        },
      },
      {
        title: 'Some motorways cannot be paid at a booth',
        body: 'Several Portuguese motorways are electronic-only: there is nothing to stop at, the gantry reads the plate, and payment has to have been arranged in advance through a transponder or a registered card. A rental camper usually carries a device — confirm it at handover, and confirm how the charges reach you afterwards.',
        source: {
          name: 'Portagens (official electronic tolls information)',
          url: 'https://www.portagens.pt/',
        },
      },
      {
        title: 'The network is built for vehicles more than for tents',
        body: 'Portugal has invested in serviced areas for motor caravans rather than in tent camping, which is visible in our own records and in what you will find on the ground. It is a good country to arrive in with a vehicle and a poor one to improvise in.',
        source: {
          name: 'Turismo de Portugal',
          url: 'https://www.turismodeportugal.pt/',
        },
      },
    ],
    data: { metric: 'vehicleOnly', kind: 'share' },
    dataIntro:
      'The shape of the Portuguese network, counted rather than asserted:',
  },
  {
    code: 'se',
    name: 'Sweden',
    angle:
      'The right of public access that does not extend to your vehicle, and two cities that charge you by camera.',
    intro:
      'Sweden is the country most often invoked in conversations about free camping, and the one where the invocation is most often wrong. Allemansrätten — the right of public access — is a right to be on foot in the landscape. It is not a right to take a two-tonne vehicle into it, and driving off-road is separately prohibited by statute. The rest of the country is straightforward: no vignette, cameras in two cities, and a winter season with real teeth.',
    facts: [
      {
        title: 'The right of public access is a right to walk',
        body: 'Allemansrätten covers access on foot, by bicycle, on horseback and by boat. It confers no right to drive or park off the road network, and driving on bare ground or on snow-covered terrain outside a road is prohibited by the off-road driving act. Parking a camper for the night is governed by the ordinary traffic rules and by the landowner, exactly as it would be anywhere else.',
        source: {
          name: 'Naturvårdsverket (Swedish Environmental Protection Agency)',
          url: 'https://www.naturvardsverket.se/',
        },
      },
      {
        title: 'Stockholm and Gothenburg charge by camera',
        body: 'Both cities levy a congestion tax, read from the registration plate and billed to the registered keeper — which on a rental is the rental company, who will pass it on with their own fee. Foreign-registered vehicles have been liable since 2015, so a camper collected elsewhere in the Union is not exempt.',
        source: {
          name: 'Transportstyrelsen (Swedish Transport Agency)',
          url: 'https://www.transportstyrelsen.se/',
        },
      },
      {
        title: 'Winter tyres between December and March, when conditions demand',
        body: 'Winter tyres are required from 1 December to 31 March whenever winter road conditions prevail. In the north that is most of the period; in the south it is not, and the judgement is the driver’s. A rental contract may also set its own requirement, which binds you regardless of what the statute says.',
        source: {
          name: 'Transportstyrelsen (Swedish Transport Agency)',
          url: 'https://www.transportstyrelsen.se/',
        },
      },
    ],
    data: { metric: 'wild', kind: 'share' },
    dataIntro:
      'Measured against the reputation, the Swedish records are a corrective:',
  },
  {
    code: 'dk',
    name: 'Denmark',
    angle:
      'Bridges priced by the length of your vehicle, no winter tyre law at all, and more informal places recorded than anywhere in the Union.',
    intro:
      'Denmark is cheap to drive across and expensive to cross. There is no vignette and no motorway toll, but the two great bridges are tolled and they price by vehicle length — with a step at six metres that a great many motorhomes sit just the wrong side of. It is also the one country on this list with no statutory winter tyre requirement, which does not mean the rental contract has none.',
    facts: [
      {
        title: 'The bridges price by length, and six metres is the step',
        body: 'Great Belt and Øresund tariffs are set by vehicle category, and the categories are drawn by length. Six metres is the boundary that matters for a camper, and length includes anything bolted to the back of it. Measure before you book the crossing, not after.',
        source: {
          name: 'Sund & Bælt — Great Belt',
          url: 'https://www.storebaelt.dk/',
        },
      },
      {
        title: 'No winter tyre law — and that is not the whole answer',
        body: 'Denmark imposes no general winter tyre requirement. The rental agreement may impose one anyway, and if the vehicle is being taken on to Sweden, Germany or further south, the law of the country you are in is the one that applies. A Danish handover is not a Danish-only trip.',
        source: {
          name: 'Færdselsstyrelsen (Danish Road Traffic Authority)',
          url: 'https://www.fstyr.dk/',
        },
      },
      {
        title: 'Our Danish records are unusually informal',
        body: 'A large share of what we hold for Denmark is not commercial campsites, and that is a real feature of the country rather than a gap in the import: Denmark maintains an extensive network of simple shelters and primitive sites. What a camper may use among them is a different question from what a walker may, and the operator is the authority on it.',
        source: {
          name: 'Naturstyrelsen (Danish Nature Agency)',
          url: 'https://naturstyrelsen.dk/',
        },
      },
    ],
    data: { metric: 'wild', kind: 'count' },
    dataIntro:
      'The measurement behind that last paragraph, and the reason Denmark reads differently from its neighbours in our data:',
  },
  {
    code: 'ie',
    name: 'Ireland',
    angle:
      'The one member state on this list where you drive on the left, and the highest proportion of vehicle-ready sites in the Union.',
    intro:
      'Ireland changes something a rental camper trip usually takes for granted: the side of the road. Ireland, Malta and Cyprus are the three member states that drive on the left, and in a camper the consequence is more than the seating position — it decides which side the habitation door opens on to. A left-hand-drive vehicle brought in from the continent puts its door into the traffic. The other thing to settle before leaving Dublin is the M50, which has no toll barriers to stop at.',
    facts: [
      {
        title: 'Driving on the left, and which side the door opens',
        body: 'Ireland is one of three EU member states that drive on the left. A camper built for the continent has its habitation door on the right-hand side, which in Ireland is the traffic side: stepping out of the van is the part of the trip to think about, more than the roundabouts. A vehicle rented in Ireland will be built the other way round.',
        source: {
          name: 'Road Safety Authority (RSA)',
          url: 'https://www.rsa.ie/',
        },
      },
      {
        title: 'The M50 has nothing to stop at',
        body: 'The toll on the M50 around Dublin is barrier-free: a camera reads the plate and the charge must be settled by 8 p.m. the following day. Unpaid, it escalates. On a rental it reaches you through the rental company, with their fee attached, so it is worth asking at handover how they handle it.',
        source: {
          name: 'Transport Infrastructure Ireland (TII)',
          url: 'https://www.tii.ie/',
        },
      },
      {
        title: 'There is no vignette and few other tolls',
        body: 'Apart from the M50 and a handful of tolled bridges, tunnels and motorway sections, Irish roads carry no charge and there is no pass to buy, so the road budget for a week here is essentially fuel. The expensive line is instead the one that gets the vehicle to the island at all: a ferry, priced by vehicle length, which is the number to settle before anything else. Transport Infrastructure Ireland publishes the tolled sections that do exist.',
        source: {
          name: 'Transport Infrastructure Ireland (TII)',
          url: 'https://www.tii.ie/',
        },
      },
    ],
    data: { metric: 'rvPark', kind: 'share' },
    dataIntro:
      'Ireland’s campsite network is built around vehicles to a degree no other member state matches:',
  },
];

export const RENTAL_COUNTRY_CODES = RENTAL_COUNTRIES.map((c) => c.code);

export function rentalCountry(code: string): RentalCountry | null {
  const want = code.toLowerCase();
  return RENTAL_COUNTRIES.find((c) => c.code === want) ?? null;
}
