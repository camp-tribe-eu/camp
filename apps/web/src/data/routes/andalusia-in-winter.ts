import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'es-andalusia-winter',
  slug: 'andalusia-in-winter',
  name: 'Andalusia in Winter, Seville to Cabo de Gata',
  countries: ['es'],
  region: 'Andalucía',
  days: 10,
  months: [11, 12, 1, 2, 3],
  seasonNote:
    'November to March, which is the whole reason this route exists. Everything else in this library is a summer trip; this one is specifically for the months when the rest of Europe is shut. The inversion is real — Seville in July is regularly above 40 °C and genuinely unpleasant, and the same city in February is shirtsleeves by lunchtime.',
  suits: ['off-season', 'slow', 'history', 'large-motorhome'],
  summary:
    'Ten days across southern Spain in the months when every other route here is closed — the one itinerary in this library built for January rather than August.',
  intro: [
    'Most camping routes assume summer. This one assumes the opposite, and it is aimed at the substantial population of northern Europeans who take a motorhome south in November and come back in March. The logic is simple: at this latitude, winter is the good season. Daytime temperatures in the coastal strip sit comfortably in the high teens, the sites that shut in the Alps are open here, and the cultural sights that are unbearable in a Seville August are pleasant in a Seville February.',
    'Two things about that need saying honestly rather than glossed. First, winter here is not summer — it rains, mostly in the west and mostly in short heavy spells, and inland at altitude it is cold: Granada sits at around 700 metres with the Sierra Nevada behind it, and there is snow on those peaks in January while people are on the beach ninety minutes away. Second, the long-stay winter sites on this coast fill up with people who arrive in November and leave in March, which is a different kind of scarcity from the August rush and needs a different kind of planning.',
    'The route is built as a west-to-east traverse rather than a loop, starting inland in Seville and finishing in the driest corner of the European mainland. That ordering is deliberate: it puts the cities at the start, when you have energy for them, and ends in the empty volcanic coast of Cabo de Gata, which is the part people wish they had left more time for. It also means you climb once, to Granada, rather than bouncing up and down off the coast.',
    'The campsite spread is workable but not generous: our database holds between 9 and 29 sites within 25 km of each stage, with Cabo de Gata the thinnest at 9. That last figure is a genuine constraint rather than a data gap — it is a protected natural park, and the whole point of it is that there is not much there.',
  ],
  roads: 'Good fast dual carriageways between the cities and genuinely narrow mountain roads to reach the white villages, several with sharp switchbacks and low-hanging balconies in the village streets themselves. The Cabo de Gata access roads are unsurfaced in places. Winter rain turns a dry rambla crossing into a real one.',
  stages: [
    {
      name: 'Sevilla',
      lat: 37.3891,
      lon: -5.9845,
      nights: 2,
      why: 'Two nights to start, because Seville in winter is the best version of itself and because the two things to see here — the cathedral complex and the Alcázar — are both slow, both indoors-and-out, and both much better without a queue in the heat.',
      pois: [
        { name: 'Real Alcázar', what: 'A royal palace begun under Muslim rule and rebuilt by Christian kings in the same idiom, with gardens' },
        { name: 'Catedral de Sevilla and La Giralda', what: 'The cathedral built on the mosque’s footprint, with its minaret kept as the bell tower' },
        { name: 'Plaza de España', what: 'The vast semicircular pavilion built for the 1929 Ibero-American Exposition' },
      ],
    },
    {
      name: 'Ronda',
      lat: 36.7420,
      lon: -5.1663,
      nights: 1,
      why: 'One night up in the sierra for the single most theatrical piece of geography in Spain: a town split by a gorge more than a hundred metres deep, with an eighteenth-century bridge across it that took forty years to build.',
      pois: [
        { name: 'Puente Nuevo', what: 'The bridge over the El Tajo gorge, completed in 1793' },
        { name: 'Baños Árabes', what: 'Unusually complete thirteenth-century Moorish baths below the old town' },
        { name: 'Sierra de Grazalema', what: 'The limestone range west of Ronda, and the wettest place in Spain by annual rainfall' },
      ],
    },
    {
      name: 'Tarifa',
      lat: 36.0143,
      lon: -5.6044,
      nights: 2,
      why: 'Two nights at the southern tip of the continent, where you can see Africa across fourteen kilometres of water on a clear day and where the wind that makes this the kitesurfing capital of Europe blows more or less permanently.',
      pois: [
        { name: 'Punta de Tarifa', what: 'The southernmost point of mainland Europe, on an islet joined by a causeway' },
        { name: 'Playa de Bolonia', what: 'A dune-backed beach with the Roman town of Baelo Claudia excavated behind it' },
        { name: 'Estrecho de Gibraltar', what: 'The strait itself — a major migration corridor, with raptors and storks crossing in numbers in season' },
      ],
    },
    {
      name: 'Granada',
      lat: 37.1773,
      lon: -3.5986,
      nights: 2,
      why: 'Two nights, and the only stage where you should book something months ahead: entry to the Alhambra is capped and timed, and arriving in Granada without a ticket is arriving to look at it from outside.',
      pois: [
        { name: 'La Alhambra', what: 'The Nasrid palace-city on the ridge, with the Generalife gardens above it — timed entry, capped daily' },
        { name: 'Albaicín', what: 'The old Moorish quarter of steep white lanes facing the Alhambra across the valley' },
        { name: 'Sierra Nevada', what: 'The range behind the city, with mainland Spain’s highest peak and a ski season running into spring' },
      ],
    },
    {
      name: 'San José, Cabo de Gata',
      lat: 36.7598,
      lon: -2.1060,
      nights: 2,
      why: 'Finish in the driest part of Europe: a protected volcanic coastline of bare rock, agave and small unbuilt coves, with no resort development at all, which after four towns is exactly the right way to end.',
      pois: [
        { name: 'Parque Natural de Cabo de Gata-Níjar', what: 'Volcanic coast and semi-desert, protected since 1987' },
        { name: 'Playa de los Genoveses', what: 'An undeveloped crescent bay reached by a track, with no facilities' },
        { name: 'Salinas de Cabo de Gata', what: 'Working salt pans behind the shore, and the best birdwatching on this coast' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Winter opening is not something our data records: a Spanish coastal site being in the database is not a statement that it is open in January, though on this coast many more of them are than anywhere else in this library.',
  curatedAt: '2026-09-27',
};
