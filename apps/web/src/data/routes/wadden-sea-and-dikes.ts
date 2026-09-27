import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'wadden-sea-dikes',
  slug: 'wadden-sea-and-dikes',
  name: 'The Wadden Sea, Texel to Norddeich',
  countries: ['nl', 'de'],
  region: 'The Wadden coast',
  days: 5,
  months: [4, 5, 6, 7, 8, 9],
  seasonNote:
    'April to September. This is a bird and tide route more than a sun route, and the two best windows are actually the migration peaks — late April and May on the way north, and late August into September on the way back, when the mudflats hold wader flocks in numbers that are hard to describe.',
  suits: ['families', 'cyclists', 'first-trip', 'large-motorhome'],
  summary:
    'A short flat five days along the largest unbroken tidal flat system in the world, where the thing you plan around is not the weather or the road but the tide table.',
  intro: [
    'This is the shortest route in the library and the only one where the landscape disappears twice a day. The Wadden Sea is a continuous belt of tidal flats running from the Netherlands past Germany to Denmark, protected as a single UNESCO site, and at low water it is not sea at all — it is a hundred kilometres of exposed mud and sand with channels through it. At high water it is back. Everything here, including whether the thing you drove to see exists this afternoon, runs off that timetable.',
    'It is also the easiest driving anywhere in this library by a wide margin. The land is flat, the roads are excellent, and the whole coast sits behind dikes that double as the best cycle network in Europe. For a large motorhome or a family with small children this is about as low-stress as European camping gets, which is why it is tagged for both. The Dutch stages in particular have campsite density that is hard to believe: 107 sites within 25 km of Den Burg on Texel, 92 around Lauwersoog, in a country the size of a French region.',
    'The activity this coast is known for is wadlopen — walking out across the flats at low tide towards an island, in a guided group, because doing it alone is how people drown. It is a genuinely strange thing to do: several hours of knee-deep mud and channel crossings with the sea coming back at a fixed time. It is also regulated, guided and seasonal, and it is the single best reason to come here rather than to any other flat coast.',
    'The route crosses into Germany at the end on purpose. The Dutch and East Frisian sides of the same tidal system are administered completely differently, look different behind the dike, and have a different idea of what a seaside town is for — and the contrast over five days is more interesting than four Dutch stages would have been.',
  ],
  roads: 'Flat, straight and excellent, with two constraints that are not about difficulty: the island stages depend on car ferries that must be booked ahead for a vehicle in summer, and a great deal of the good stuff is on dike-top cycle paths where vehicles cannot go at all. Bring bikes or the route loses half its point.',
  stages: [
    {
      name: 'Den Burg, Texel',
      lat: 53.0535,
      lon: 4.7965,
      nights: 1,
      why: 'Start on the largest of the Dutch islands, reached by a twenty-minute ferry from Den Helder, where the whole western side is dune and the eastern side is mudflat — the two halves of this coast on one island.',
      pois: [
        { name: 'Nationaal Park Duinen van Texel', what: 'The dune, heath and woodland strip down the island’s seaward side' },
        { name: 'Ecomare', what: 'A seal and seabird rescue centre with a museum of the Wadden system' },
        { name: 'De Slufter', what: 'A breach in the dunes where salt water floods a valley — salt-marsh plants growing behind a beach' },
      ],
    },
    {
      name: 'Harlingen',
      lat: 53.1745,
      lon: 5.4147,
      nights: 1,
      why: 'Back on the mainland in a Frisian harbour town that is still a working port for the island ferries, with a centre of seventeenth-century merchant houses along the water rather than behind it.',
      pois: [
        { name: 'Willemshaven', what: 'The old harbour basin, with tall ships and the island ferry berths' },
        { name: 'Afsluitdijk', what: 'The 32-kilometre barrier dam south of here that closed off the Zuiderzee in 1932' },
        { name: 'Vlieland', what: 'The car-free island offshore — foot passengers only, which is the point of it' },
      ],
    },
    {
      name: 'Lauwersoog',
      lat: 53.4008,
      lon: 6.2131,
      nights: 1,
      why: 'A stop for darkness as much as for tides: the national park here was designated a dark-sky park, and it is one of the few places on this crowded coast where the night sky is genuinely black.',
      pois: [
        { name: 'Nationaal Park Lauwersmeer', what: 'A former sea inlet closed off in 1969, now freshwater, birds and a dark-sky reserve' },
        { name: 'Schiermonnikoog', what: 'The quietest of the Dutch Wadden islands, essentially car-free, a short ferry away' },
        { name: 'Wadlopen', what: 'Guided walks out across the flats from this shore at low tide — guided only, and for good reason' },
      ],
    },
    {
      name: 'Norddeich',
      lat: 53.6117,
      lon: 7.1603,
      nights: 1,
      why: 'Finish across the border in East Frisia, where the same tidal flats are called the Wattenmeer, the dike is higher, and the local institution is a very specific and non-negotiable approach to drinking tea.',
      pois: [
        { name: 'Nationalpark Niedersächsisches Wattenmeer', what: 'The German half of the same protected tidal system' },
        { name: 'Juist and Norderney', what: 'East Frisian islands off this stretch, reached by ferry from Norddeich' },
        { name: 'Seehundstation Norddeich', what: 'A seal rearing station on the harbour, for pups separated from their mothers on the flats' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. The Netherlands is one of the best-mapped countries in our database — 3 761 sites for a small country — so the counts on the Dutch stages of this route are unusually close to complete.',
  curatedAt: '2026-09-27',
};
