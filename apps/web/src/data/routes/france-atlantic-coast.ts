import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'fr-atlantic-coast',
  slug: 'france-atlantic-coast',
  name: 'The French Atlantic, La Rochelle to Biarritz',
  countries: ['fr'],
  region: 'Nouvelle-Aquitaine',
  days: 10,
  months: [5, 6, 7, 8, 9],
  seasonNote:
    'The coast works from May to September, but July and August are a different trip: this is where a large share of France goes on holiday at once, and the seaside municipal sites fill weeks ahead. May, June and the first half of September are the same beaches with somewhere to park.',
  suits: ['first-trip', 'families', 'surfers', 'van-conversion'],
  summary:
    'Ten days down one long beach, from a walled harbour town through the oyster islands to the Basque surf, with the biggest concentration of campsites in Europe on either side of you.',
  intro: [
    'This is the easiest drive in this library and the hardest one to get a pitch on. The road south from La Rochelle barely climbs, the sea is on your right for nine days, and the campsites are so thick on the ground that our database holds 223 within 25 km of La Rochelle alone and 300 around the Île d’Oléron — more than some of the other routes here have in an entire country.',
    'That density is the point and also the trap. Abundance in the data is not availability in August: the coastal sites are the ones every French family books in February, and a plan that assumes you will find something at six in the evening is a plan to sleep in an inland car park. The routes here do not book anything for you, and we do not know what any of these sites charge or whether they have a space — what we can tell you is where they are, which ones are municipal, and which are the bare aires de camping-car that exist precisely for the night you got it wrong.',
    'The landscape changes less than the map suggests and more than you expect. North of the Gironde it is flat oyster country, low and tidal and mostly about water. South of Arcachon you enter the Landes — not a natural forest but a planted one, maritime pine sown from the middle of the nineteenth century to fix shifting dunes and drain the marsh behind them, and it runs almost unbroken for 200 kilometres. Then the ground finally tilts, the Pyrenees appear in the windscreen, and the last two stages are Basque rather than French in a way you can hear in the place names.',
    'Take bicycles. The Vélodyssée cycle route shadows this entire coast on its own tarmac, and from most of these stages the beach is a flat twenty-minute ride away — which matters, because parking a motorhome at a French Atlantic beach in August is its own small war.',
  ],
  roads: 'Flat, straight and easy, with one real constraint: the coastal access roads through the dunes are narrow, one-way in places, and lined with height barriers at the beach car parks. Nothing here needs mountain driving; everything here needs a plan for where the van sleeps.',
  stages: [
    {
      name: 'La Rochelle',
      lat: 46.1603,
      lon: -1.1511,
      nights: 1,
      why: 'Start in the one town on this coast that was a city before it was a resort — a walled Atlantic port whose harbour mouth is still guarded by two medieval towers, and the only stage where the evening is about stone rather than sand.',
      pois: [
        { name: 'Tour Saint-Nicolas and Tour de la Chaîne', what: 'The pair of fourteenth-century towers that a chain was once slung between to close the old harbour at night' },
        { name: 'Vieux-Port', what: 'The old harbour, which is still the centre of the town rather than a preserved quarter beside it' },
        { name: 'Île de Ré', what: 'A low, white-shuttered island reached by a long toll bridge, flat enough to be cycled end to end' },
      ],
    },
    {
      name: 'Le Château-d’Oléron',
      lat: 45.8853,
      lon: -1.1972,
      nights: 2,
      why: 'Two nights because Oléron is a place to stop moving: a big, low island reached by a free bridge, where the interesting part is the tidal oyster country on the eastern shore rather than the surf beaches everyone drives to on the west.',
      pois: [
        { name: 'Cabanes colorées du Château-d’Oléron', what: 'The painted oyster huts along the channel, now mostly workshops, still next to working beds' },
        { name: 'Citadelle du Château-d’Oléron', what: 'A seventeenth-century coastal fort with ramparts you can walk' },
        { name: 'Marais aux oiseaux', what: 'Reclaimed salt marsh in the middle of the island, and the reason the birdlife here is worth the detour inland' },
      ],
    },
    {
      name: 'Royan',
      lat: 45.6285,
      lon: -1.0281,
      nights: 1,
      why: 'A town worth one night for an unusual reason: it was destroyed by bombing in January 1945 and rebuilt in the 1950s, so it is a rare chance to see a whole French seaside resort designed in one go, in concrete, by people who believed in it.',
      pois: [
        { name: 'Église Notre-Dame de Royan', what: 'A reinforced-concrete church completed in 1958 to Guillaume Gillet’s design — the building the reconstruction is remembered for' },
        { name: 'Le Front de Mer', what: 'The seafront terrace, rebuilt as a single 1950s composition rather than a row of older villas' },
      ],
    },
    {
      name: 'Arcachon',
      lat: 44.6580,
      lon: -1.1680,
      nights: 2,
      why: 'The one stage where the coast does something dramatic: a shallow tidal basin full of oyster frames on one side, and on the other the Dune du Pilat, a wall of sand high enough to climb and slowly moving inland over the pine forest behind it.',
      pois: [
        { name: 'Dune du Pilat', what: 'The largest sand dune in Europe, walkable from the car park below, migrating landward year by year' },
        { name: 'Bassin d’Arcachon', what: 'A near-enclosed tidal basin — at low water most of it is not sea at all' },
        { name: 'Ville d’Hiver', what: 'The nineteenth-century “winter town” of villas built up the hill behind Arcachon for people sent here to breathe the pine air' },
      ],
    },
    {
      name: 'Mimizan',
      lat: 44.2011,
      lon: -1.2294,
      nights: 1,
      why: 'One night deep in the Landes pine, because this is the stretch that explains the region: 200 kilometres of planted forest, ruler-straight firebreak tracks, and a beach at the end of a road through the trees.',
      pois: [
        { name: 'Courant de Mimizan', what: 'The slow channel that drains the inland lakes to the sea — canoe country rather than swimming country' },
        { name: 'Forêt des Landes', what: 'The planted maritime-pine forest begun in the nineteenth century to stabilise the dunes and drain the marsh' },
      ],
    },
    {
      name: 'Soorts-Hossegor',
      lat: 43.6639,
      lon: -1.4283,
      nights: 1,
      why: 'The surf stage, and honestly so: the beach breaks here are heavy, shifting sandbanks that have hosted world-tour events, which is another way of saying this is not the beach to teach a child to swim at.',
      pois: [
        { name: 'Lac d’Hossegor', what: 'A saltwater lake that fills and empties with the tide — the safe swimming the ocean beaches here are not' },
        { name: 'La Gravière', what: 'The sandbank break the town is known for among surfers' },
      ],
    },
    {
      name: 'Biarritz',
      lat: 43.4832,
      lon: -1.5586,
      nights: 1,
      why: 'Finish where the coast finally has cliffs and the Pyrenees show up behind them — a resort with an imperial past, a rocky shoreline, and the beach where European surfing effectively started in the 1950s.',
      pois: [
        { name: 'Rocher de la Vierge', what: 'A sea rock joined to the headland by a footbridge, out in the swell' },
        { name: 'Côte des Basques', what: 'The long beach under the cliff where surfing in Europe took hold' },
        { name: 'Grande Plage', what: 'The town beach, below the promenade and the old casino' },
      ],
    },
  ],
  attribution:
    'The campsites beside each stage come from our own database, which on this coast is fed by both OpenStreetMap and DATAtourisme — France is the only country on these routes where a national tourism platform contributes records, and it is also why French sites here carry an official star classification when they have one.',
  curatedAt: '2026-09-27',
};
