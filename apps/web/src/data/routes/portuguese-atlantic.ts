import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'pt-atlantic',
  slug: 'portuguese-atlantic',
  name: 'The Portuguese Atlantic, Porto to Sagres',
  countries: ['pt'],
  region: 'Portugal',
  days: 9,
  months: [4, 5, 6, 9, 10],
  seasonNote:
    'April to June and September to October. The Portuguese Atlantic is cold water and steady wind all year, so this is not a route that gets better in August — it gets busier, and the coastal sites fill with Portuguese holidaymakers. The shoulder months have the same sea, the same light and far more room.',
  suits: ['surfers', 'van-conversion', 'off-season', 'wild-swimming'],
  summary:
    'Nine days down the whole Atlantic face of Portugal, on the route where the rules about where you may sleep changed recently and are the first thing you need to know.',
  intro: [
    'Portugal had a reputation, for about a decade, as the place in Europe where you could park a van anywhere near the sea and nobody would mind. That reputation is out of date and it is worth saying so at the top of the page, because acting on it is now how people get fined. The law was tightened in 2021 to prohibit overnighting in vehicles outside authorised places, with the protected coastal stretches enforced hardest — which, inconveniently, is exactly the coast this route follows.',
    'The practical answer is that Portugal also built the solution: a dense network of small paid aires and private sites specifically for motorhomes, many of them a few hundred metres from the beaches people used to park on. Our database holds between 12 and 33 campsites within 25 km of every stage on this route. The change is not that there is nowhere to sleep. It is that "anywhere" became "somewhere", and you now need to know which.',
    'The coast itself is one of the most consistent in Europe and consistently underrated by people who only know the Algarve. It is a nearly unbroken line of cliff, dune and long beach facing an ocean with nothing between it and America, which means swell all year and wind most afternoons. The surf culture is real and it runs the entire length: Peniche and Nazaré are known internationally, but there is a beach break in front of almost every stage here.',
    'The route runs north to south for a reason that matters day to day: the prevailing wind on this coast is northerly, and driving into it for nine days is a noticeably worse trip than having it behind you. It also means the landscape gets progressively drier and emptier as you go, ending on the headland at the southwest corner of Europe, which is the correct place to stop.',
  ],
  roads: 'Fast toll motorways inland and slow, pleasant national roads along the coast — the coastal ones are the point. Portuguese motorway tolling is partly electronic-only with no booths, which catches out foreign vehicles; sort the transponder or the pre-registration before you need it, not at the first gantry.',
  stages: [
    {
      name: 'Porto',
      lat: 41.1579,
      lon: -8.6291,
      nights: 2,
      why: 'Two nights to begin, in a granite city stacked up the side of a gorge, where the working river frontage and the port lodges on the far bank are both still doing the job they were built for.',
      pois: [
        { name: 'Ribeira', what: 'The old riverfront under the cliff, below the upper city' },
        { name: 'Ponte Luís I', what: 'The double-deck iron arch bridge over the Douro, walkable on both levels' },
        { name: 'Vila Nova de Gaia', what: 'The far bank, where the port wine lodges are — the wine is made upriver and aged here' },
      ],
    },
    {
      name: 'Aveiro',
      lat: 40.6405,
      lon: -8.6538,
      nights: 1,
      why: 'A lagoon town of canals and painted flat-bottomed boats built for harvesting seaweed, with a striped-house beach strip a short ride away — a complete change of texture on day three.',
      pois: [
        { name: 'Ria de Aveiro', what: 'The shallow coastal lagoon behind the town, with salt pans still worked' },
        { name: 'Costa Nova', what: 'The beach village of vertically striped wooden houses across the lagoon' },
        { name: 'Moliceiros', what: 'The long painted boats originally used to gather lagoon weed for fertiliser' },
      ],
    },
    {
      name: 'Nazaré',
      lat: 39.6015,
      lon: -9.0705,
      nights: 1,
      why: 'One night at the place where an underwater canyon focuses Atlantic swell into the largest surfable waves ever ridden — which in a calm autumn week means a fishing town with a funicular, and in the right swell means something else entirely.',
      pois: [
        { name: 'Praia do Norte', what: 'The beach the record waves break on, below the fort headland' },
        { name: 'Sítio', what: 'The clifftop upper town, reached by a funicular from the beach' },
        { name: 'Mosteiro de Alcobaça', what: 'A vast Cistercian abbey church inland, one of the earliest Gothic buildings in the country' },
      ],
    },
    {
      name: 'Peniche',
      lat: 39.3558,
      lon: -9.3811,
      nights: 1,
      why: 'A working fishing port on a near-island headland with surf on both sides, so there is almost always one beach that is out of the wind — and a fortress that spent the twentieth century as a political prison.',
      pois: [
        { name: 'Supertubos', what: 'The beach break south of the town, and the reason the world tour comes here' },
        { name: 'Berlengas', what: 'A granite island group ten miles offshore, a nature reserve with a fort on it, reached by boat' },
        { name: 'Fortaleza de Peniche', what: 'The sea fort used as a prison by the Estado Novo regime, now a museum of that' },
      ],
    },
    {
      name: 'Vila Nova de Milfontes',
      lat: 37.7253,
      lon: -8.7830,
      nights: 2,
      why: 'Two nights on the Alentejo coast, which is the emptiest and least developed stretch of shoreline in mainland Portugal — cliffs, storks nesting on sea stacks, and a river mouth calm enough to swim in when the ocean is not.',
      pois: [
        { name: 'Parque Natural do Sudoeste Alentejano', what: 'The protected coastal strip running the length of this stage' },
        { name: 'Rota Vicentina', what: 'A long-distance walking route along these cliffs, in day-sized sections' },
        { name: 'Foz do Mira', what: 'The estuary at the town, sheltered water beside an exposed coast' },
      ],
    },
    {
      name: 'Sagres',
      lat: 37.0083,
      lon: -8.9450,
      nights: 1,
      why: 'Finish at the southwest corner of the continent, on a windswept plateau of low scrub above vertical cliffs, where Portugal’s Atlantic navigation was organised in the fifteenth century and where the coast simply runs out.',
      pois: [
        { name: 'Cabo de São Vicente', what: 'The southwesternmost point of mainland Europe, with a lighthouse on the cliff edge' },
        { name: 'Fortaleza de Sagres', what: 'The fort on the headland, associated with Henry the Navigator’s school of navigation' },
        { name: 'Praia do Beliche', what: 'A sheltered cove below the cliffs between the two headlands' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Our data records where a site is and, where somebody has tagged it, what facilities it has — it does not record whether a place is an authorised overnight location under Portuguese law, and on this route that is a distinction you have to check yourself.',
  curatedAt: '2026-09-27',
};
