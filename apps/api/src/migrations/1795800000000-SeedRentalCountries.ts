import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Дванадцять країн оренди переїжджають із коду в CMS — CAMP-479.
 *
 * 🔴 ЦЕЙ ФАЙЛ ЗГЕНЕРОВАНО, А НЕ НАБРАНО, як і міграція маршрутів. Текст
 * прочитано просто з `apps/web/src/data/rental/countries.ts` і
 * серіалізовано машиною: 3 818 слів передруку дають розбіжність, якої не
 * видно в рецензії.
 *
 * 🔴 ЩО САМЕ ПЕРЕЇХАЛО, А ЩО СВІДОМО ЛИШИЛОСЬ У КОДІ:
 *   • переїхало — назва, кут сторінки, вступ, підвід до заміру й три
 *     факти про країну з їхніми джерелами. Це текст, і його має правити
 *     власник;
 *   • лишилось — `data.metric` і `data.kind` (вони обирають ОБЧИСЛЕННЯ,
 *     а не показуються читачеві) та `definiteArticle` (англійська
 *     граматика назви). Редактор, що змінив би `metric`, зламав би
 *     сторінку, а не текст.
 *
 * 🔴 `thresholds.ts` НЕ ПЕРЕЇХАВ І НЕ ПЕРЕЇДЕ ЦІЄЮ КАРТКОЮ. Це не опис, а
 * регуляторні твердження: з якої маси потрібна категорія C1, де
 * перестають продавати віньєтку, коли вимагають зимові шини. Помилкову
 * цифру там побачить водій, і ніхто її не перевірить — та сама причина,
 * через яку правові сторінки лишаються в міграціях.
 *
 * 🔴 ЖОДНОЇ НОВОЇ КОЛЕКЦІЇ: прод стоїть на 25 зареєстрованих при межі 25.
 * Сторінки країн ідуть у `pages` з `type = 'rental-country'`.
 *
 * 🔴 ІДЕМПОТЕНТНО: країна, що вже є, пропускається.
 */

interface SeedSection {
  sort: number;
  /** Роль секції: `intro`, `data-intro`, `fact:N`. */
  slot: string;
  heading: string | null;
  body: string;
  items: Array<{ term: string; detail: string }>;
}

interface SeedCountry {
  code: string;
  name: string;
  angle: string;
  sections: SeedSection[];
}

