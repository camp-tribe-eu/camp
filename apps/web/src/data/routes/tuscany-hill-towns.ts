import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'it-tuscany-hill-towns',
  slug: 'tuscany-hill-towns',
  name: 'Tuscany by Hill Town, Lucca to Volterra',
  countries: ['it'],
  region: 'Toscana',
  days: 8,
  months: [4, 5, 6, 9, 10],
  seasonNote:
    'April to June and September to October. July and August are not merely busy here, they are hot in a way that changes the shape of the day — inland Tuscany regularly sits in the mid-thirties, the hill towns have no shade in their squares, and a van without air conditioning is unusable from noon until five.',
  suits: ['history', 'slow', 'first-trip', 'van-conversion'],
  summary:
    'Eight days of walled towns on hilltops, driven as a short loop rather than a dash, with the structural catch nobody mentions: the campsites are in the valleys and the towns are not.',
  intro: [
    'Every Tuscany itinerary is a list of hill towns. What none of them tell you is the thing that shapes every single day of this trip: the towns are on hills because they were built to be defended, and the campsites are in the valleys because that is where there is flat ground, water and a road. So the pattern of this route is not drive-park-explore. It is drive, park low, and climb — on foot, by bus, or on the escalators and funiculars that several of these towns have installed precisely because everyone has this problem.',
    'That is not a complaint, it is the plan. Accepting it means you can stop somewhere for two nights and walk up in the cool of the morning instead of circling a medieval gate at noon looking for a space that does not exist. It also means the stages here are short. Lucca to Florence is not a driving day, so the day is not spent driving.',
    'The route deliberately begins and ends away from Florence. Florence is on it — skipping it would be perverse — but it is one night in the middle, treated as the city it is, and the route is built around the smaller places on either side, which is where the hill-town landscape actually is. Siena and Pienza are the Tuscany of the photographs. Volterra is older than either of them and gets far fewer visitors, and it is where this route finishes on purpose.',
    'Our database holds between 24 and 42 campsites within 25 km of each of these stages, which is enough choice to matter and few enough that the good ones are known. Pienza has a campsite 155 metres from the coordinate we use for the town — the closest stage-to-campsite distance on any route in this library.',
  ],
  roads: 'Narrow, winding, walled and frequently one-way in the old centres, with signed ZTL restricted-traffic zones that a foreign plate will still be fined for entering. The valley roads between towns are easy. The last kilometre into any of these towns is the part to leave the van out of.',
  stages: [
    {
      name: 'Lucca',
      lat: 43.8430,
      lon: 10.5017,
      nights: 1,
      why: 'Start with the exception to the whole route: a walled town on flat ground, where the Renaissance ramparts were never demolished and are now a tree-lined park you can cycle the entire circuit of, about four kilometres around.',
      pois: [
        { name: 'Mura di Lucca', what: 'The intact sixteenth-century walls, now a raised circular promenade and cycle path' },
        { name: 'Piazza dell’Anfiteatro', what: 'An oval square whose shape is the Roman amphitheatre the houses were built into' },
        { name: 'Torre Guinigi', what: 'A medieval tower with mature oak trees growing on its roof' },
      ],
    },
    {
      name: 'Firenze',
      lat: 43.7696,
      lon: 11.2558,
      nights: 2,
      why: 'Two nights and no pretence that it is a hill town: park once on the edge, take the bus in twice, and treat it as the one city stop where the reason to be here is indoors and needs booking.',
      pois: [
        { name: 'Piazzale Michelangelo', what: 'The terrace above the south bank, and the one view that makes the city’s layout legible' },
        { name: 'Ponte Vecchio', what: 'The shop-lined bridge that survived the destruction of every other bridge in the city in 1944' },
        { name: 'Cattedrale di Santa Maria del Fiore', what: 'Brunelleschi’s dome, built without the centring that everyone at the time thought it needed' },
      ],
    },
    {
      name: 'Siena',
      lat: 43.3186,
      lon: 11.3306,
      nights: 1,
      why: 'The town that lost: Siena was Florence’s rival until plague and defeat froze it, which is exactly why its medieval centre survived so completely and why the shell-shaped square at its heart is unlike anything else in Italy.',
      pois: [
        { name: 'Piazza del Campo', what: 'The sloping shell-shaped square, and the racecourse for the Palio' },
        { name: 'Duomo di Siena', what: 'A striped marble cathedral with a floor of inlaid pictorial panels, uncovered only part of the year' },
        { name: 'Torre del Mangia', what: 'The tower on the Campo, climbable by a long internal stair' },
      ],
    },
    {
      name: 'Pienza',
      lat: 43.0775,
      lon: 11.6789,
      nights: 2,
      why: 'Two nights in the Val d’Orcia, because this is the landscape people actually come to Tuscany for, and because Pienza itself is a curiosity: a village rebuilt in the 1460s as a single planned Renaissance design by a pope who had been born there.',
      pois: [
        { name: 'Val d’Orcia', what: 'The cypress-lined ridge country south of Siena, listed by UNESCO as a designed agricultural landscape' },
        { name: 'Piazza Pio II', what: 'The small square that is the whole point of the fifteenth-century rebuilding — four buildings meant to be seen together' },
        { name: 'Bagno Vignoni', what: 'A village whose central square is a stone pool of thermal water instead of a piazza' },
      ],
    },
    {
      name: 'Volterra',
      lat: 43.4021,
      lon: 10.8608,
      nights: 1,
      why: 'Finish somewhere much older and much quieter: an Etruscan town on a high ridge, with walls and a gate that predate the Romans, and a hillside on one flank that is actively eroding and has been taking the edge of the town with it for centuries.',
      pois: [
        { name: 'Porta all’Arco', what: 'An Etruscan gate still standing in the later medieval wall' },
        { name: 'Teatro Romano', what: 'A first-century BC Roman theatre, best seen from the walls above it' },
        { name: 'Le Balze', what: 'The crumbling clay cliffs on the western edge, which have swallowed buildings' },
      ],
    },
  ],
  attribution:
    'Campsites beside each stage come from OpenStreetMap, re-imported weekly. Italy is entirely OpenStreetMap in our database — there is no national tourism feed here of the kind France has — so what you see is what volunteers have recorded, and the gaps are real gaps rather than sites we filtered out.',
  curatedAt: '2026-09-27',
};
