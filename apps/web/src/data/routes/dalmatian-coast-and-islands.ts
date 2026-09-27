import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'hr-dalmatia',
  slug: 'dalmatian-coast-and-islands',
  name: 'Dalmatia, Zadar to Dubrovnik',
  countries: ['hr'],
  region: 'Dalmatia',
  days: 9,
  months: [5, 6, 9, 10],
  seasonNote:
    'May, June, September and October. This is a shoulder-season route by design: in July and August the coast road is a queue, the island ferries sell out for vehicles, and the campsites on the seafront are full — while in late September the sea is still warm enough to swim in and the same sites are half empty.',
  suits: ['wild-swimming', 'families', 'slow', 'history'],
  summary:
    'Nine days down the Adriatic with one structural difference from every other coastal route here: the ferry timetable, not the road, decides what each day looks like.',
  intro: [
    'The Dalmatian coast is 500 kilometres of one road, the Jadranska magistrala, and the temptation is to treat it as a drive. It is not. Everything interesting about this coast is that it is broken into islands, and the moment an island is in your plan the planning unit stops being kilometres and becomes sailings. A vehicle ferry that runs six times a day in August runs twice in October, and the space for a motorhome on it is a different and smaller allocation than the space for a car.',
    'So this route is built around that constraint rather than pretending it away. It has one island stage, not four, and it is placed in the middle where a missed sailing costs you an afternoon rather than the end of the trip. The rest is mainland, where the coast road is genuinely spectacular and genuinely slow — it is two lanes, it hugs the water, and behind it the Dinaric mountains come down almost to the sea, so there is nowhere for a faster road to go.',
    'The campsite picture here is unusually good. Our database holds 102 sites within 25 km of Zadar and 61 around Šibenik, and a large share of Croatian coastal camping is small, family-run and right on the water — the country has a long tradition of it. It thins as you go south: 17 within 25 km of Dubrovnik, which is a real constraint on the last stage rather than a gap in our data.',
    'One honest warning about the end. Dubrovnik is the most visited place on this coast and the least suited to arriving in a vehicle; the old town is walled, closed to traffic, and served by car parks that were not designed for this. Treat the last stage as somewhere you park and take a bus from, and it works.',
  ],
  roads: 'A two-lane coast road with sea on one side and rock on the other, slow, exposed to the bura wind in autumn, and busy with the same traffic you are in. The island roads are narrower again. Nothing is technically hard; everything takes longer than the map suggests.',
  stages: [
    {
      name: 'Zadar',
      lat: 44.1194,
      lon: 15.2314,
      nights: 1,
      why: 'Begin on a peninsula with a Roman forum lying in the open, and the one seafront in Europe that is worth being at specifically for the sound: the Sea Organ turns swell into notes through pipes under the marble steps.',
      pois: [
        { name: 'Morske orgulje (Sea Organ)', what: 'Pipes set under the waterfront steps, played by the waves' },
        { name: 'Crkva sv. Donata', what: 'A ninth-century round church standing on the stones of the Roman forum' },
        { name: 'Nacionalni park Kornati', what: 'An archipelago of bare limestone islands, reached by boat from the coast here' },
      ],
    },
    {
      name: 'Šibenik',
      lat: 43.7350,
      lon: 15.8952,
      nights: 1,
      why: 'A stop for the river rather than the sea: Šibenik sits where the Krka comes out through a gorge, and it is the base for the waterfalls upstream — a genuinely different landscape twenty minutes inland.',
      pois: [
        { name: 'Katedrala sv. Jakova', what: 'A cathedral built entirely of stone, without brick or timber, with a frieze of seventy-odd carved heads' },
        { name: 'Nacionalni park Krka', what: 'The travertine falls upstream on the Krka river' },
        { name: 'Tvrđava sv. Mihovila', what: 'The fortress above the old town, over the channel' },
      ],
    },
    {
      name: 'Split',
      lat: 43.5081,
      lon: 16.4402,
      nights: 2,
      why: 'Two nights, because Split is not a city with a Roman ruin in it — the old town is inside Diocletian’s palace, with flats and bars built into the fourth-century walls, and it also happens to be the ferry port for the island stage that follows.',
      pois: [
        { name: 'Dioklecijanova palača', what: 'A late-Roman imperial palace that the medieval town grew inside and never left' },
        { name: 'Marjan', what: 'The pine-covered hill on the end of the peninsula, walkable from the centre' },
        { name: 'Riva', what: 'The waterfront promenade along the palace’s sea wall' },
      ],
    },
    {
      name: 'Hvar',
      lat: 43.1729,
      lon: 16.4422,
      nights: 1,
      why: 'The island night, and the reason to check the sailing before anything else: Hvar is long, low and lavender-scented, and the town is a Venetian harbour with a fortress above it that you climb for the view of the Pakleni islands.',
      pois: [
        { name: 'Tvrđava Fortica', what: 'The fortress on the hill above Hvar town' },
        { name: 'Pakleni otoci', what: 'The scatter of wooded islets across the bay, a short boat hop from the harbour' },
        { name: 'Stari Grad Plain', what: 'A Greek agricultural landscape from the fourth century BC, with the original field divisions still in use' },
      ],
    },
    {
      name: 'Makarska',
      lat: 43.2969,
      lon: 17.0178,
      nights: 1,
      why: 'Back on the mainland under the Biokovo ridge, which rises to well over 1 500 metres directly behind the beach — the most abrupt sea-to-mountain transition anywhere on this route.',
      pois: [
        { name: 'Park prirode Biokovo', what: 'The limestone ridge behind the town, with a road up it that is not for large vehicles' },
        { name: 'Makarska riviera', what: 'The run of shingle beaches under the pines between Brela and Gradac' },
      ],
    },
    {
      name: 'Dubrovnik',
      lat: 42.6507,
      lon: 18.0944,
      nights: 2,
      why: 'Finish with two nights so that one of them can be early morning inside the walls, which is the only time the walled town is a place rather than a queue; park outside and come in by bus or boat.',
      pois: [
        { name: 'Gradske zidine', what: 'The complete circuit of city walls, walkable, about two kilometres round' },
        { name: 'Lokrum', what: 'The wooded island ten minutes offshore, with no accommodation on it at all' },
        { name: 'Srđ', what: 'The hill behind the city, reached by cable car or a switchback path' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Croatian coastal camping is unusually well mapped by volunteers, which is why the counts here are high — but a site being in the data says nothing about whether it is open in October, and many on this coast are not.',
  curatedAt: '2026-09-27',
};
