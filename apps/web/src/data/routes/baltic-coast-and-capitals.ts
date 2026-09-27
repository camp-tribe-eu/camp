import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'baltic-coast-capitals',
  slug: 'baltic-coast-and-capitals',
  name: 'The Baltic Coast, Tallinn to Vilnius',
  countries: ['ee', 'lv', 'lt'],
  region: 'Estonia, Latvia and Lithuania',
  days: 9,
  months: [6, 7, 8],
  seasonNote:
    'June to August, and the reason is light rather than warmth. At these latitudes midsummer gives you eighteen or nineteen usable hours and the coast is genuinely warm; by late September it is dark at seven, most seasonal campsites have shut, and the route stops making sense.',
  suits: ['first-trip', 'off-season', 'slow', 'van-conversion'],
  summary:
    'Nine days through three countries and three capitals along a coast of pine and white sand — the route in this library where the distance between one thing and the next is the real subject.',
  intro: [
    'Three countries in nine days sounds like a sprint, and everywhere else in Europe it would be. Here it is not, because the Baltic states are small and almost entirely empty: you cross a border, the language on the signs changes completely, and the landscape does not change at all. Pine forest, sand, bog, and very few people. The whole of Estonia holds fewer campsites in our database than the French département of Charente-Maritime.',
    'That emptiness is the thing to plan around, and it is why this route is honest about a number most itineraries hide. Our database holds 12 campsites within 25 km of Tallinn, 12 around Pärnu, 9 around Nida, 11 around Vilnius. Compare the French Atlantic route, where the equivalent figure is 223. Nothing is wrong with the data — there simply are not many campsites, the distances between them are large, and "we will find something" is a worse plan here than anywhere else in this library.',
    'What you get in exchange is the quietest coastline in the European Union. The beaches at Jūrmala and on the Curonian Spit are white sand backed by pine, and in June they are close to deserted by the standards of any other EU coast. The Spit in particular is unlike anywhere else: a 98-kilometre sand bar, half of it Lithuanian and half Russian, with migrating dunes high enough to have buried villages, and a strict protection regime that means you camp where you are told and nowhere else.',
    'The three capitals are genuinely three different cities and this route treats them that way. Tallinn has an intact Hanseatic upper and lower town. Riga is an imperial-scale city with one of Europe’s largest concentrations of Art Nouveau frontages. Vilnius is baroque, Catholic, and set inland among hills — the only stage on this route that is not within an hour of the sea.',
  ],
  roads: 'Long, straight, empty two-lane roads through forest, in good condition and lightly policed by speed cameras that are well signed. The distances are the difficulty: several of these hops are three or four hours with almost nothing in between, and fuel stops thin out badly once you leave the main corridors.',
  stages: [
    {
      name: 'Tallinn',
      lat: 59.4370,
      lon: 24.7536,
      nights: 2,
      why: 'Two nights to start, because Tallinn’s old town is a complete walled Hanseatic trading city on two levels and it deserves more than an afternoon — and because it is the one stage where the campsite is a bus ride from something worth two evenings.',
      pois: [
        { name: 'Toompea', what: 'The upper town on the limestone outcrop, where the cathedral and the parliament are' },
        { name: 'Vanalinn', what: 'The lower town, with its merchant houses, guild halls and largely intact wall' },
        { name: 'Lahemaa rahvuspark', what: 'The bog, forest and coastal manor country an hour east, with boardwalk trails across the mires' },
      ],
    },
    {
      name: 'Pärnu',
      lat: 58.3859,
      lon: 24.4971,
      nights: 1,
      why: 'Estonia’s summer town, and the first time on this route that the Baltic looks inviting: a shallow, gently shelving sand bay that warms up far more than a sea at this latitude has any right to.',
      pois: [
        { name: 'Pärnu rand', what: 'The long shallow town beach, with a wooden 1930s beach pavilion behind it' },
        { name: 'Soomaa rahvuspark', what: 'Bog country inland, known for a seasonal "fifth season" when the rivers flood the forest' },
      ],
    },
    {
      name: 'Rīga',
      lat: 56.9496,
      lon: 24.1052,
      nights: 1,
      why: 'The biggest city in the Baltics and the one with the most surprising streets: the Art Nouveau district north of the old town is blocks of it at a scale found almost nowhere else in Europe.',
      pois: [
        { name: 'Alberta iela', what: 'The street at the centre of Riga’s Art Nouveau quarter' },
        { name: 'Rīgas Centrāltirgus', what: 'The central market, housed in five repurposed Zeppelin hangars' },
        { name: 'Jūrmala', what: 'The pine-and-sand resort strip twenty minutes west, along the Gulf of Riga' },
      ],
    },
    {
      name: 'Liepāja',
      lat: 56.5047,
      lon: 21.0108,
      nights: 1,
      why: 'A port with an abandoned tsarist naval fortress town on its northern edge — half-demolished coastal batteries standing in the surf, which is a stranger and better stop than another old town.',
      pois: [
        { name: 'Karosta', what: 'The former imperial Russian naval district, with a sea fortress being eaten by the Baltic' },
        { name: 'Liepājas ezers', what: 'The lagoon behind the town, shallow and full of birds' },
      ],
    },
    {
      name: 'Nida',
      lat: 55.3033,
      lon: 21.0058,
      nights: 2,
      why: 'Two nights on the Curonian Spit, reached by ferry from Klaipėda: a sand bar between lagoon and sea where the dunes move, the villages are wooden and painted, and the protection rules mean you stay exactly where you are permitted to.',
      pois: [
        { name: 'Parnidžio kopa', what: 'The great dune above Nida, with a sundial on top and a view down the spit' },
        { name: 'Kuršių nerija', what: 'The spit itself — 98 kilometres of shifting sand, half of it across a closed border' },
        { name: 'Thomas Mann House', what: 'The summer house the writer built in Nida in 1930, now a small museum' },
      ],
    },
    {
      name: 'Vilnius',
      lat: 54.6872,
      lon: 25.2797,
      nights: 1,
      why: 'Finish inland and uphill in a baroque capital that feels nothing like the two coastal ones — the largest old town in the Baltics, with a self-declared artists’ republic occupying one quarter of it.',
      pois: [
        { name: 'Užupis', what: 'The district across the Vilnia that declared itself a republic in 1997, constitution posted on a wall' },
        { name: 'Gedimino pilies bokštas', what: 'The brick tower on the hill above the cathedral, and the view over the roofs' },
        { name: 'Trakai', what: 'An island castle on a lake half an hour west, reached by a causeway' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Coverage in the Baltic states is thinner than in western Europe — that is a fact about the data as well as about the ground, and on this route the difference between the two matters more than anywhere else in the library.',
  curatedAt: '2026-09-27',
};