const COUNTRIES: SeedCountry[] = [
  {
    code: 'de',
    name: 'Germany',
    angle:
      'The Stellplatz network, a motorway toll that does not apply to you, and a winter tyre rule with no dates in it.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Germany is the country where the overnight stopping place — the Stellplatz — is a piece of ordinary municipal infrastructure rather than an enthusiast’s discovery. That changes how a rental trip is planned here: the question is less often “which campsite” and more often “which town has a place to put the van”. Two of the three rules below are about the vehicle rather than about you, which means the answers are the rental company’s to give, and they are worth asking for before you sign.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'The Stellplatz is not folklore, and it is the one claim on this page we can put a number against:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'The motorway toll is not yours to pay',
        body: 'Germany sells no vignette. The German toll falls on motor vehicles over 3.5 tonnes that are intended for, or are being used for, the carriage of goods — that is the test Toll Collect publishes, and a privately hired motor caravan is neither. So there is nothing for you to buy before you join the autobahn, and if a rental desk offers to sell you a German road pass, something is wrong.',
        items: [
          {
            term: 'Toll Collect — vehicles subject to toll',
            detail:
              'https://www.toll-collect.de/en/toll_collect/rund_um_die_maut/mautpflichtige_fahrzeuge/mautpflichtige_fahrzeuge.html',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'The low-emission badge belongs to the vehicle, not to you',
        body: 'German low-emission zones are entered on a windscreen badge — the Umweltplakette — which is issued against the vehicle’s emissions class. A diesel camper of a certain age carries a certain colour and no amount of planning on your side changes it. Ask which badge the vehicle has before you plan a city stop around it.',
        items: [
          {
            term: 'Umweltbundesamt (German Environment Agency)',
            detail: 'https://www.umweltbundesamt.de/',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading:
          'Winter tyres are required by the weather, not by the calendar',
        body: 'Section 2(3a) of the German road traffic regulations ties winter tyres to conditions — black ice, packed snow, slush, ice or frost — and names no dates at all. A camper handed over in mild October weather can be illegal on an Alpine approach the same afternoon, and the obligation sits with the driver.',
        items: [
          {
            term: 'StVO § 2, Gesetze im Internet (Federal Ministry of Justice)',
            detail: 'https://www.gesetze-im-internet.de/stvo_2013/__2.html',
          },
        ],
      },
    ],
  },
  {
    code: 'fr',
    name: 'France',
    angle:
      'The aire network, tolls priced by the height of your vehicle, and the only country whose campsites we can tell you how to telephone.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'France is the largest camping country in the Union and the largest by a distance in our own records. It is also the only member state where a public database gives us what operators usually keep to themselves — a website, a telephone number and an official star rating — which changes what this site can do for you here. The tolls, by contrast, are the part renters underestimate: they are charged by distance and by vehicle class, and a camper is not in the car class.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'The aires are the reason people rent a camper for France rather than book a campsite for it:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'You will not be charged the car rate',
        body: 'French motorway tolls are distance-based and priced by class, and the class is decided by height and maximum authorised mass. Class 1 is up to 2 m and 3.5 t. Class 2 runs from 2 m to 3 m — ASFA’s own description of that class names motor caravans as most of it. At 3 m or above, or over 3.5 t, you are in class 3 with the two-axle lorries and coaches. On a long north-to-south run the gap between class 1 and class 3 is the size of a campsite week.',
        items: [
          {
            term: 'ASFA — French vehicle classification',
            detail:
              'https://www.autoroutes.fr/fr/classification-des-vehicules.htm',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'A Crit’Air sticker is ordered, not bought at a kiosk',
        body: 'Low-emission zones — zones à faibles émissions — are entered on a Crit’Air certificate tied to the vehicle registration and ordered from the government’s own site. A rental camper should already carry one; if it does not, it cannot be fixed at the barrier.',
        items: [
          {
            term: 'Certificat Qualité de l’Air (French government)',
            detail: 'https://www.certificat-air.gouv.fr/',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'France is where our own data is thickest',
        body: 'DATAtourisme, France’s national tourism platform, publishes records written by the regional tourist offices under an open licence. That is why French campsite pages on this site carry operator websites, telephone numbers and the official national star classification, and why pages for the other twenty-six member states mostly do not. If you want to ring ahead and ask whether a 7-metre vehicle fits the pitch, France is the country where you can.',
        items: [
          {
            term: 'DATAtourisme (Licence Ouverte 2.0)',
            detail: 'https://www.datatourisme.fr/',
          },
        ],
      },
    ],
  },
  {
    code: 'it',
    name: 'Italy',
    angle:
      'Toll class read at the front axle, camera-enforced historic centres, and the best-documented electrical hook-ups in the Union.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Italy punishes two specific kinds of inattention in a rented camper, and neither of them is about driving. The first is the toll class, which is measured at the front axle and quietly puts almost every camper above the car rate. The second is the ZTL — the limited traffic zone around a historic centre — where the camera bills the registration, the rental company pays it, and you receive the fine months later with an administration fee on top.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'One thing is easier to plan here than anywhere else in the Union — finding out in advance whether there is a hook-up:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'The toll class is measured at the first axle',
        body: 'Italian motorway tariffs are set by the number of axles and by height, and among two-axle vehicles the line is drawn at 1.30 m measured at the front axle: below it class A, above it class B. That is not the roofline, it is the bonnet — and essentially every motor caravan is above it. Budget class B rather than the car rate that trip planners quote.',
        items: [
          {
            term: 'Autostrade per l’Italia — toll classes',
            detail:
              'https://www.autostrade.it/en/servizi-al-cliente/pedaggio/classi-di-pedaggio',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'The ZTL fine arrives long after the holiday',
        body: 'Article 7 of the Italian highway code lets a municipality close its historic centre to traffic, and the closures are enforced by camera against the plate. On a rental the sequence is slow and expensive: the municipality bills the owner, the owner identifies you, and the charge reaches you with a handling fee attached. The signs are the only warning you get, and they are at the boundary.',
        items: [
          {
            term: 'Codice della Strada, art. 7 — Normattiva (Italian government)',
            detail: 'https://www.normattiva.it/',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'Winter equipment is ordered road by road',
        body: 'Italy does not set one national winter tyre season. The obligation is imposed by the authority that owns each road, through its own ordinance, which is why the requirement can begin on one stretch and not on the next. The road sign is the instruction that matters, not the date.',
        items: [
          {
            term: 'Ministero delle Infrastrutture e dei Trasporti',
            detail: 'https://www.mit.gov.it/',
          },
        ],
      },
    ],
  },
  {
    code: 'es',
    name: 'Spain',
    angle:
      'The legal line between parking a camper and camping in it, and a network that is unusually built for vehicles.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'The single most useful thing to understand about Spain is that parking and camping are two different acts in law, and the second one is what municipalities restrict. A camper standing inside its markings with everything shut is parked, and is treated as any other vehicle would be. Put the awning out, wind the legs down or set a chair on the pavement and it has become camping, which needs somewhere that permits it.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'Emptying the tanks is the chore that decides how long you can stay away from a site, and Spain records it unusually well:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'Parked is not camped',
        body: 'The Spanish traffic authority draws the distinction by what the vehicle is doing rather than by whether anyone is asleep in it: a camper occupying no more than its bay, with nothing deployed outside the bodywork, is parked. Awnings, chocks, levelling legs, tables and chairs turn it into camping, which is governed by municipal and regional rules and is prohibited outright in many protected areas.',
        items: [
          {
            term: 'Dirección General de Tráfico (DGT)',
            detail: 'https://www.dgt.es/',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'Low-emission zones are a national obligation, run locally',
        body: 'Article 14 of Spain’s 2021 climate law obliges municipalities above 50 000 inhabitants — and smaller ones where pollution limits are exceeded — to adopt mobility plans that include a low-emission zone, and a 2022 royal decree sets what those zones must contain. The consequence for a visitor is that the number of Spanish towns with restrictions keeps growing and each writes its own, while access turns on the DGT environmental label the vehicle carries. That label is the rental company’s to tell you about.',
        items: [
          {
            term: 'Ley 7/2021, art. 14 — Boletín Oficial del Estado',
            detail: 'https://www.boe.es/buscar/act.php?id=BOE-A-2021-8447',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'There is no vignette, and the toll map keeps changing',
        body: 'Spain sells no road pass. Some motorways are tolled by distance and others became free as their concessions expired, which means a route that cost money one summer may not the next — and that an old blog post is a bad source for what a trip will cost. The transport ministry publishes the current network.',
        items: [
          {
            term: 'Ministerio de Transportes y Movilidad Sostenible',
            detail: 'https://www.mitma.gob.es/',
          },
        ],
      },
    ],
  },
  {
    code: 'nl',
    name: 'Netherlands',
    angle:
      'Almost no tolls, low-emission zones with no sticker, and an overnight rule written separately by every municipality.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'The Netherlands is an easy country to drive a camper across and a complicated one to sleep in. There is no vignette and only a handful of individually tolled links, so the road cost of a week here is essentially fuel. Whether you may stay the night in a parked camper, on the other hand, is decided by each municipality in its own by-law, and neighbouring towns genuinely differ.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'Dutch records answer the sanitary questions more reliably than the electrical ones, which is the opposite of the German and Italian pattern:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'Almost no tolls — and the newest one names campers',
        body: 'There is no Dutch vignette and no general motorway charge; a handful of individual links are tolled instead. The newest of them is worth reading even if you never use it, because it shows the pattern the rest of this section is about: the published tariff for the A24 Blankenburg link lists cars, vans, campers and motorbikes up to 3 500 kg at one rate and heavier vehicles at several times that. There are no barriers — you pay afterwards, online, against the registration.',
        items: [
          {
            term: 'Rijksoverheid — tolls on the Blankenburgverbinding and ViA15',
            detail:
              'https://www.rijksoverheid.nl/onderwerpen/wegen/tijdelijke-tolheffing-blankenburgverbinding-en-via15',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading:
          'The low-emission zones have nothing to buy and nothing to display',
        body: 'Access to a Dutch milieuzone is decided by the vehicle’s emission class, looked up from its registration. There is no sticker to obtain and nothing in the windscreen to check, which cuts both ways: it is one less errand, and it is also why you cannot tell by looking whether the camper you have been handed may enter. The official Milieuzonecheck answers it from the number plate in a few seconds, and that is a question to settle before you plan a city stop rather than at the sign.',
        items: [
          {
            term: 'Milieuzones.nl (Dutch government)',
            detail: 'https://www.milieuzones.nl/',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'Sleeping in the van is a municipal question',
        body: 'There is no national rule on overnight stays in a vehicle. Each municipality sets it in its general local by-law — the APV — so a lay-by that is fine on one side of a boundary can be an offence on the other. The practical answer in a country this dense is to use a pitch, of which there are a great many.',
        items: [
          {
            term: 'Rijksoverheid — local by-laws (APV)',
            detail: 'https://www.rijksoverheid.nl/',
          },
        ],
      },
    ],
  },
  {
    code: 'at',
    name: 'Austria',
    angle:
      'The 3.5 tonne line decides your toll as well as your licence, and the winter rule has both a calendar and a condition.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Austria is the clearest illustration of why the number on the vehicle plate matters more than the shape of the vehicle. At 3 500 kg you buy a vignette like a car. At 3 600 kg you are in the distance-based lorry system with an on-board unit, on the same road, in the same vehicle shape, for the same holiday. It is also a country where the winter equipment rule has teeth, and where some of the best roads carry their own toll on top of the vignette.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'Austrian records are unusually complete on the one facility that decides whether you can stay put for a few days:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'Vignette below 3.5 t, GO tolling above it',
        body: 'ASFINAG puts it in as many words: cars, motorbikes and camper vans up to 3.5 tonnes technically permissible maximum laden mass must display a vignette. Above that the vignette does not apply at all and the vehicle is tolled by distance through the GO system, which needs an on-board unit obtained before you use the motorway. It is the same threshold that decides whether a category B licence covers the vehicle, which is why the plated mass is the first number to read on the contract.',
        items: [
          {
            term: 'ASFINAG — vignette',
            detail: 'https://www.asfinag.at/en/toll/vignette/',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'Some of the best roads are tolled separately',
        body: 'A vignette does not cover the Brenner, Tauern, Arlberg and several other alpine routes: those are Sondermautstrecken with their own tariffs, charged on top. They are also the routes a camper trip through Austria is most likely to want.',
        items: [
          {
            term: 'ASFINAG — special toll sections',
            detail: 'https://www.asfinag.at/',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'Winter equipment has a season and a condition',
        body: 'Between 1 November and 15 April, a vehicle up to 3.5 tonnes may only be driven in wintry conditions with winter tyres on all four wheels — and the tread has to be at least 4 mm, deeper than the ordinary minimum. Both halves of the rule matter: the calendar alone does not oblige you, and neither does the weather outside the window. Wintry conditions means snow, slush or ice on the road, which in the Alps is a question about the next hour rather than the season.',
        items: [
          {
            term: 'oesterreich.gv.at — compulsory use of winter tyres',
            detail:
              'https://www.oesterreich.gv.at/en/themen/mobilitaet/kfz/10/2/Seite.063100',
          },
        ],
      },
    ],
  },
  {
    code: 'hr',
    name: 'Croatia',
    angle:
      'A commercial, seasonal coast with almost no free stopping places — and, since 2023, no border stop and no currency change.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Croatia is where the difference between a camper holiday and a campsite holiday narrows almost to nothing. The Adriatic coast is served by large commercial sites and by very little else, so a plan built around informal overnight stops will not survive contact with it. The compensations are real: since January 2023 there is neither a Schengen border check nor a currency change coming in from Slovenia or Hungary.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'If your plan depends on free or informal stopping places, the measurement below is the argument against making it here:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'The toll can be priced exactly before you leave',
        body: 'The Croatian motorway network runs a closed toll system: you are registered at the entry plaza and pay at the exit, by distance and by vehicle category. HAC publishes the rate for every entry-and-exit pair in each of its five vehicle categories, which means the Zagreb–Split run — the one a coastal trip is built around — can be costed to the cent before you set off, in whichever category the rental company tells you the vehicle falls.',
        items: [
          {
            term: 'Hrvatske autoceste (HAC) — toll rates',
            detail: 'https://www.hac.hr/en/toll/toll-rates',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'No border check and no kuna since 2023',
        body: 'Croatia joined both the Schengen area and the euro area on 1 January 2023. For a cross-border camper trip that removes the two things that used to shape the itinerary — the queue at the Slovenian border in August, and carrying a second currency for tolls and campsite fees.',
        items: [
          {
            term: 'European Commission — Croatia and the euro',
            detail:
              'https://economy-finance.ec.europa.eu/euro/eu-countries-and-euro_en',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'The season is short and the coast books out',
        body: 'Croatian coastal sites are seasonal businesses and many simply close outside the summer months. We hold no opening dates — nothing on this site can tell you whether a given site is open in April — so this is a question for the operator, and an early one.',
        items: [
          {
            term: 'Croatian National Tourist Board',
            detail: 'https://croatia.hr/',
          },
        ],
      },
    ],
  },
  {
    code: 'si',
    name: 'Slovenia',
    angle:
      'Two entirely different toll systems meeting at 3.5 t, in a country you can cross in an afternoon — and the thinnest data we hold.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Slovenia is small enough to be a corridor between Austria, Italy, Croatia and Hungary, which is exactly how most camper trips use it. That makes its toll rule disproportionately important: the vehicle you were handed decides which of two unrelated systems you must be in before you join the motorway. This is also the country where we are most obliged to admit the limits of our own data.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'The honest version of our Slovenian coverage, stated as a measurement rather than as an apology:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'E-vignette up to 3.5 t, DarsGo above it',
        body: 'DARS describes the e-vignette as a way of paying tolls for motor vehicles with a maximum technically permissible mass of up to 3 500 kilograms. Above that the vignette is not available at all and the vehicle belongs in DarsGo, the distance-based system with its own on-board unit. There is no overlap and no grace period: a 3.6-tonne camper carrying a vignette is an untolled vehicle on the motorway.',
        items: [
          {
            term: 'DARS — e-vignette',
            detail: 'https://evinjeta.dars.si/',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'The winter season is a fixed window',
        body: 'Slovenia sets its winter period by calendar — 15 November to 15 March — and applies the same requirement outside it whenever winter conditions are present. For a vehicle up to 3 500 kg that means winter tyres on all four wheels, or summer tyres plus chains carried for the driven wheels, with at least 3 mm of tread. Heavier vehicles are asked for less, not more: winter tyres on the driven wheels. It is the 3.5-tonne line again, deciding a third thing.',
        items: [
          {
            term: 'Slovenian Police — winter equipment provisions',
            detail:
              'https://www.policija.si/eng/prevention/traffic-safety/winter-in-road-traffic-provisions-on-winter-equipment',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'Our Slovenian coverage is thin, and the site says so',
        body: 'Most Slovenian region pages on this site carry a noindex directive, because a hub listing one or two campsites adds nothing to the campsite’s own page. That is a deliberate rule rather than an accident, and it means Slovenia is a country where you should treat the map as a starting point rather than as an inventory.',
        items: [
          {
            term: 'Our own data — see the campsite pages for per-record sources',
            detail: '/camping/si',
          },
        ],
      },
    ],
  },
  {
    code: 'pt',
    name: 'Portugal',
    angle:
      'The member state that wrote motorhome overnight stays into its road code, and motorways with no toll booths at all.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Portugal is the one country on this list where where you sleep is a national legal question rather than a municipal one. A 2021 amendment to the road code addressed motorhomes directly, restricting overnight stays outside designated areas. The other thing to settle before you drive away is the tolls: parts of the network have no booths whatsoever, and a vehicle that is not registered for electronic payment simply accrues a debt.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'The shape of the Portuguese network, counted rather than asserted:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'Overnight stays are in the road code, by article number',
        body: 'Article 50.º-A of the Código da Estrada, in the form Law 66/2021 gave it, prohibits motorhomes staying overnight in Natura 2000 sites, in protected areas and in the zones covered by the coastal management plans, except where a place is expressly authorised. Everywhere else, where no municipal rule says otherwise, a type-approved motorhome may stay overnight for at most 48 hours in the same municipality. Because this is national law and not a by-law, the answer does not change at the next town sign — which is the opposite of how the question works in the Netherlands or Spain.',
        items: [
          {
            term: 'Lei n.º 66/2021 — Diário da República',
            detail:
              'https://diariodarepublica.pt/dr/detalhe/lei/66-2021-170083315',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'Some motorways cannot be paid at a booth',
        body: 'Several Portuguese motorways are electronic-only: there is nothing to stop at, the gantry reads the plate, and payment has to have been arranged in advance through a transponder or a registered card. A rental camper usually carries a device — confirm it at handover, and confirm how the charges reach you afterwards.',
        items: [
          {
            term: 'Infraestruturas de Portugal — tolls',
            detail: 'https://www.infraestruturasdeportugal.pt/',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'The network is built for vehicles more than for tents',
        body: 'Portugal has invested in serviced areas for motor caravans rather than in tent camping, which is visible in our own records and in what you will find on the ground. It is a good country to arrive in with a vehicle and a poor one to improvise in.',
        items: [
          {
            term: 'Turismo de Portugal',
            detail: 'https://www.turismodeportugal.pt/',
          },
        ],
      },
    ],
  },
  {
    code: 'se',
    name: 'Sweden',
    angle:
      'The right of public access that does not extend to your vehicle, and two cities that charge you by camera.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Sweden is the country most often invoked in conversations about free camping, and the one where the invocation is most often wrong. Allemansrätten — the right of public access — is a right to be on foot in the landscape. It is not a right to take a two-tonne vehicle into it, and driving off-road is separately prohibited by statute. The rest of the country is straightforward: no vignette, cameras in two cities, and a winter season with real teeth.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'Measured against the reputation, the Swedish records are a corrective:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'The right of public access is a right to walk',
        body: 'Allemansrätten covers access on foot, by bicycle, on horseback and by boat. It confers no right to drive or park off the road network, and driving on bare ground or on snow-covered terrain outside a road is prohibited by the off-road driving act. Parking a camper for the night is governed by the ordinary traffic rules and by the landowner, exactly as it would be anywhere else.',
        items: [
          {
            term: 'Naturvårdsverket (Swedish Environmental Protection Agency)',
            detail: 'https://www.naturvardsverket.se/',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'Stockholm and Gothenburg charge by camera',
        body: 'Both cities levy a congestion tax, read from the registration plate and billed to the registered keeper — which on a rental is the rental company, who will pass it on with their own fee. Foreign-registered vehicles have been liable since 2015, so a camper collected elsewhere in the Union is not exempt.',
        items: [
          {
            term: 'Transportstyrelsen (Swedish Transport Agency)',
            detail: 'https://www.transportstyrelsen.se/',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading:
          'Winter tyres from December to March — unless the camper is heavy',
        body: 'For a vehicle up to 3.5 tonnes, winter tyres or equivalent equipment are required from 1 December to 31 March whenever there are winter road conditions: snow, ice, slush or frost on any part of the road. Above 3.5 tonnes the rule is both longer and unconditional — 10 November to 10 April, whatever the weather is doing. That is the plated mass deciding your obligations for the fourth time on this site, and the judgement in the lighter case is the driver’s.',
        items: [
          {
            term: 'Transportstyrelsen — winter tyres',
            detail:
              'https://www.transportstyrelsen.se/en/road/Vehicles/winter-tyres/',
          },
        ],
      },
    ],
  },
  {
    code: 'dk',
    name: 'Denmark',
    angle:
      'Bridges priced by the length of your vehicle, a winter rule with no dates in it, and more informal places recorded than anywhere in the Union.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Denmark is cheap to drive across and expensive to cross. There is no vignette and no motorway toll, but the great bridges are tolled and they price by vehicle length — with a step at six metres that a great many motorhomes sit just the wrong side of. Its winter rule is the mirror image of the ones a day’s drive south: no dates, a condition instead, and the judgement left to the driver.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'The measurement behind that last paragraph, and the reason Denmark reads differently from its neighbours in our data:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'The bridges price by length, and six metres is the step',
        body: 'The published Great Belt tariff has one rate for a car of 3 to 6 metres and a noticeably higher one for a car over 6 metres, with height entering the categories above that. Six metres is therefore the number that decides the crossing, and length means the whole vehicle including whatever is bolted to the back of it. Measure before you book, not at the barrier.',
        items: [
          {
            term: 'Sund & Bælt — Great Belt prices',
            detail: 'https://www.storebaelt.dk/priser-rabatter/privat/',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading: 'No winter calendar — a condition instead',
        body: 'Denmark does not name dates for winter tyres. What the road traffic authority sets is a condition, in its own words: you can be fined for driving on tyres that are obviously unsuitable for the weather. That puts the judgement on the driver on the morning it snows rather than on a diary, and it is the opposite of the Slovenian and Austrian approach a day’s drive south. Rules here have been under review, so the authority’s own page is the one to read before travelling — and a rental agreement can require more than the law does.',
        items: [
          {
            term: 'Færdselsstyrelsen — guidance on tyres',
            detail:
              'https://www.fstyr.dk/privat/krav-til-koeretoejer/vejledning-om-daek',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'Our Danish records are unusually informal',
        body: 'A large share of what we hold for Denmark is not commercial campsites, and that is a real feature of the country rather than a gap in the import: Denmark maintains an extensive network of simple shelters and primitive sites. What a camper may use among them is a different question from what a walker may, and the operator is the authority on it.',
        items: [
          {
            term: 'Naturstyrelsen (Danish Nature Agency)',
            detail: 'https://naturstyrelsen.dk/',
          },
        ],
      },
    ],
  },
  {
    code: 'ie',
    name: 'Ireland',
    angle:
      'The one member state on this list where you drive on the left, and the highest proportion of vehicle-ready sites in the Union.',
    sections: [
      {
        sort: 0,
        slot: 'intro',
        heading: null,
        body: 'Ireland changes something a rental camper trip usually takes for granted: the side of the road. Ireland, Malta and Cyprus are the three member states that drive on the left, and in a camper the consequence is more than the seating position — it decides which side the habitation door opens on to. A left-hand-drive vehicle brought in from the continent puts its door into the traffic. The other thing to settle before leaving Dublin is the M50, which has no toll barriers to stop at.',
        items: [],
      },
      {
        sort: 1,
        slot: 'data-intro',
        heading: null,
        body: 'Ireland’s campsite network is built around vehicles to a degree no other member state matches:',
        items: [],
      },
      {
        sort: 2,
        slot: 'fact:0',
        heading: 'Driving on the left, and which side the door opens',
        body: 'Ireland is one of three EU member states that drive on the left. A camper built for the continent has its habitation door on the right-hand side, which in Ireland is the traffic side: stepping out of the van is the part of the trip to think about, more than the roundabouts. A vehicle rented in Ireland will be built the other way round.',
        items: [
          {
            term: 'Road Safety Authority (RSA)',
            detail: 'https://www.rsa.ie/',
          },
        ],
      },
      {
        sort: 3,
        slot: 'fact:1',
        heading:
          'The M50 has nothing to stop at, and a deadline the next evening',
        body: 'The toll on the M50 around Dublin is barrier-free: gantry cameras read the plate, there is no cash lane, and a driver without an account must pay by 8 p.m. on the day after the journey. Miss it and the charge escalates in steps, each one considerably larger than the toll itself. On a hired camper the bill reaches you through the rental company with their own fee attached, so how they handle it is a question for the handover desk rather than for afterwards.',
        items: [
          {
            term: 'Transport Infrastructure Ireland — M50 barrier-free tolling',
            detail:
              'https://www.tii.ie/en/roads-tolling/tolling-information/toll-locations-and-charges/m50-barrier-free-tolling/',
          },
        ],
      },
      {
        sort: 4,
        slot: 'fact:2',
        heading: 'There is no vignette and few other tolls',
        body: 'Apart from the M50 and a handful of tolled bridges, tunnels and motorway sections, Irish roads carry no charge and there is no pass to buy, so the road budget for a week here is essentially fuel. The expensive line is instead the one that gets the vehicle to the island at all: a ferry, priced by vehicle length, which is the number to settle before anything else. Transport Infrastructure Ireland publishes the tolled sections that do exist.',
        items: [
          {
            term: 'Transport Infrastructure Ireland (TII)',
            detail: 'https://www.tii.ie/',
          },
        ],
      },
    ],
  },
];

export class SeedRentalCountries1795800000000 implements MigrationInterface {
  name = 'SeedRentalCountries1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const c of COUNTRIES) {
      const seen: Array<{ count: string }> = await queryRunner.query(
        `SELECT count(*)::text AS count FROM pages WHERE slug = $1 AND type = 'rental-country'`,
        [c.code],
      );
      if (Number(seen[0]?.count ?? 0) > 0) continue;

      const page: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
         VALUES ($1, 'rental-country', 'published', now(), 0, false)
         RETURNING id`,
        [c.code],
      );
      const pageId = page[0].id;

      await queryRunner.query(
        `INSERT INTO page_translations
           (page_id, language_code, title, meta_title, meta_description)
         VALUES ($1, 'en', $2, $2, $3)`,
        [pageId, c.name, c.angle],
      );

      for (const s of c.sections) {
        const row: Array<{ id: string }> = await queryRunner.query(
          `INSERT INTO page_sections (page_id, sort, type, slot, visible)
           VALUES ($1, $2, 'prose', $3, true) RETURNING id`,
          [pageId, s.sort, s.slot],
        );
        await queryRunner.query(
          `INSERT INTO page_section_translations
             (section_id, language_code, heading, body, items)
           VALUES ($1, 'en', $2, $3, $4::jsonb)`,
          [row[0].id, s.heading, s.body, JSON.stringify(s.items)],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const codes = COUNTRIES.map((c) => c.code);
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = ANY($1) AND type = 'rental-country')`,
      [codes],
    );
    await queryRunner.query(
      `DELETE FROM pages WHERE slug = ANY($1) AND type = 'rental-country'`,
      [codes],
    );
  }
}
