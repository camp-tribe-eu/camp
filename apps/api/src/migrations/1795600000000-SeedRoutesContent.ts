import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Дванадцять маршрутів переїжджають із коду в CMS — CAMP-479, крок 2 із 2.
 *
 * 🔴 ЦЕЙ ФАЙЛ ЗГЕНЕРОВАНО, А НЕ НАБРАНО. Текст прочитано просто з
 * `apps/web/src/data/routes/*.ts` і серіалізовано машиною. Інакше
 * «перенесено дослівно» було б недоказовим: 7 813 слів передруку дають
 * розбіжність, якої не видно в рецензії, бо diff показує лише те, що
 * хтось додав, а не те, що він тихо переписав.
 *
 * 🔴 РОЗДІЛЕННЯ ЗА ПРИРОДОЮ ДАНИХ, А НЕ ЗА ЗРУЧНІСТЮ:
 *   • факти (слаг, країни, дні, місяці, координати, ночі) → `routes`
 *     і `route_points` — колонки з типами, які редактор не зламає
 *     одруківкою;
 *   • проза (назва, підсумок, вступ, сезон, дороги, «чому цей етап»)
 *     → `pages` + `page_translations` + `page_sections`, тобто туди ж,
 *     де вже живе решта тексту сайту й де працює переклад.
 *
 * 🔴 ЖОДНОЇ НОВОЇ КОЛЕКЦІЇ. Прод стоїть на 25 зареєстрованих при межі
 * 25 (заміряно 10.11.2026). `routes` і `route_points` уже існували й
 * були порожні; `pages` теж існує. Власні таблиці перекладів коштували
 * б двох слотів, яких немає.
 *
 * 🔴 ІДЕМПОТЕНТНО: маршрут, який уже є, пропускається. Міграція, що
 * подвоює контент при повторному прогоні, робить відкат неможливим.
 */

interface SeedSection {
  sort: number;
  type: string;
  heading: string | null;
  body: string;
  items?: Array<{ term: string; detail: string }> | null;
}

interface SeedRoute {
  slug: string;
  name: string;
  summary: string;
  region: string;
  countries: string[];
  days: number;
  months: number[];
  suits: string[];
  curatedAt: string;
  attribution: string;
  stages: Array<{ name: string; lat: number; lon: number; nights: number }>;
  sections: SeedSection[];
}

const ROUTES: SeedRoute[] = [
  {
    slug: 'france-atlantic-coast',
    region: 'Nouvelle-Aquitaine',
    name: 'The French Atlantic, La Rochelle to Biarritz',
    summary:
      'Ten days down one long beach, from a walled harbour town through the oyster islands to the Basque surf, with the biggest concentration of campsites in Europe on either side of you.',
    countries: ['fr'],
    days: 10,
    months: [5, 6, 7, 8, 9],
    suits: ['first-trip', 'families', 'surfers', 'van-conversion'],
    curatedAt: '2026-09-27',
    attribution:
      'The campsites beside each stage come from our own database, which on this coast is fed by both OpenStreetMap and DATAtourisme — France is the only country on these routes where a national tourism platform contributes records, and it is also why French sites here carry an official star classification when they have one.',
    stages: [
      {
        name: 'La Rochelle',
        lat: 46.1603,
        lon: -1.1511,
        nights: 1,
      },
      {
        name: 'Le Château-d’Oléron',
        lat: 45.8853,
        lon: -1.1972,
        nights: 2,
      },
      {
        name: 'Royan',
        lat: 45.6285,
        lon: -1.0281,
        nights: 1,
      },
      {
        name: 'Arcachon',
        lat: 44.658,
        lon: -1.168,
        nights: 2,
      },
      {
        name: 'Mimizan',
        lat: 44.2011,
        lon: -1.2294,
        nights: 1,
      },
      {
        name: 'Soorts-Hossegor',
        lat: 43.6639,
        lon: -1.4283,
        nights: 1,
      },
      {
        name: 'Biarritz',
        lat: 43.4832,
        lon: -1.5586,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'This is the easiest drive in this library and the hardest one to get a pitch on. The road south from La Rochelle barely climbs, the sea is on your right for nine days, and the campsites are so thick on the ground that our database holds 223 within 25 km of La Rochelle alone and 300 around the Île d’Oléron — more than some of the other routes here have in an entire country.\n\nThat density is the point and also the trap. Abundance in the data is not availability in August: the coastal sites are the ones every French family books in February, and a plan that assumes you will find something at six in the evening is a plan to sleep in an inland car park. The routes here do not book anything for you, and we do not know what any of these sites charge or whether they have a space — what we can tell you is where they are, which ones are municipal, and which are the bare aires de camping-car that exist precisely for the night you got it wrong.\n\nThe landscape changes less than the map suggests and more than you expect. North of the Gironde it is flat oyster country, low and tidal and mostly about water. South of Arcachon you enter the Landes — not a natural forest but a planted one, maritime pine sown from the middle of the nineteenth century to fix shifting dunes and drain the marsh behind them, and it runs almost unbroken for 200 kilometres. Then the ground finally tilts, the Pyrenees appear in the windscreen, and the last two stages are Basque rather than French in a way you can hear in the place names.\n\nTake bicycles. The Vélodyssée cycle route shadows this entire coast on its own tarmac, and from most of these stages the beach is a flat twenty-minute ride away — which matters, because parking a motorhome at a French Atlantic beach in August is its own small war.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'The coast works from May to September, but July and August are a different trip: this is where a large share of France goes on holiday at once, and the seaside municipal sites fill weeks ahead. May, June and the first half of September are the same beaches with somewhere to park.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Flat, straight and easy, with one real constraint: the coastal access roads through the dunes are narrow, one-way in places, and lined with height barriers at the beach car parks. Nothing here needs mountain driving; everything here needs a plan for where the van sleeps.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'La Rochelle',
        body: 'Start in the one town on this coast that was a city before it was a resort — a walled Atlantic port whose harbour mouth is still guarded by two medieval towers, and the only stage where the evening is about stone rather than sand.',
        items: [
          {
            term: 'Tour Saint-Nicolas and Tour de la Chaîne',
            detail:
              'The pair of fourteenth-century towers that a chain was once slung between to close the old harbour at night',
          },
          {
            term: 'Vieux-Port',
            detail:
              'The old harbour, which is still the centre of the town rather than a preserved quarter beside it',
          },
          {
            term: 'Île de Ré',
            detail:
              'A low, white-shuttered island reached by a long toll bridge, flat enough to be cycled end to end',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Le Château-d’Oléron',
        body: 'Two nights because Oléron is a place to stop moving: a big, low island reached by a free bridge, where the interesting part is the tidal oyster country on the eastern shore rather than the surf beaches everyone drives to on the west.',
        items: [
          {
            term: 'Cabanes colorées du Château-d’Oléron',
            detail:
              'The painted oyster huts along the channel, now mostly workshops, still next to working beds',
          },
          {
            term: 'Citadelle du Château-d’Oléron',
            detail:
              'A seventeenth-century coastal fort with ramparts you can walk',
          },
          {
            term: 'Marais aux oiseaux',
            detail:
              'Reclaimed salt marsh in the middle of the island, and the reason the birdlife here is worth the detour inland',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Royan',
        body: 'A town worth one night for an unusual reason: it was destroyed by bombing in January 1945 and rebuilt in the 1950s, so it is a rare chance to see a whole French seaside resort designed in one go, in concrete, by people who believed in it.',
        items: [
          {
            term: 'Église Notre-Dame de Royan',
            detail:
              'A reinforced-concrete church completed in 1958 to Guillaume Gillet’s design — the building the reconstruction is remembered for',
          },
          {
            term: 'Le Front de Mer',
            detail:
              'The seafront terrace, rebuilt as a single 1950s composition rather than a row of older villas',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Arcachon',
        body: 'The one stage where the coast does something dramatic: a shallow tidal basin full of oyster frames on one side, and on the other the Dune du Pilat, a wall of sand high enough to climb and slowly moving inland over the pine forest behind it.',
        items: [
          {
            term: 'Dune du Pilat',
            detail:
              'The largest sand dune in Europe, walkable from the car park below, migrating landward year by year',
          },
          {
            term: 'Bassin d’Arcachon',
            detail:
              'A near-enclosed tidal basin — at low water most of it is not sea at all',
          },
          {
            term: 'Ville d’Hiver',
            detail:
              'The nineteenth-century “winter town” of villas built up the hill behind Arcachon for people sent here to breathe the pine air',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Mimizan',
        body: 'One night deep in the Landes pine, because this is the stretch that explains the region: 200 kilometres of planted forest, ruler-straight firebreak tracks, and a beach at the end of a road through the trees.',
        items: [
          {
            term: 'Courant de Mimizan',
            detail:
              'The slow channel that drains the inland lakes to the sea — canoe country rather than swimming country',
          },
          {
            term: 'Forêt des Landes',
            detail:
              'The planted maritime-pine forest begun in the nineteenth century to stabilise the dunes and drain the marsh',
          },
        ],
      },
      {
        sort: 8,
        type: 'prose',
        heading: 'Soorts-Hossegor',
        body: 'The surf stage, and honestly so: the beach breaks here are heavy, shifting sandbanks that have hosted world-tour events, which is another way of saying this is not the beach to teach a child to swim at.',
        items: [
          {
            term: 'Lac d’Hossegor',
            detail:
              'A saltwater lake that fills and empties with the tide — the safe swimming the ocean beaches here are not',
          },
          {
            term: 'La Gravière',
            detail: 'The sandbank break the town is known for among surfers',
          },
        ],
      },
      {
        sort: 9,
        type: 'prose',
        heading: 'Biarritz',
        body: 'Finish where the coast finally has cliffs and the Pyrenees show up behind them — a resort with an imperial past, a rocky shoreline, and the beach where European surfing effectively started in the 1950s.',
        items: [
          {
            term: 'Rocher de la Vierge',
            detail:
              'A sea rock joined to the headland by a footbridge, out in the swell',
          },
          {
            term: 'Côte des Basques',
            detail:
              'The long beach under the cliff where surfing in Europe took hold',
          },
          {
            term: 'Grande Plage',
            detail: 'The town beach, below the promenade and the old casino',
          },
        ],
      },
    ],
  },
  {
    slug: 'tuscany-hill-towns',
    region: 'Toscana',
    name: 'Tuscany by Hill Town, Lucca to Volterra',
    summary:
      'Eight days of walled towns on hilltops, driven as a short loop rather than a dash, with the structural catch nobody mentions: the campsites are in the valleys and the towns are not.',
    countries: ['it'],
    days: 8,
    months: [4, 5, 6, 9, 10],
    suits: ['history', 'slow', 'first-trip', 'van-conversion'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites beside each stage come from OpenStreetMap, re-imported weekly. Italy is entirely OpenStreetMap in our database — there is no national tourism feed here of the kind France has — so what you see is what volunteers have recorded, and the gaps are real gaps rather than sites we filtered out.',
    stages: [
      {
        name: 'Lucca',
        lat: 43.843,
        lon: 10.5017,
        nights: 1,
      },
      {
        name: 'Firenze',
        lat: 43.7696,
        lon: 11.2558,
        nights: 2,
      },
      {
        name: 'Siena',
        lat: 43.3186,
        lon: 11.3306,
        nights: 1,
      },
      {
        name: 'Pienza',
        lat: 43.0775,
        lon: 11.6789,
        nights: 2,
      },
      {
        name: 'Volterra',
        lat: 43.4021,
        lon: 10.8608,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'Every Tuscany itinerary is a list of hill towns. What none of them tell you is the thing that shapes every single day of this trip: the towns are on hills because they were built to be defended, and the campsites are in the valleys because that is where there is flat ground, water and a road. So the pattern of this route is not drive-park-explore. It is drive, park low, and climb — on foot, by bus, or on the escalators and funiculars that several of these towns have installed precisely because everyone has this problem.\n\nThat is not a complaint, it is the plan. Accepting it means you can stop somewhere for two nights and walk up in the cool of the morning instead of circling a medieval gate at noon looking for a space that does not exist. It also means the stages here are short. Lucca to Florence is not a driving day, so the day is not spent driving.\n\nThe route deliberately begins and ends away from Florence. Florence is on it — skipping it would be perverse — but it is one night in the middle, treated as the city it is, and the route is built around the smaller places on either side, which is where the hill-town landscape actually is. Siena and Pienza are the Tuscany of the photographs. Volterra is older than either of them and gets far fewer visitors, and it is where this route finishes on purpose.\n\nOur database holds between 24 and 42 campsites within 25 km of each of these stages, which is enough choice to matter and few enough that the good ones are known. Pienza has a campsite 155 metres from the coordinate we use for the town — the closest stage-to-campsite distance on any route in this library.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'April to June and September to October. July and August are not merely busy here, they are hot in a way that changes the shape of the day — inland Tuscany regularly sits in the mid-thirties, the hill towns have no shade in their squares, and a van without air conditioning is unusable from noon until five.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Narrow, winding, walled and frequently one-way in the old centres, with signed ZTL restricted-traffic zones that a foreign plate will still be fined for entering. The valley roads between towns are easy. The last kilometre into any of these towns is the part to leave the van out of.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Lucca',
        body: 'Start with the exception to the whole route: a walled town on flat ground, where the Renaissance ramparts were never demolished and are now a tree-lined park you can cycle the entire circuit of, about four kilometres around.',
        items: [
          {
            term: 'Mura di Lucca',
            detail:
              'The intact sixteenth-century walls, now a raised circular promenade and cycle path',
          },
          {
            term: 'Piazza dell’Anfiteatro',
            detail:
              'An oval square whose shape is the Roman amphitheatre the houses were built into',
          },
          {
            term: 'Torre Guinigi',
            detail:
              'A medieval tower with mature oak trees growing on its roof',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Firenze',
        body: 'Two nights and no pretence that it is a hill town: park once on the edge, take the bus in twice, and treat it as the one city stop where the reason to be here is indoors and needs booking.',
        items: [
          {
            term: 'Piazzale Michelangelo',
            detail:
              'The terrace above the south bank, and the one view that makes the city’s layout legible',
          },
          {
            term: 'Ponte Vecchio',
            detail:
              'The shop-lined bridge that survived the destruction of every other bridge in the city in 1944',
          },
          {
            term: 'Cattedrale di Santa Maria del Fiore',
            detail:
              'Brunelleschi’s dome, built without the centring that everyone at the time thought it needed',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Siena',
        body: 'The town that lost: Siena was Florence’s rival until plague and defeat froze it, which is exactly why its medieval centre survived so completely and why the shell-shaped square at its heart is unlike anything else in Italy.',
        items: [
          {
            term: 'Piazza del Campo',
            detail:
              'The sloping shell-shaped square, and the racecourse for the Palio',
          },
          {
            term: 'Duomo di Siena',
            detail:
              'A striped marble cathedral with a floor of inlaid pictorial panels, uncovered only part of the year',
          },
          {
            term: 'Torre del Mangia',
            detail:
              'The tower on the Campo, climbable by a long internal stair',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Pienza',
        body: 'Two nights in the Val d’Orcia, because this is the landscape people actually come to Tuscany for, and because Pienza itself is a curiosity: a village rebuilt in the 1460s as a single planned Renaissance design by a pope who had been born there.',
        items: [
          {
            term: 'Val d’Orcia',
            detail:
              'The cypress-lined ridge country south of Siena, listed by UNESCO as a designed agricultural landscape',
          },
          {
            term: 'Piazza Pio II',
            detail:
              'The small square that is the whole point of the fifteenth-century rebuilding — four buildings meant to be seen together',
          },
          {
            term: 'Bagno Vignoni',
            detail:
              'A village whose central square is a stone pool of thermal water instead of a piazza',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Volterra',
        body: 'Finish somewhere much older and much quieter: an Etruscan town on a high ridge, with walls and a gate that predate the Romans, and a hillside on one flank that is actively eroding and has been taking the edge of the town with it for centuries.',
        items: [
          {
            term: 'Porta all’Arco',
            detail:
              'An Etruscan gate still standing in the later medieval wall',
          },
          {
            term: 'Teatro Romano',
            detail:
              'A first-century BC Roman theatre, best seen from the walls above it',
          },
          {
            term: 'Le Balze',
            detail:
              'The crumbling clay cliffs on the western edge, which have swallowed buildings',
          },
        ],
      },
    ],
  },
  {
    slug: 'dalmatian-coast-and-islands',
    region: 'Dalmatia',
    name: 'Dalmatia, Zadar to Dubrovnik',
    summary:
      'Nine days down the Adriatic with one structural difference from every other coastal route here: the ferry timetable, not the road, decides what each day looks like.',
    countries: ['hr'],
    days: 9,
    months: [5, 6, 9, 10],
    suits: ['wild-swimming', 'families', 'slow', 'history'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Croatian coastal camping is unusually well mapped by volunteers, which is why the counts here are high — but a site being in the data says nothing about whether it is open in October, and many on this coast are not.',
    stages: [
      {
        name: 'Zadar',
        lat: 44.1194,
        lon: 15.2314,
        nights: 1,
      },
      {
        name: 'Šibenik',
        lat: 43.735,
        lon: 15.8952,
        nights: 1,
      },
      {
        name: 'Split',
        lat: 43.5081,
        lon: 16.4402,
        nights: 2,
      },
      {
        name: 'Hvar',
        lat: 43.1729,
        lon: 16.4422,
        nights: 1,
      },
      {
        name: 'Makarska',
        lat: 43.2969,
        lon: 17.0178,
        nights: 1,
      },
      {
        name: 'Dubrovnik',
        lat: 42.6507,
        lon: 18.0944,
        nights: 2,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'The Dalmatian coast is 500 kilometres of one road, the Jadranska magistrala, and the temptation is to treat it as a drive. It is not. Everything interesting about this coast is that it is broken into islands, and the moment an island is in your plan the planning unit stops being kilometres and becomes sailings. A vehicle ferry that runs six times a day in August runs twice in October, and the space for a motorhome on it is a different and smaller allocation than the space for a car.\n\nSo this route is built around that constraint rather than pretending it away. It has one island stage, not four, and it is placed in the middle where a missed sailing costs you an afternoon rather than the end of the trip. The rest is mainland, where the coast road is genuinely spectacular and genuinely slow — it is two lanes, it hugs the water, and behind it the Dinaric mountains come down almost to the sea, so there is nowhere for a faster road to go.\n\nThe campsite picture here is unusually good. Our database holds 102 sites within 25 km of Zadar and 61 around Šibenik, and a large share of Croatian coastal camping is small, family-run and right on the water — the country has a long tradition of it. It thins as you go south: 17 within 25 km of Dubrovnik, which is a real constraint on the last stage rather than a gap in our data.\n\nOne honest warning about the end. Dubrovnik is the most visited place on this coast and the least suited to arriving in a vehicle; the old town is walled, closed to traffic, and served by car parks that were not designed for this. Treat the last stage as somewhere you park and take a bus from, and it works.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'May, June, September and October. This is a shoulder-season route by design: in July and August the coast road is a queue, the island ferries sell out for vehicles, and the campsites on the seafront are full — while in late September the sea is still warm enough to swim in and the same sites are half empty.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'A two-lane coast road with sea on one side and rock on the other, slow, exposed to the bura wind in autumn, and busy with the same traffic you are in. The island roads are narrower again. Nothing is technically hard; everything takes longer than the map suggests.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Zadar',
        body: 'Begin on a peninsula with a Roman forum lying in the open, and the one seafront in Europe that is worth being at specifically for the sound: the Sea Organ turns swell into notes through pipes under the marble steps.',
        items: [
          {
            term: 'Morske orgulje (Sea Organ)',
            detail: 'Pipes set under the waterfront steps, played by the waves',
          },
          {
            term: 'Crkva sv. Donata',
            detail:
              'A ninth-century round church standing on the stones of the Roman forum',
          },
          {
            term: 'Nacionalni park Kornati',
            detail:
              'An archipelago of bare limestone islands, reached by boat from the coast here',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Šibenik',
        body: 'A stop for the river rather than the sea: Šibenik sits where the Krka comes out through a gorge, and it is the base for the waterfalls upstream — a genuinely different landscape twenty minutes inland.',
        items: [
          {
            term: 'Katedrala sv. Jakova',
            detail:
              'A cathedral built entirely of stone, without brick or timber, with a frieze of seventy-odd carved heads',
          },
          {
            term: 'Nacionalni park Krka',
            detail: 'The travertine falls upstream on the Krka river',
          },
          {
            term: 'Tvrđava sv. Mihovila',
            detail: 'The fortress above the old town, over the channel',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Split',
        body: 'Two nights, because Split is not a city with a Roman ruin in it — the old town is inside Diocletian’s palace, with flats and bars built into the fourth-century walls, and it also happens to be the ferry port for the island stage that follows.',
        items: [
          {
            term: 'Dioklecijanova palača',
            detail:
              'A late-Roman imperial palace that the medieval town grew inside and never left',
          },
          {
            term: 'Marjan',
            detail:
              'The pine-covered hill on the end of the peninsula, walkable from the centre',
          },
          {
            term: 'Riva',
            detail: 'The waterfront promenade along the palace’s sea wall',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Hvar',
        body: 'The island night, and the reason to check the sailing before anything else: Hvar is long, low and lavender-scented, and the town is a Venetian harbour with a fortress above it that you climb for the view of the Pakleni islands.',
        items: [
          {
            term: 'Tvrđava Fortica',
            detail: 'The fortress on the hill above Hvar town',
          },
          {
            term: 'Pakleni otoci',
            detail:
              'The scatter of wooded islets across the bay, a short boat hop from the harbour',
          },
          {
            term: 'Stari Grad Plain',
            detail:
              'A Greek agricultural landscape from the fourth century BC, with the original field divisions still in use',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Makarska',
        body: 'Back on the mainland under the Biokovo ridge, which rises to well over 1 500 metres directly behind the beach — the most abrupt sea-to-mountain transition anywhere on this route.',
        items: [
          {
            term: 'Park prirode Biokovo',
            detail:
              'The limestone ridge behind the town, with a road up it that is not for large vehicles',
          },
          {
            term: 'Makarska riviera',
            detail:
              'The run of shingle beaches under the pines between Brela and Gradac',
          },
        ],
      },
      {
        sort: 8,
        type: 'prose',
        heading: 'Dubrovnik',
        body: 'Finish with two nights so that one of them can be early morning inside the walls, which is the only time the walled town is a place rather than a queue; park outside and come in by bus or boat.',
        items: [
          {
            term: 'Gradske zidine',
            detail:
              'The complete circuit of city walls, walkable, about two kilometres round',
          },
          {
            term: 'Lokrum',
            detail:
              'The wooded island ten minutes offshore, with no accommodation on it at all',
          },
          {
            term: 'Srđ',
            detail:
              'The hill behind the city, reached by cable car or a switchback path',
          },
        ],
      },
    ],
  },
  {
    slug: 'danube-vienna-to-budapest',
    region: 'The Danube valley',
    name: 'Down the Danube, Vienna to Budapest',
    summary:
      'A short, flat, three-country week between two imperial capitals, designed around the fact that the best way to travel this valley is not actually by road.',
    countries: ['at', 'sk', 'hu'],
    days: 7,
    months: [4, 5, 6, 7, 8, 9, 10],
    suits: ['cyclists', 'families', 'history', 'first-trip'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Austria, Slovakia and Hungary are all OpenStreetMap-only in our database, so the record for a municipal riverside site is whatever a volunteer last wrote down.',
    stages: [
      {
        name: 'Wien',
        lat: 48.2082,
        lon: 16.3738,
        nights: 1,
      },
      {
        name: 'Bratislava',
        lat: 48.1486,
        lon: 17.1077,
        nights: 1,
      },
      {
        name: 'Győr',
        lat: 47.6875,
        lon: 17.6504,
        nights: 1,
      },
      {
        name: 'Esztergom',
        lat: 47.7855,
        lon: 18.7405,
        nights: 1,
      },
      {
        name: 'Szentendre',
        lat: 47.6695,
        lon: 19.0755,
        nights: 1,
      },
      {
        name: 'Budapest',
        lat: 47.4979,
        lon: 19.0402,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'This is the only route in the library where the van is the support vehicle rather than the point. The EuroVelo 6 cycle path runs the whole length of this valley on dedicated, almost entirely flat tarmac, separated from traffic for most of it, and it is one of the busiest long-distance cycle routes in Europe for good reason. The sensible way to do this week is to drive a short hop each morning, park, and ride.\n\nWhich means the stages here are close together on purpose. This is the shortest route in this library by distance and it has as many stages as routes twice its length — that is not padding, it is the design. Every stage is a place to leave the vehicle for a day, and the interesting ground between them is covered on two wheels rather than four.\n\nThree countries in seven days, and unusually for Europe they are genuinely different from one another on the same river. Vienna is monumental and orderly. Bratislava is forty minutes downstream, was a Hungarian coronation city for centuries, spent fifty years behind the Iron Curtain, and has an old town the size of a large village under a castle on a rock. Hungary begins in flat farmland and ends with the river turning sharply south through wooded hills at the Danube Bend, which is the prettiest stretch of the whole week and the one most people miss because it is not on the motorway.\n\nCampsite provision is solid and well distributed — between 19 and 54 sites within 25 km of each stage in our records, with the highest count around Szentendre because it is effectively Budapest’s weekend hinterland. This is also the one route here where you will find genuinely good municipal riverside sites, a central European habit that the Atlantic coast has largely lost.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'April to October, and it is the longest usable season of any route in this library because nothing here depends on a pass being open or a sea being warm. High summer is fine — this is a river valley, not a Mediterranean coast — and the two best months are probably May, when the meadows are up, and late September, when the light along the Danube Bend is at its best.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Flat, easy and unremarkable — this is the least demanding driving in the library. Two things to know: Austria, Slovakia and Hungary each require their own motorway vignette or e-toll, bought separately, and the old centres of Bratislava, Szentendre and Budapest are tight, cobbled and not places to take a long vehicle.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Wien',
        body: 'Start at the imperial end of the river, where the Danube has been engineered into straight channels and an artificial island, and where a single night is enough because the city deserves a separate trip rather than a rushed one.',
        items: [
          {
            term: 'Donauinsel',
            detail:
              'A 21-kilometre artificial island built as flood defence and now the city’s swimming and cycling strip',
          },
          {
            term: 'Schloss Schönbrunn',
            detail:
              'The Habsburg summer palace and its gardens on the western edge of the city',
          },
          {
            term: 'Nationalpark Donau-Auen',
            detail:
              'The floodplain forest downstream — one of the last largely unregulated stretches of the river in central Europe',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Bratislava',
        body: 'Barely an hour downstream and an entirely different country: a compact baroque old town under a square white castle, and the only capital in the world that borders two other states.',
        items: [
          {
            term: 'Bratislavský hrad',
            detail: 'The rebuilt castle on the rock above the river',
          },
          {
            term: 'Devín',
            detail:
              'A ruined fortress where the Morava meets the Danube, on what was the Iron Curtain frontier',
          },
          {
            term: 'Modrý kostolík',
            detail:
              'A small, entirely blue Art Nouveau church east of the old town',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Győr',
        body: 'The first Hungarian stop, at the meeting of three rivers, with a baroque old town that almost no foreign visitor stops for and that is all the better for it.',
        items: [
          {
            term: 'Káptalandomb',
            detail:
              'The cathedral hill above the confluence, the oldest part of the town',
          },
          {
            term: 'Pannonhalmi Főapátság',
            detail:
              'A Benedictine abbey founded in 996 on a hill south of the town, still a working monastery and school',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Esztergom',
        body: 'Hungary’s ecclesiastical capital and the start of the Danube Bend, with the largest church in the country on a hill above the river and a bridge across to Slovakia that was left broken from 1944 until 2001.',
        items: [
          {
            term: 'Esztergomi bazilika',
            detail: 'The country’s largest church, on the hill above the river',
          },
          {
            term: 'Mária Valéria híd',
            detail:
              'The bridge to Štúrovo in Slovakia, destroyed in the war and only rebuilt in 2001',
          },
          {
            term: 'Dunakanyar',
            detail:
              'The Danube Bend, where the river turns sharply south between wooded hills',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Szentendre',
        body: 'A small riverside town of Serbian orthodox churches and steep lanes, close enough to Budapest to be its weekend escape, which makes it the right place to sleep before the city rather than in it.',
        items: [
          {
            term: 'Szabadtéri Néprajzi Múzeum',
            detail:
              'An open-air museum of rebuilt village buildings from across Hungary',
          },
          {
            term: 'Belgrád székesegyház',
            detail:
              'The Serbian Orthodox cathedral, from the community that settled here in the seventeenth century',
          },
          {
            term: 'Visegrád',
            detail:
              'A hilltop citadel upstream, over the sharpest point of the Bend',
          },
        ],
      },
      {
        sort: 8,
        type: 'prose',
        heading: 'Budapest',
        body: 'Finish in the one European capital whose defining feature is that it is two cities on opposite banks — hilly Buda and flat Pest — and where the correct end to a week on the river is a thermal bath.',
        items: [
          {
            term: 'Széchenyi fürdő',
            detail:
              'A large outdoor thermal bath complex, open year round and hot enough to sit in in winter',
          },
          {
            term: 'Budai Várnegyed',
            detail: 'The castle quarter on the Buda hill, above the river',
          },
          {
            term: 'Országház',
            detail:
              'The parliament building on the Pest bank, best seen from the opposite side',
          },
        ],
      },
    ],
  },
  {
    slug: 'dolomites-and-tyrol',
    region: 'Tirol, Südtirol and Belluno',
    name: 'The Alps Without Switzerland: Tyrol and the Dolomites',
    summary:
      'A seven-day mountain week through Austrian Tyrol and the Italian Dolomites, planned around the one thing that actually governs alpine travel: which passes are open and how high you are sleeping.',
    countries: ['at', 'it'],
    days: 7,
    months: [6, 7, 8, 9],
    suits: ['hikers', 'large-motorhome', 'wild-swimming', 'slow'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Alpine campsites are seasonal in a way our data does not record: we can tell you a site exists and where it is, and we cannot tell you whether it opens before June.',
    stages: [
      {
        name: 'Innsbruck',
        lat: 47.2692,
        lon: 11.4041,
        nights: 1,
      },
      {
        name: 'Brixen / Bressanone',
        lat: 46.7154,
        lon: 11.6567,
        nights: 1,
      },
      {
        name: 'Cortina d’Ampezzo',
        lat: 46.5405,
        lon: 12.1357,
        nights: 2,
      },
      {
        name: 'Canazei',
        lat: 46.4769,
        lon: 11.77,
        nights: 1,
      },
      {
        name: 'Lienz',
        lat: 46.8295,
        lon: 12.7687,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'The card that started this library asked for an Alps route. It is worth being precise about what that can mean for us: our database covers the EU-27, and Switzerland is not in it. There is not one Swiss campsite in our records — not because Switzerland has none, but because it is outside the scope the project decided on. So this is the Alps as the European Union holds them, which is Austria, the Italian Dolomites, and the German and Slovenian edges. It is not a lesser version. The Dolomites are limestone rather than granite, they are vertical in a way the western Alps are not, and they are the part of the range a first visit should see anyway.\n\nAltitude is the organising fact of this week. It decides the temperature you sleep at — a valley campsite at 600 metres and a pass at 2 200 metres are different climates on the same afternoon — and it decides where a large vehicle can and cannot go. Several of the roads connecting these stages are engineered hairpin passes with length restrictions, and a long motorhome with a trailer is genuinely excluded from some of them rather than merely uncomfortable.\n\nThe route crosses a language border in the middle of it, twice, without crossing much of a cultural one. South Tyrol is Italian territory where German is the first language of most of the population, so Bressanone is also Brixen and the menu changes before the country does. The stages are ordered so that the crossing happens on a main valley road rather than a pass, which matters if the weather turns.\n\nCampsite density is good and evenly spread: between 23 and 45 sites within 25 km of every stage in our data. What varies is altitude, and the route notes it where it matters, because a site at 1 400 metres in mid-September is a genuinely cold night in a van without heating.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'June to September, and the boundaries are hard rather than soft. The high passes this route uses carry snow gates and several do not open until late May or early June; by mid-October they begin to close again. A week planned for May here is a week of valley roads and closed signs.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Engineered mountain roads — wide, well surfaced, and relentlessly steep and twisting, with hairpins signed for vehicle length on several passes. Descending is the part that punishes a heavy vehicle: use the gears, not the brakes. Check pass status the morning you drive it, not the week before.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Innsbruck',
        body: 'Start in the valley city that the whole range funnels through — a compact old town with a mountain wall directly behind it, and a funicular from the centre that puts you above 2 000 metres inside half an hour.',
        items: [
          {
            term: 'Goldenes Dachl',
            detail:
              'A late-Gothic balcony roofed with thousands of gilded copper tiles',
          },
          {
            term: 'Nordkettenbahnen',
            detail:
              'The cable railway from the city centre up onto the Nordkette ridge',
          },
          {
            term: 'Bergisel',
            detail:
              'The ski jump above the city, rebuilt by Zaha Hadid, open outside competitions',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Brixen / Bressanone',
        body: 'Cross into Italy without noticing it: an old episcopal town in the Eisack valley where the architecture is Tyrolean, the street signs are bilingual, and the surrounding orchards are the first sign you are on the southern side of the range.',
        items: [
          {
            term: 'Dom von Brixen',
            detail:
              'The cathedral, with a Romanesque cloister painted in the fourteenth and fifteenth centuries',
          },
          {
            term: 'Plose',
            detail:
              'The mountain above the town, with a cable car and high meadow walking',
          },
          {
            term: 'Kloster Neustift',
            detail:
              'A twelfth-century Augustinian abbey just north of the town, still working, with vineyards',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Cortina d’Ampezzo',
        body: 'Two nights in the middle of the limestone, because this is the base for the Dolomites proper and because the drive in over the passes is long enough that arriving and leaving on the same day wastes it.',
        items: [
          {
            term: 'Tre Cime di Lavaredo',
            detail:
              'Three near-vertical limestone towers with a circuit path around their base',
          },
          {
            term: 'Lago di Misurina',
            detail:
              'A lake below the Sorapiss massif, on the road towards the Tre Cime',
          },
          {
            term: 'Cinque Torri',
            detail:
              'A cluster of rock towers with preserved First World War positions among them',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Canazei',
        body: 'The highest stage on the route, at the head of the Val di Fassa and the junction of four famous passes — which is exactly why it is a single night: it is a place to be positioned, not a place to settle.',
        items: [
          {
            term: 'Passo Pordoi',
            detail:
              'The pass east of the village, with a cable car to the Sass Pordoi plateau above it',
          },
          {
            term: 'Marmolada',
            detail:
              'The highest peak in the Dolomites, and the one whose glacier is visibly and rapidly retreating',
          },
          {
            term: 'Passo Sella',
            detail:
              'The pass under the Sassolungo, with high walking straight from the road',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Lienz',
        body: 'Come down and finish back in Austria where the Drau valley opens out — a warmer, lower, gentler end to the week, with a Roman town under the fields outside it.',
        items: [
          {
            term: 'Aguntum',
            detail: 'The excavated Roman municipium just east of the town',
          },
          {
            term: 'Schloss Bruck',
            detail: 'The medieval castle above Lienz, now the town museum',
          },
          {
            term: 'Nationalpark Hohe Tauern',
            detail: 'The national park north of here, the largest in the Alps',
          },
        ],
      },
    ],
  },
  {
    slug: 'portuguese-atlantic',
    region: 'Portugal',
    name: 'The Portuguese Atlantic, Porto to Sagres',
    summary:
      'Nine days down the whole Atlantic face of Portugal, on the route where the rules about where you may sleep changed recently and are the first thing you need to know.',
    countries: ['pt'],
    days: 9,
    months: [4, 5, 6, 9, 10],
    suits: ['surfers', 'van-conversion', 'off-season', 'wild-swimming'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Our data records where a site is and, where somebody has tagged it, what facilities it has — it does not record whether a place is an authorised overnight location under Portuguese law, and on this route that is a distinction you have to check yourself.',
    stages: [
      {
        name: 'Porto',
        lat: 41.1579,
        lon: -8.6291,
        nights: 2,
      },
      {
        name: 'Aveiro',
        lat: 40.6405,
        lon: -8.6538,
        nights: 1,
      },
      {
        name: 'Nazaré',
        lat: 39.6015,
        lon: -9.0705,
        nights: 1,
      },
      {
        name: 'Peniche',
        lat: 39.3558,
        lon: -9.3811,
        nights: 1,
      },
      {
        name: 'Vila Nova de Milfontes',
        lat: 37.7253,
        lon: -8.783,
        nights: 2,
      },
      {
        name: 'Sagres',
        lat: 37.0083,
        lon: -8.945,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'Portugal had a reputation, for about a decade, as the place in Europe where you could park a van anywhere near the sea and nobody would mind. That reputation is out of date and it is worth saying so at the top of the page, because acting on it is now how people get fined. The law was tightened in 2021 to prohibit overnighting in vehicles outside authorised places, with the protected coastal stretches enforced hardest — which, inconveniently, is exactly the coast this route follows.\n\nThe practical answer is that Portugal also built the solution: a dense network of small paid aires and private sites specifically for motorhomes, many of them a few hundred metres from the beaches people used to park on. Our database holds between 12 and 33 campsites within 25 km of every stage on this route. The change is not that there is nowhere to sleep. It is that "anywhere" became "somewhere", and you now need to know which.\n\nThe coast itself is one of the most consistent in Europe and consistently underrated by people who only know the Algarve. It is a nearly unbroken line of cliff, dune and long beach facing an ocean with nothing between it and America, which means swell all year and wind most afternoons. The surf culture is real and it runs the entire length: Peniche and Nazaré are known internationally, but there is a beach break in front of almost every stage here.\n\nThe route runs north to south for a reason that matters day to day: the prevailing wind on this coast is northerly, and driving into it for nine days is a noticeably worse trip than having it behind you. It also means the landscape gets progressively drier and emptier as you go, ending on the headland at the southwest corner of Europe, which is the correct place to stop.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'April to June and September to October. The Portuguese Atlantic is cold water and steady wind all year, so this is not a route that gets better in August — it gets busier, and the coastal sites fill with Portuguese holidaymakers. The shoulder months have the same sea, the same light and far more room.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Fast toll motorways inland and slow, pleasant national roads along the coast — the coastal ones are the point. Portuguese motorway tolling is partly electronic-only with no booths, which catches out foreign vehicles; sort the transponder or the pre-registration before you need it, not at the first gantry.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Porto',
        body: 'Two nights to begin, in a granite city stacked up the side of a gorge, where the working river frontage and the port lodges on the far bank are both still doing the job they were built for.',
        items: [
          {
            term: 'Ribeira',
            detail: 'The old riverfront under the cliff, below the upper city',
          },
          {
            term: 'Ponte Luís I',
            detail:
              'The double-deck iron arch bridge over the Douro, walkable on both levels',
          },
          {
            term: 'Vila Nova de Gaia',
            detail:
              'The far bank, where the port wine lodges are — the wine is made upriver and aged here',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Aveiro',
        body: 'A lagoon town of canals and painted flat-bottomed boats built for harvesting seaweed, with a striped-house beach strip a short ride away — a complete change of texture on day three.',
        items: [
          {
            term: 'Ria de Aveiro',
            detail:
              'The shallow coastal lagoon behind the town, with salt pans still worked',
          },
          {
            term: 'Costa Nova',
            detail:
              'The beach village of vertically striped wooden houses across the lagoon',
          },
          {
            term: 'Moliceiros',
            detail:
              'The long painted boats originally used to gather lagoon weed for fertiliser',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Nazaré',
        body: 'One night at the place where an underwater canyon focuses Atlantic swell into the largest surfable waves ever ridden — which in a calm autumn week means a fishing town with a funicular, and in the right swell means something else entirely.',
        items: [
          {
            term: 'Praia do Norte',
            detail:
              'The beach the record waves break on, below the fort headland',
          },
          {
            term: 'Sítio',
            detail:
              'The clifftop upper town, reached by a funicular from the beach',
          },
          {
            term: 'Mosteiro de Alcobaça',
            detail:
              'A vast Cistercian abbey church inland, one of the earliest Gothic buildings in the country',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Peniche',
        body: 'A working fishing port on a near-island headland with surf on both sides, so there is almost always one beach that is out of the wind — and a fortress that spent the twentieth century as a political prison.',
        items: [
          {
            term: 'Supertubos',
            detail:
              'The beach break south of the town, and the reason the world tour comes here',
          },
          {
            term: 'Berlengas',
            detail:
              'A granite island group ten miles offshore, a nature reserve with a fort on it, reached by boat',
          },
          {
            term: 'Fortaleza de Peniche',
            detail:
              'The sea fort used as a prison by the Estado Novo regime, now a museum of that',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Vila Nova de Milfontes',
        body: 'Two nights on the Alentejo coast, which is the emptiest and least developed stretch of shoreline in mainland Portugal — cliffs, storks nesting on sea stacks, and a river mouth calm enough to swim in when the ocean is not.',
        items: [
          {
            term: 'Parque Natural do Sudoeste Alentejano',
            detail:
              'The protected coastal strip running the length of this stage',
          },
          {
            term: 'Rota Vicentina',
            detail:
              'A long-distance walking route along these cliffs, in day-sized sections',
          },
          {
            term: 'Foz do Mira',
            detail:
              'The estuary at the town, sheltered water beside an exposed coast',
          },
        ],
      },
      {
        sort: 8,
        type: 'prose',
        heading: 'Sagres',
        body: 'Finish at the southwest corner of the continent, on a windswept plateau of low scrub above vertical cliffs, where Portugal’s Atlantic navigation was organised in the fifteenth century and where the coast simply runs out.',
        items: [
          {
            term: 'Cabo de São Vicente',
            detail:
              'The southwesternmost point of mainland Europe, with a lighthouse on the cliff edge',
          },
          {
            term: 'Fortaleza de Sagres',
            detail:
              'The fort on the headland, associated with Henry the Navigator’s school of navigation',
          },
          {
            term: 'Praia do Beliche',
            detail:
              'A sheltered cove below the cliffs between the two headlands',
          },
        ],
      },
    ],
  },
  {
    slug: 'wadden-sea-and-dikes',
    region: 'The Wadden coast',
    name: 'The Wadden Sea, Texel to Norddeich',
    summary:
      'A short flat five days along the largest unbroken tidal flat system in the world, where the thing you plan around is not the weather or the road but the tide table.',
    countries: ['nl', 'de'],
    days: 5,
    months: [4, 5, 6, 7, 8, 9],
    suits: ['families', 'cyclists', 'first-trip', 'large-motorhome'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. The Netherlands is one of the best-mapped countries in our database — 3 761 sites for a small country — so the counts on the Dutch stages of this route are unusually close to complete.',
    stages: [
      {
        name: 'Den Burg, Texel',
        lat: 53.0535,
        lon: 4.7965,
        nights: 1,
      },
      {
        name: 'Harlingen',
        lat: 53.1745,
        lon: 5.4147,
        nights: 1,
      },
      {
        name: 'Lauwersoog',
        lat: 53.4008,
        lon: 6.2131,
        nights: 1,
      },
      {
        name: 'Norddeich',
        lat: 53.6117,
        lon: 7.1603,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'This is the shortest route in the library and the only one where the landscape disappears twice a day. The Wadden Sea is a continuous belt of tidal flats running from the Netherlands past Germany to Denmark, protected as a single UNESCO site, and at low water it is not sea at all — it is a hundred kilometres of exposed mud and sand with channels through it. At high water it is back. Everything here, including whether the thing you drove to see exists this afternoon, runs off that timetable.\n\nIt is also the easiest driving anywhere in this library by a wide margin. The land is flat, the roads are excellent, and the whole coast sits behind dikes that double as the best cycle network in Europe. For a large motorhome or a family with small children this is about as low-stress as European camping gets, which is why it is tagged for both. The Dutch stages in particular have campsite density that is hard to believe: 107 sites within 25 km of Den Burg on Texel, 92 around Lauwersoog, in a country the size of a French region.\n\nThe activity this coast is known for is wadlopen — walking out across the flats at low tide towards an island, in a guided group, because doing it alone is how people drown. It is a genuinely strange thing to do: several hours of knee-deep mud and channel crossings with the sea coming back at a fixed time. It is also regulated, guided and seasonal, and it is the single best reason to come here rather than to any other flat coast.\n\nThe route crosses into Germany at the end on purpose. The Dutch and East Frisian sides of the same tidal system are administered completely differently, look different behind the dike, and have a different idea of what a seaside town is for — and the contrast over five days is more interesting than four Dutch stages would have been.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'April to September. This is a bird and tide route more than a sun route, and the two best windows are actually the migration peaks — late April and May on the way north, and late August into September on the way back, when the mudflats hold wader flocks in numbers that are hard to describe.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Flat, straight and excellent, with two constraints that are not about difficulty: the island stages depend on car ferries that must be booked ahead for a vehicle in summer, and a great deal of the good stuff is on dike-top cycle paths where vehicles cannot go at all. Bring bikes or the route loses half its point.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Den Burg, Texel',
        body: 'Start on the largest of the Dutch islands, reached by a twenty-minute ferry from Den Helder, where the whole western side is dune and the eastern side is mudflat — the two halves of this coast on one island.',
        items: [
          {
            term: 'Nationaal Park Duinen van Texel',
            detail:
              'The dune, heath and woodland strip down the island’s seaward side',
          },
          {
            term: 'Ecomare',
            detail:
              'A seal and seabird rescue centre with a museum of the Wadden system',
          },
          {
            term: 'De Slufter',
            detail:
              'A breach in the dunes where salt water floods a valley — salt-marsh plants growing behind a beach',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Harlingen',
        body: 'Back on the mainland in a Frisian harbour town that is still a working port for the island ferries, with a centre of seventeenth-century merchant houses along the water rather than behind it.',
        items: [
          {
            term: 'Willemshaven',
            detail:
              'The old harbour basin, with tall ships and the island ferry berths',
          },
          {
            term: 'Afsluitdijk',
            detail:
              'The 32-kilometre barrier dam south of here that closed off the Zuiderzee in 1932',
          },
          {
            term: 'Vlieland',
            detail:
              'The car-free island offshore — foot passengers only, which is the point of it',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Lauwersoog',
        body: 'A stop for darkness as much as for tides: the national park here was designated a dark-sky park, and it is one of the few places on this crowded coast where the night sky is genuinely black.',
        items: [
          {
            term: 'Nationaal Park Lauwersmeer',
            detail:
              'A former sea inlet closed off in 1969, now freshwater, birds and a dark-sky reserve',
          },
          {
            term: 'Schiermonnikoog',
            detail:
              'The quietest of the Dutch Wadden islands, essentially car-free, a short ferry away',
          },
          {
            term: 'Wadlopen',
            detail:
              'Guided walks out across the flats from this shore at low tide — guided only, and for good reason',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Norddeich',
        body: 'Finish across the border in East Frisia, where the same tidal flats are called the Wattenmeer, the dike is higher, and the local institution is a very specific and non-negotiable approach to drinking tea.',
        items: [
          {
            term: 'Nationalpark Niedersächsisches Wattenmeer',
            detail: 'The German half of the same protected tidal system',
          },
          {
            term: 'Juist and Norderney',
            detail:
              'East Frisian islands off this stretch, reached by ferry from Norddeich',
          },
          {
            term: 'Seehundstation Norddeich',
            detail:
              'A seal rearing station on the harbour, for pups separated from their mothers on the flats',
          },
        ],
      },
    ],
  },
  {
    slug: 'wild-atlantic-way-cork-to-the-burren',
    region: 'Cork, Kerry and Clare',
    name: 'The Wild Atlantic Way, Kinsale to the Burren',
    summary:
      'Seven days around the southwest peninsulas, on a route where the width of the road and not the distance decides how far you get in a day.',
    countries: ['ie'],
    days: 7,
    months: [5, 6, 7, 8, 9],
    suits: ['van-conversion', 'hikers', 'slow', 'wild-swimming'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Ireland is one of the thinner countries in our database — 519 sites in total — so the absence of a campsite from a stretch of this coast may mean nobody has mapped it rather than that nothing is there.',
    stages: [
      {
        name: 'Kinsale',
        lat: 51.7059,
        lon: -8.5222,
        nights: 1,
      },
      {
        name: 'Bantry',
        lat: 51.6808,
        lon: -9.4534,
        nights: 1,
      },
      {
        name: 'Kenmare',
        lat: 51.8806,
        lon: -9.5836,
        nights: 1,
      },
      {
        name: 'Killarney',
        lat: 52.0599,
        lon: -9.5044,
        nights: 1,
      },
      {
        name: 'Dingle',
        lat: 52.1409,
        lon: -10.2687,
        nights: 1,
      },
      {
        name: 'Doolin',
        lat: 53.0153,
        lon: -9.38,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'The single most useful thing to understand about driving in the Irish southwest is that the distances are trivial and the days are still long. Every stage on this route is a short hop on the map. In practice each one takes far longer than it should, because the roads are single-track with passing places, hedged to head height on both sides so you cannot see round anything, and shared with tour coaches that go one way round the famous loops by convention.\n\nThis has a practical consequence for the vehicle. A large motorhome on the Ring of Kerry or the Beara peninsula is not impossible, but it is a job rather than a drive, and there are stretches where reversing a long vehicle to a passing place is the price of meeting a coach. A van conversion is the right tool here in a way that is not true of the Danube or the French Atlantic. This route is tagged accordingly, and it is the only one in the library where the vehicle recommendation is a real restriction rather than a preference.\n\nThe weather deserves the same honesty. It rains here, frequently, in every month, and a week without rain would be remarkable. But it rains in bands that move through, so the useful skill is not avoiding it but reading it: a wet morning is very often a clear afternoon, and the light after a front goes through is the reason people photograph this coast so obsessively.\n\nCampsite provision is thin and clustered — our database holds between 8 and 35 sites within 25 km of each stage, and the nearest campsite to Kenmare is more than fifteen kilometres away, the largest stage-to-campsite gap anywhere in this library. Ireland has 519 campsites in our records in total — fewer than the single French département of Charente-Maritime, which has 643. Book, or at least ring ahead.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'May to September. Not because of temperature — Ireland barely has one, the sea moderates everything to a narrow band — but because of daylight and opening. In June you get light until half past ten at night; in November you get it until four, the peninsula roads are dark and wet, and most of the campsites on this route are closed.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Single-track lanes with passing places, high hedges, blind bends and oncoming coaches, plus the left-hand driving that catches out anyone arriving from the continent. The N-roads between towns are fine. Everything on a peninsula is not. Fuel and water are in the towns, not on the loops.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Kinsale',
        body: 'Start somewhere sheltered and civilised before the road gets hard: a narrow-streeted harbour town at the mouth of the Bandon, with two star forts guarding the estuary and a food reputation out of all proportion to its size.',
        items: [
          {
            term: 'Charles Fort',
            detail:
              'A late-seventeenth-century star fort on the eastern shore of the harbour',
          },
          {
            term: 'Old Head of Kinsale',
            detail:
              'The headland where the Lusitania was sunk offshore in 1915',
          },
          {
            term: 'Desmond Castle',
            detail:
              'A fifteenth-century urban tower house in the middle of the town',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Bantry',
        body: 'The gateway to the wildest of the peninsulas, on a long sheltered bay where a French invasion fleet anchored in 1796 and was driven off by the weather rather than by anyone defending it.',
        items: [
          {
            term: 'Bantry House',
            detail:
              'A house above the bay with terraced gardens looking down the water',
          },
          {
            term: 'Beara Peninsula',
            detail:
              'The least-visited of the southwestern peninsulas, with a cable car to Dursey Island at the end of it',
          },
          {
            term: 'Garnish Island',
            detail:
              'An island garden in Glengarriff harbour, reached by boat past a seal colony',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Kenmare',
        body: 'A planned eighteenth-century town at the head of its own bay, sitting at the junction of the Ring of Kerry and the Beara road — useful positioning, and the one stage where the nearest campsite in our data is a real drive away.',
        items: [
          {
            term: 'Kenmare Stone Circle',
            detail:
              'A Bronze Age circle on the edge of the town, with a large boulder burial at its centre',
          },
          {
            term: 'Gleninchaquin Park',
            detail:
              'A private glacial valley with a waterfall, up a dead-end road off the bay',
          },
          {
            term: 'Molls Gap',
            detail:
              'The pass north towards Killarney, and the view down into the lakes',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Killarney',
        body: 'The busiest stop on the route and worth it for one reason: the national park behind the town has the largest remaining native oak woodland in Ireland, and you can walk or cycle into it directly from the edge of the campsites.',
        items: [
          {
            term: 'Killarney National Park',
            detail:
              'Lakes, native oakwood and Ireland’s only wild native red deer herd',
          },
          {
            term: 'Muckross House',
            detail:
              'A Victorian house on the middle lake, with the estate open to walkers and cyclists',
          },
          {
            term: 'Gap of Dunloe',
            detail:
              'A narrow glacial breach between the Reeks and the Purple Mountain, closed to through traffic',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Dingle',
        body: 'A working fishing harbour in an Irish-speaking district, and the base for the one loop on this route that everyone agrees is better than the famous one — Slea Head, with early Christian stone huts standing in the fields beside the road.',
        items: [
          {
            term: 'Slea Head Drive',
            detail:
              'The loop round the end of the peninsula, with the Blasket Islands offshore',
          },
          {
            term: 'Gallarus Oratory',
            detail:
              'A dry-stone corbelled church, still watertight after a very long time',
          },
          {
            term: 'Blasket Islands',
            detail:
              'Islands evacuated in 1953, with a literature of their own written by the people who left',
          },
        ],
      },
      {
        sort: 8,
        type: 'prose',
        heading: 'Doolin',
        body: 'Finish on the edge of the Burren, a bare limestone pavement full of Arctic and Mediterranean plants growing in the same cracks — a landscape that looks like nothing else in the country, with the Cliffs of Moher at its southern end.',
        items: [
          {
            term: 'The Burren',
            detail:
              'A karst plateau of bare limestone pavement, with a famously improbable mix of flora',
          },
          {
            term: 'Cliffs of Moher',
            detail:
              'Sea cliffs running eight kilometres south of Doolin, with a clifftop walk between the two',
          },
          {
            term: 'Poulnabrone',
            detail:
              'A portal tomb standing on the open pavement, dated to the Neolithic',
          },
        ],
      },
    ],
  },
  {
    slug: 'swedish-lakes-and-forests',
    region: 'Svealand',
    name: 'Swedish Lakes, Stockholm to Dalarna',
    summary:
      'Nine days between Stockholm and the Dalarna lakes, through the country that gave Europe its clearest legal right to camp — and a route that explains exactly where that right stops applying to you.',
    countries: ['se'],
    days: 9,
    months: [6, 7, 8],
    suits: ['wild-swimming', 'families', 'slow', 'van-conversion'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Sweden is OpenStreetMap-only in our database, which means the large commercial lakeside sites are well recorded and the small municipal ones are patchy — the gaps on this route are likelier to be mapping gaps than empty ground.',
    stages: [
      {
        name: 'Stockholm',
        lat: 59.3293,
        lon: 18.0686,
        nights: 1,
      },
      {
        name: 'Örebro',
        lat: 59.2753,
        lon: 15.2134,
        nights: 1,
      },
      {
        name: 'Karlstad',
        lat: 59.3793,
        lon: 13.5036,
        nights: 2,
      },
      {
        name: 'Mora',
        lat: 61.0058,
        lon: 14.5381,
        nights: 1,
      },
      {
        name: 'Leksand',
        lat: 60.7299,
        lon: 14.9995,
        nights: 2,
      },
      {
        name: 'Uppsala',
        lat: 59.8586,
        lon: 17.6389,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'Allemansrätten, the right of public access, is the reason people come to Sweden with a tent, and it is also the most misunderstood thing about travelling here. The right is real and it is broad: you may walk, swim, pick berries and pitch a tent for a night on most uncultivated land without asking anyone. It is not a right to park a motorhome wherever you like. Vehicles are governed by road traffic law, not by allemansrätten, and a van parked overnight on a forest track is in a completely different legal position from a tent carried there on foot.\n\nThat distinction runs through this whole route and it is worth getting right, because getting it wrong is how visitors end up resented in a country that is otherwise extraordinarily welcoming to campers. The practical shape of it: sleep on a site or in a marked parking area, and use the right of access for the walking, the swimming and the berry-picking, which is where it is genuinely generous.\n\nThe landscape does not change dramatically over these nine days and that is the appeal. It is water and conifer and birch, over and over, at an enormous scale — Sweden has something over 95 000 lakes large enough to name, and this route threads between two of the biggest, Vänern and Siljan. The change you do notice is northward: by Dalarna the summer nights have stopped going properly dark, the villages are red-painted timber, and the folk traditions that the rest of the country treats as heritage are still in ordinary use.\n\nCampsite density here is the second-thinnest of any route in this library, after the Peloponnese — between 6 and 32 sites within 25 km of each stage, and only 6 around Uppsala. Swedish sites tend to be large, lakeside, well equipped and busy in July, and the gaps between them are long. This is a route to plan the fuel stops on.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'June to August. July is when Sweden itself is on holiday and the lakeside sites are busiest; late June is midsummer, which is the single best week to be here and also the one week when a lot of the country stops working. September is beautiful and cold, and the seasonal sites start closing.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Excellent, empty two-lane roads through forest, with the two hazards that Swedish road signs keep warning you about and visitors keep underestimating: elk, which are large enough to come through a windscreen, and long dusk periods when they move. Distances between services are long.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Stockholm',
        body: 'Start in a city built across fourteen islands where the lake meets the Baltic, and see the one thing you cannot see anywhere else: a seventeenth-century warship raised almost intact from the harbour mud.',
        items: [
          {
            term: 'Vasamuseet',
            detail:
              'The warship Vasa, sunk on her maiden voyage in 1628 and raised in 1961, largely complete',
          },
          {
            term: 'Gamla stan',
            detail:
              'The old town on its own island, medieval street plan intact',
          },
          {
            term: 'Stockholms skärgård',
            detail:
              'The archipelago east of the city — tens of thousands of islands, served by public boats',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Örebro',
        body: 'A castle on an island in the middle of a town, and the right place to break the drive west — also the gateway to Kilsbergen, the low forested ridge that is the first properly empty country on this route.',
        items: [
          {
            term: 'Örebro slott',
            detail:
              'A moated castle on an islet in the Svartån, in the centre of the town',
          },
          {
            term: 'Wadköping',
            detail:
              'A collection of relocated timber buildings forming a preserved old quarter',
          },
          {
            term: 'Kilsbergen',
            detail:
              'The forested ridge west of the town, with walking and small lakes',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Karlstad',
        body: 'Two nights on the northern shore of Vänern, which is the largest lake in the European Union and big enough that the far side is below the horizon — this is the stage for getting in the water.',
        items: [
          {
            term: 'Vänern',
            detail:
              'The EU’s largest lake, with an archipelago of its own off this shore',
          },
          {
            term: 'Mariebergsskogen',
            detail: 'A lakeside park on the edge of the city',
          },
          {
            term: 'Klarälven',
            detail:
              'The river that enters the lake here, once used for floating timber down from the north',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Mora',
        body: 'The northern turning point, at the top of Lake Siljan — a crater lake formed by a meteorite impact, and the heart of the Dalarna traditions that most visitors only meet as a painted wooden horse.',
        items: [
          {
            term: 'Siljan',
            detail:
              'The lake in the ring of a 377-million-year-old impact crater',
          },
          {
            term: 'Zornmuseet',
            detail:
              'The museum of the painter Anders Zorn, in the town he came from',
          },
          {
            term: 'Nusnäs',
            detail:
              'The village where the carved Dala horses are actually made',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Leksand',
        body: 'Two nights at the southern end of the same lake, because this is where the midsummer celebrations are largest and where the traditional timber villages around the shore are worth a slow day rather than a drive-through.',
        items: [
          {
            term: 'Leksands kyrka',
            detail: 'The lakeside church with an onion dome, above the water',
          },
          {
            term: 'Sommarland',
            detail: 'The reason families with children end up here in July',
          },
          {
            term: 'Tällberg',
            detail:
              'A village of timber houses on the slope above Siljan, looking down the lake',
          },
        ],
      },
      {
        sort: 8,
        type: 'prose',
        heading: 'Uppsala',
        body: 'Finish in the old ecclesiastical and university capital, with Scandinavia’s largest cathedral and, four kilometres north, the burial mounds of the kings who ruled here before any of it.',
        items: [
          {
            term: 'Uppsala domkyrka',
            detail:
              'The largest church in Scandinavia, and the burial place of Gustav Vasa and Linnaeus',
          },
          {
            term: 'Gamla Uppsala',
            detail:
              'Royal burial mounds from the sixth century, on the plain north of the city',
          },
          {
            term: 'Linnéträdgården',
            detail:
              'Linnaeus’s own botanical garden, replanted to his 1745 layout',
          },
        ],
      },
    ],
  },
  {
    slug: 'baltic-coast-and-capitals',
    region: 'Estonia, Latvia and Lithuania',
    name: 'The Baltic Coast, Tallinn to Vilnius',
    summary:
      'Nine days through three countries and three capitals along a coast of pine and white sand — the route in this library where the distance between one thing and the next is the real subject.',
    countries: ['ee', 'lv', 'lt'],
    days: 9,
    months: [6, 7, 8],
    suits: ['first-trip', 'off-season', 'slow', 'van-conversion'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Coverage in the Baltic states is thinner than in western Europe — that is a fact about the data as well as about the ground, and on this route the difference between the two matters more than anywhere else in the library.',
    stages: [
      {
        name: 'Tallinn',
        lat: 59.437,
        lon: 24.7536,
        nights: 2,
      },
      {
        name: 'Pärnu',
        lat: 58.3859,
        lon: 24.4971,
        nights: 1,
      },
      {
        name: 'Rīga',
        lat: 56.9496,
        lon: 24.1052,
        nights: 1,
      },
      {
        name: 'Liepāja',
        lat: 56.5047,
        lon: 21.0108,
        nights: 1,
      },
      {
        name: 'Nida',
        lat: 55.3033,
        lon: 21.0058,
        nights: 2,
      },
      {
        name: 'Vilnius',
        lat: 54.6872,
        lon: 25.2797,
        nights: 1,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'Three countries in nine days sounds like a sprint, and everywhere else in Europe it would be. Here it is not, because the Baltic states are small and almost entirely empty: you cross a border, the language on the signs changes completely, and the landscape does not change at all. Pine forest, sand, bog, and very few people. The whole of Estonia holds fewer campsites in our database than the French département of Charente-Maritime.\n\nThat emptiness is the thing to plan around, and it is why this route is honest about a number most itineraries hide. Our database holds 12 campsites within 25 km of Tallinn, 12 around Pärnu, 9 around Nida, 11 around Vilnius. Compare the French Atlantic route, where the equivalent figure is 223. Nothing is wrong with the data — there simply are not many campsites, the distances between them are large, and "we will find something" is a worse plan here than anywhere else in this library.\n\nWhat you get in exchange is the quietest coastline in the European Union. The beaches at Jūrmala and on the Curonian Spit are white sand backed by pine, and in June they are close to deserted by the standards of any other EU coast. The Spit in particular is unlike anywhere else: a 98-kilometre sand bar, half of it Lithuanian and half Russian, with migrating dunes high enough to have buried villages, and a strict protection regime that means you camp where you are told and nowhere else.\n\nThe three capitals are genuinely three different cities and this route treats them that way. Tallinn has an intact Hanseatic upper and lower town. Riga is an imperial-scale city with one of Europe’s largest concentrations of Art Nouveau frontages. Vilnius is baroque, Catholic, and set inland among hills — the only stage on this route that is not within an hour of the sea.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'June to August, and the reason is light rather than warmth. At these latitudes midsummer gives you eighteen or nineteen usable hours and the coast is genuinely warm; by late September it is dark at seven, most seasonal campsites have shut, and the route stops making sense.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Long, straight, empty two-lane roads through forest, in good condition and lightly policed by speed cameras that are well signed. The distances are the difficulty: several of these hops are three or four hours with almost nothing in between, and fuel stops thin out badly once you leave the main corridors.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Tallinn',
        body: 'Two nights to start, because Tallinn’s old town is a complete walled Hanseatic trading city on two levels and it deserves more than an afternoon — and because it is the one stage where the campsite is a bus ride from something worth two evenings.',
        items: [
          {
            term: 'Toompea',
            detail:
              'The upper town on the limestone outcrop, where the cathedral and the parliament are',
          },
          {
            term: 'Vanalinn',
            detail:
              'The lower town, with its merchant houses, guild halls and largely intact wall',
          },
          {
            term: 'Lahemaa rahvuspark',
            detail:
              'The bog, forest and coastal manor country an hour east, with boardwalk trails across the mires',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Pärnu',
        body: 'Estonia’s summer town, and the first time on this route that the Baltic looks inviting: a shallow, gently shelving sand bay that warms up far more than a sea at this latitude has any right to.',
        items: [
          {
            term: 'Pärnu rand',
            detail:
              'The long shallow town beach, with a wooden 1930s beach pavilion behind it',
          },
          {
            term: 'Soomaa rahvuspark',
            detail:
              'Bog country inland, known for a seasonal "fifth season" when the rivers flood the forest',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Rīga',
        body: 'The biggest city in the Baltics and the one with the most surprising streets: the Art Nouveau district north of the old town is blocks of it at a scale found almost nowhere else in Europe.',
        items: [
          {
            term: 'Alberta iela',
            detail: 'The street at the centre of Riga’s Art Nouveau quarter',
          },
          {
            term: 'Rīgas Centrāltirgus',
            detail:
              'The central market, housed in five repurposed Zeppelin hangars',
          },
          {
            term: 'Jūrmala',
            detail:
              'The pine-and-sand resort strip twenty minutes west, along the Gulf of Riga',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Liepāja',
        body: 'A port with an abandoned tsarist naval fortress town on its northern edge — half-demolished coastal batteries standing in the surf, which is a stranger and better stop than another old town.',
        items: [
          {
            term: 'Karosta',
            detail:
              'The former imperial Russian naval district, with a sea fortress being eaten by the Baltic',
          },
          {
            term: 'Liepājas ezers',
            detail: 'The lagoon behind the town, shallow and full of birds',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Nida',
        body: 'Two nights on the Curonian Spit, reached by ferry from Klaipėda: a sand bar between lagoon and sea where the dunes move, the villages are wooden and painted, and the protection rules mean you stay exactly where you are permitted to.',
        items: [
          {
            term: 'Parnidžio kopa',
            detail:
              'The great dune above Nida, with a sundial on top and a view down the spit',
          },
          {
            term: 'Kuršių nerija',
            detail:
              'The spit itself — 98 kilometres of shifting sand, half of it across a closed border',
          },
          {
            term: 'Thomas Mann House',
            detail:
              'The summer house the writer built in Nida in 1930, now a small museum',
          },
        ],
      },
      {
        sort: 8,
        type: 'prose',
        heading: 'Vilnius',
        body: 'Finish inland and uphill in a baroque capital that feels nothing like the two coastal ones — the largest old town in the Baltics, with a self-declared artists’ republic occupying one quarter of it.',
        items: [
          {
            term: 'Užupis',
            detail:
              'The district across the Vilnia that declared itself a republic in 1997, constitution posted on a wall',
          },
          {
            term: 'Gedimino pilies bokštas',
            detail:
              'The brick tower on the hill above the cathedral, and the view over the roofs',
          },
          {
            term: 'Trakai',
            detail:
              'An island castle on a lake half an hour west, reached by a causeway',
          },
        ],
      },
    ],
  },
  {
    slug: 'andalusia-in-winter',
    region: 'Andalucía',
    name: 'Andalusia in Winter, Seville to Cabo de Gata',
    summary:
      'Ten days across southern Spain in the months when every other route here is closed — the one itinerary in this library built for January rather than August.',
    countries: ['es'],
    days: 10,
    months: [11, 12, 1, 2, 3],
    suits: ['off-season', 'slow', 'history', 'large-motorhome'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Winter opening is not something our data records: a Spanish coastal site being in the database is not a statement that it is open in January, though on this coast many more of them are than anywhere else in this library.',
    stages: [
      {
        name: 'Sevilla',
        lat: 37.3891,
        lon: -5.9845,
        nights: 2,
      },
      {
        name: 'Ronda',
        lat: 36.742,
        lon: -5.1663,
        nights: 1,
      },
      {
        name: 'Tarifa',
        lat: 36.0143,
        lon: -5.6044,
        nights: 2,
      },
      {
        name: 'Granada',
        lat: 37.1773,
        lon: -3.5986,
        nights: 2,
      },
      {
        name: 'San José, Cabo de Gata',
        lat: 36.7598,
        lon: -2.106,
        nights: 2,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'Most camping routes assume summer. This one assumes the opposite, and it is aimed at the substantial population of northern Europeans who take a motorhome south in November and come back in March. The logic is simple: at this latitude, winter is the good season. Daytime temperatures in the coastal strip sit comfortably in the high teens, the sites that shut in the Alps are open here, and the cultural sights that are unbearable in a Seville August are pleasant in a Seville February.\n\nTwo things about that need saying honestly rather than glossed. First, winter here is not summer — it rains, mostly in the west and mostly in short heavy spells, and inland at altitude it is cold: Granada sits at around 700 metres with the Sierra Nevada behind it, and there is snow on those peaks in January while people are on the beach ninety minutes away. Second, the long-stay winter sites on this coast fill up with people who arrive in November and leave in March, which is a different kind of scarcity from the August rush and needs a different kind of planning.\n\nThe route is built as a west-to-east traverse rather than a loop, starting inland in Seville and finishing in the driest corner of the European mainland. That ordering is deliberate: it puts the cities at the start, when you have energy for them, and ends in the empty volcanic coast of Cabo de Gata, which is the part people wish they had left more time for. It also means you climb once, to Granada, rather than bouncing up and down off the coast.\n\nThe campsite spread is workable but not generous: our database holds between 9 and 29 sites within 25 km of each stage, with Cabo de Gata the thinnest at 9. That last figure is a genuine constraint rather than a data gap — it is a protected natural park, and the whole point of it is that there is not much there.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'November to March, which is the whole reason this route exists. Everything else in this library is a summer trip; this one is specifically for the months when the rest of Europe is shut. The inversion is real — Seville in July is regularly above 40 °C and genuinely unpleasant, and the same city in February is shirtsleeves by lunchtime.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'Good fast dual carriageways between the cities and genuinely narrow mountain roads to reach the white villages, several with sharp switchbacks and low-hanging balconies in the village streets themselves. The Cabo de Gata access roads are unsurfaced in places. Winter rain turns a dry rambla crossing into a real one.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Sevilla',
        body: 'Two nights to start, because Seville in winter is the best version of itself and because the two things to see here — the cathedral complex and the Alcázar — are both slow, both indoors-and-out, and both much better without a queue in the heat.',
        items: [
          {
            term: 'Real Alcázar',
            detail:
              'A royal palace begun under Muslim rule and rebuilt by Christian kings in the same idiom, with gardens',
          },
          {
            term: 'Catedral de Sevilla and La Giralda',
            detail:
              'The cathedral built on the mosque’s footprint, with its minaret kept as the bell tower',
          },
          {
            term: 'Plaza de España',
            detail:
              'The vast semicircular pavilion built for the 1929 Ibero-American Exposition',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Ronda',
        body: 'One night up in the sierra for the single most theatrical piece of geography in Spain: a town split by a gorge more than a hundred metres deep, with an eighteenth-century bridge across it that took forty years to build.',
        items: [
          {
            term: 'Puente Nuevo',
            detail: 'The bridge over the El Tajo gorge, completed in 1793',
          },
          {
            term: 'Baños Árabes',
            detail:
              'Unusually complete thirteenth-century Moorish baths below the old town',
          },
          {
            term: 'Sierra de Grazalema',
            detail:
              'The limestone range west of Ronda, and the wettest place in Spain by annual rainfall',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Tarifa',
        body: 'Two nights at the southern tip of the continent, where you can see Africa across fourteen kilometres of water on a clear day and where the wind that makes this the kitesurfing capital of Europe blows more or less permanently.',
        items: [
          {
            term: 'Punta de Tarifa',
            detail:
              'The southernmost point of mainland Europe, on an islet joined by a causeway',
          },
          {
            term: 'Playa de Bolonia',
            detail:
              'A dune-backed beach with the Roman town of Baelo Claudia excavated behind it',
          },
          {
            term: 'Estrecho de Gibraltar',
            detail:
              'The strait itself — a major migration corridor, with raptors and storks crossing in numbers in season',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Granada',
        body: 'Two nights, and the only stage where you should book something months ahead: entry to the Alhambra is capped and timed, and arriving in Granada without a ticket is arriving to look at it from outside.',
        items: [
          {
            term: 'La Alhambra',
            detail:
              'The Nasrid palace-city on the ridge, with the Generalife gardens above it — timed entry, capped daily',
          },
          {
            term: 'Albaicín',
            detail:
              'The old Moorish quarter of steep white lanes facing the Alhambra across the valley',
          },
          {
            term: 'Sierra Nevada',
            detail:
              'The range behind the city, with mainland Spain’s highest peak and a ski season running into spring',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'San José, Cabo de Gata',
        body: 'Finish in the driest part of Europe: a protected volcanic coastline of bare rock, agave and small unbuilt coves, with no resort development at all, which after four towns is exactly the right way to end.',
        items: [
          {
            term: 'Parque Natural de Cabo de Gata-Níjar',
            detail: 'Volcanic coast and semi-desert, protected since 1987',
          },
          {
            term: 'Playa de los Genoveses',
            detail:
              'An undeveloped crescent bay reached by a track, with no facilities',
          },
          {
            term: 'Salinas de Cabo de Gata',
            detail:
              'Working salt pans behind the shore, and the best birdwatching on this coast',
          },
        ],
      },
    ],
  },
  {
    slug: 'peloponnese-loop',
    region: 'Peloponnese',
    name: 'The Peloponnese, Nafplio to Olympia',
    summary:
      'Nine days round the southern peninsula of Greece, where every stage is ruins in the morning and a swim in the afternoon — and where the thinnest campsite data in this library is a fact about the ground, not about us.',
    countries: ['gr'],
    days: 9,
    months: [4, 5, 6, 9, 10],
    suits: ['history', 'wild-swimming', 'off-season', 'slow'],
    curatedAt: '2026-09-27',
    attribution:
      'Campsites come from OpenStreetMap under the Open Database License. Greece is among the more thinly mapped countries in our database, so on this route in particular the absence of a campsite from the map is weak evidence that there is none — it is worth checking locally as well as here.',
    stages: [
      {
        name: 'Nafplio',
        lat: 37.5675,
        lon: 22.8079,
        nights: 2,
      },
      {
        name: 'Mystras',
        lat: 37.0714,
        lon: 22.3678,
        nights: 1,
      },
      {
        name: 'Gytheio',
        lat: 36.7554,
        lon: 22.5661,
        nights: 2,
      },
      {
        name: 'Pylos',
        lat: 36.914,
        lon: 21.6966,
        nights: 1,
      },
      {
        name: 'Olympia',
        lat: 37.644,
        lon: 21.63,
        nights: 2,
      },
    ],
    sections: [
      {
        sort: 0,
        type: 'prose',
        heading: null,
        body: 'The Peloponnese is where Greek history is densest and Greek tourism is thinnest, which is an unusual combination and the whole argument for this route. Mycenae, Epidaurus, Sparta, Olympia and Messene are all on this peninsula, within a few hours of one another, and none of them carries anything like the crowds of Athens or Santorini. You can stand in the stadium at Olympia in May with a handful of other people in it.\n\nThe rhythm of the week writes itself and it is the opposite of a beach holiday’s. Start early, be at the site by eight or nine while the stone is still cool, be finished by noon, and spend the afternoon in the sea — which on this coast is warm from May and clear almost everywhere. Trying to do it the other way round is how people end up remembering Greek archaeology as an ordeal.\n\nBe honest about the campsite picture before you commit, because this route has the thinnest coverage in the library. Our database holds only 2 campsites within 25 km of Mystras and 4 around Olympia, against 19 at Nafplio and 13 at Pylos. Greece as a whole gives us 625 sites. Some of that is genuine — the interior is mountainous, empty and not set up for this — and some of it is mapping: Greek campsites are less thoroughly recorded in OpenStreetMap than Dutch or Croatian ones. Either way, the two inland stages need to be planned rather than improvised.\n\nThe peninsula is also more mountainous than people expect. The Taygetos range behind Sparta runs to well over 2 000 metres, the roads over it are serious, and the three southern prongs — Messenian, Mani and the eastern cape — are separated by them rather than by distance. This route deliberately stays on one side and ends inland rather than trying to loop all three in nine days.',
      },
      {
        sort: 1,
        type: 'prose',
        heading: 'When to go',
        body: 'April to June and September to October, and the constraint is not comfort but the archaeology. The sites on this route are open, unshaded stone in full sun, and walking round Mycenae or Olympia in a Greek July afternoon is a genuinely bad idea rather than merely a hot one. In May the same walk is pleasant and the sea is already swimmable.',
      },
      {
        sort: 2,
        type: 'prose',
        heading: 'The driving',
        body: 'A modern toll motorway across the north and then a great deal of narrow mountain road, some of it with no barrier and a long drop. Village streets in the Mani are stone-walled and tight. Fuel is in the towns; assume nothing on the mountain sections, including phone signal.',
      },
      {
        sort: 3,
        type: 'prose',
        heading: 'Nafplio',
        body: 'Two nights in the first capital of independent Greece — a Venetian-built harbour town under two fortresses, and the base for the two greatest sites in the Argolid, both within half an hour.',
        items: [
          {
            term: 'Palamidi',
            detail:
              'The Venetian fortress on the rock above the town, reached by a long flight of steps',
          },
          {
            term: 'Mycenae',
            detail:
              'The Bronze Age citadel with the Lion Gate, inland from here',
          },
          {
            term: 'Epidaurus',
            detail:
              'A fourth-century BC theatre with acoustics that still work, still used for performances',
          },
        ],
      },
      {
        sort: 4,
        type: 'prose',
        heading: 'Mystras',
        body: 'One night under the Byzantine city on the flank of Taygetos — a whole abandoned late-medieval town of churches, palaces and lanes climbing a hillside, which is a completely different Greece from the classical one either side of it.',
        items: [
          {
            term: 'Mystras',
            detail:
              'A Byzantine fortified town abandoned in the nineteenth century, its painted churches still standing',
          },
          {
            term: 'Sparti',
            detail:
              'Modern Sparta on the plain below, with very little of the ancient city left to see',
          },
          {
            term: 'Taygetos',
            detail:
              'The range behind, rising above 2 400 metres, with a long-distance path over it',
          },
        ],
      },
      {
        sort: 5,
        type: 'prose',
        heading: 'Gytheio',
        body: 'Two nights at the top of the Mani, in a working port with a tiny island joined by a causeway and a shipwreck on the beach outside town — and the point from which the tower villages of the peninsula are a day trip rather than a commitment.',
        items: [
          {
            term: 'Mani Peninsula',
            detail:
              'The middle southern prong, with fortified stone tower houses in the villages',
          },
          {
            term: 'Diros Caves',
            detail:
              'A flooded cave system south of here, visited by boat along an underground river',
          },
          {
            term: 'Cape Tainaron',
            detail:
              'The southernmost point of mainland Greece, with a lighthouse walk at the end of a track',
          },
        ],
      },
      {
        sort: 6,
        type: 'prose',
        heading: 'Pylos',
        body: 'A bay with a naval battle in it and a Mycenaean palace above it — and Voidokilia, a beach in an almost perfect circle that is genuinely worth a detour on a coast full of good ones.',
        items: [
          {
            term: 'Palace of Nestor',
            detail:
              'The best-preserved Mycenaean palace, where the Linear B archive was found',
          },
          {
            term: 'Voidokilia',
            detail:
              'A near-circular sand bay backed by a lagoon, with a Frankish castle on the headland',
          },
          {
            term: 'Navarino Bay',
            detail: 'The natural harbour where the 1827 battle was fought',
          },
        ],
      },
      {
        sort: 7,
        type: 'prose',
        heading: 'Olympia',
        body: 'Finish with two nights inland at the site the whole peninsula is best known for, so that you can be in the sanctuary at opening and still have a day for the museum — which holds the sculpture the site itself no longer has.',
        items: [
          {
            term: 'Ancient Olympia',
            detail:
              'The sanctuary and stadium where the games were held for a thousand years',
          },
          {
            term: 'Archaeological Museum of Olympia',
            detail:
              'The pediment sculpture from the temple of Zeus, and the Hermes of Praxiteles',
          },
          {
            term: 'Alfeios valley',
            detail:
              'The river valley the sanctuary sits in, green in a way the coast is not',
          },
        ],
      },
    ],
  },
];

export class SeedRoutesContent1795600000000 implements MigrationInterface {
  name = 'SeedRoutesContent1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const r of ROUTES) {
      const seen: Array<{ count: string }> = await queryRunner.query(
        `SELECT count(*)::text AS count FROM routes WHERE slug = $1`,
        [r.slug],
      );
      if (Number(seen[0]?.count ?? 0) > 0) continue;

      const route: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO routes
           (slug, duration_days, countries, months, suits, curated_at, region)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7)
         RETURNING id`,
        [r.slug, r.days, r.countries, r.months, r.suits, r.curatedAt, r.region],
      );
      const routeId = route[0].id;

      for (const [i, st] of r.stages.entries()) {
        await queryRunner.query(
          `INSERT INTO route_points (route_id, sequence, name, location, nights)
           VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6)`,
          [routeId, i, st.name, st.lon, st.lat, st.nights],
        );
      }

      const page: Array<{ id: string }> = await queryRunner.query(
        `INSERT INTO pages (slug, type, status, published_at, sort, noindex)
         VALUES ($1, 'route', 'published', now(), 0, false)
         RETURNING id`,
        [r.slug],
      );
      const pageId = page[0].id;

      await queryRunner.query(
        `INSERT INTO page_translations
           (page_id, language_code, title, meta_title, meta_description)
         VALUES ($1, 'en', $2, $2, $3)`,
        [pageId, r.name, r.summary],
      );

      const sections: SeedSection[] = [
        ...r.sections,
        {
          sort: r.sections.length,
          type: 'prose',
          heading: 'Where this data comes from',
          body: r.attribution,
        },
      ];

      for (const s of sections) {
        const row: Array<{ id: string }> = await queryRunner.query(
          `INSERT INTO page_sections (page_id, sort, type, visible)
           VALUES ($1, $2, $3, true) RETURNING id`,
          [pageId, s.sort, s.type],
        );
        await queryRunner.query(
          `INSERT INTO page_section_translations
             (section_id, language_code, heading, body, items)
           VALUES ($1, 'en', $2, $3, $4::jsonb)`,
          [
            row[0].id,
            s.heading,
            s.body,
            // 🔴 ПОРОЖНІЙ МАСИВ, А НЕ `null`: колонка `items` оголошена
            // NOT NULL (заміряно падінням міграції). «Переліку немає» і
            // «перелік порожній» тут одне й те саме, бо рендерер читає
            // довжину, а не наявність.
            JSON.stringify(s.items ?? []),
          ],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const slugs = ROUTES.map((r) => r.slug);
    await queryRunner.query(
      `DELETE FROM page_translations
        WHERE page_id IN (SELECT id FROM pages WHERE slug = ANY($1) AND type = 'route')`,
      [slugs],
    );
    await queryRunner.query(
      `DELETE FROM pages WHERE slug = ANY($1) AND type = 'route'`,
      [slugs],
    );
    await queryRunner.query(
      `DELETE FROM route_points WHERE route_id IN (SELECT id FROM routes WHERE slug = ANY($1))`,
      [slugs],
    );
    await queryRunner.query(`DELETE FROM routes WHERE slug = ANY($1)`, [slugs]);
  }
}
