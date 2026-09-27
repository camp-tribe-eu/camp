import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'ie-waw-southwest',
  slug: 'wild-atlantic-way-cork-to-the-burren',
  name: 'The Wild Atlantic Way, Kinsale to the Burren',
  countries: ['ie'],
  region: 'Cork, Kerry and Clare',
  days: 7,
  months: [5, 6, 7, 8, 9],
  seasonNote:
    'May to September. Not because of temperature — Ireland barely has one, the sea moderates everything to a narrow band — but because of daylight and opening. In June you get light until half past ten at night; in November you get it until four, the peninsula roads are dark and wet, and most of the campsites on this route are closed.',
  suits: ['van-conversion', 'hikers', 'slow', 'wild-swimming'],
  summary:
    'Seven days around the southwest peninsulas, on a route where the width of the road and not the distance decides how far you get in a day.',
  intro: [
    'The single most useful thing to understand about driving in the Irish southwest is that the distances are trivial and the days are still long. Every stage on this route is a short hop on the map. In practice each one takes far longer than it should, because the roads are single-track with passing places, hedged to head height on both sides so you cannot see round anything, and shared with tour coaches that go one way round the famous loops by convention.',
    'This has a practical consequence for the vehicle. A large motorhome on the Ring of Kerry or the Beara peninsula is not impossible, but it is a job rather than a drive, and there are stretches where reversing a long vehicle to a passing place is the price of meeting a coach. A van conversion is the right tool here in a way that is not true of the Danube or the French Atlantic. This route is tagged accordingly, and it is the only one in the library where the vehicle recommendation is a real restriction rather than a preference.',
    'The weather deserves the same honesty. It rains here, frequently, in every month, and a week without rain would be remarkable. But it rains in bands that move through, so the useful skill is not avoiding it but reading it: a wet morning is very often a clear afternoon, and the light after a front goes through is the reason people photograph this coast so obsessively.',
    'Campsite provision is thin and clustered — our database holds between 8 and 35 sites within 25 km of each stage, and the nearest campsite to Kenmare is more than fifteen kilometres away, the largest stage-to-campsite gap anywhere in this library. Ireland has 519 campsites in our records in total — fewer than the single French département of Charente-Maritime, which has 643. Book, or at least ring ahead.',
  ],
  roads: 'Single-track lanes with passing places, high hedges, blind bends and oncoming coaches, plus the left-hand driving that catches out anyone arriving from the continent. The N-roads between towns are fine. Everything on a peninsula is not. Fuel and water are in the towns, not on the loops.',
  stages: [
    {
      name: 'Kinsale',
      lat: 51.7059,
      lon: -8.5222,
      nights: 1,
      why: 'Start somewhere sheltered and civilised before the road gets hard: a narrow-streeted harbour town at the mouth of the Bandon, with two star forts guarding the estuary and a food reputation out of all proportion to its size.',
      pois: [
        { name: 'Charles Fort', what: 'A late-seventeenth-century star fort on the eastern shore of the harbour' },
        { name: 'Old Head of Kinsale', what: 'The headland where the Lusitania was sunk offshore in 1915' },
        { name: 'Desmond Castle', what: 'A fifteenth-century urban tower house in the middle of the town' },
      ],
    },
    {
      name: 'Bantry',
      lat: 51.6808,
      lon: -9.4534,
      nights: 1,
      why: 'The gateway to the wildest of the peninsulas, on a long sheltered bay where a French invasion fleet anchored in 1796 and was driven off by the weather rather than by anyone defending it.',
      pois: [
        { name: 'Bantry House', what: 'A house above the bay with terraced gardens looking down the water' },
        { name: 'Beara Peninsula', what: 'The least-visited of the southwestern peninsulas, with a cable car to Dursey Island at the end of it' },
        { name: 'Garnish Island', what: 'An island garden in Glengarriff harbour, reached by boat past a seal colony' },
      ],
    },
    {
      name: 'Kenmare',
      lat: 51.8806,
      lon: -9.5836,
      nights: 1,
      why: 'A planned eighteenth-century town at the head of its own bay, sitting at the junction of the Ring of Kerry and the Beara road — useful positioning, and the one stage where the nearest campsite in our data is a real drive away.',
      pois: [
        { name: 'Kenmare Stone Circle', what: 'A Bronze Age circle on the edge of the town, with a large boulder burial at its centre' },
        { name: 'Gleninchaquin Park', what: 'A private glacial valley with a waterfall, up a dead-end road off the bay' },
        { name: 'Molls Gap', what: 'The pass north towards Killarney, and the view down into the lakes' },
      ],
    },
    {
      name: 'Killarney',
      lat: 52.0599,
      lon: -9.5044,
      nights: 1,
      why: 'The busiest stop on the route and worth it for one reason: the national park behind the town has the largest remaining native oak woodland in Ireland, and you can walk or cycle into it directly from the edge of the campsites.',
      pois: [
        { name: 'Killarney National Park', what: 'Lakes, native oakwood and Ireland’s only wild native red deer herd' },
        { name: 'Muckross House', what: 'A Victorian house on the middle lake, with the estate open to walkers and cyclists' },
        { name: 'Gap of Dunloe', what: 'A narrow glacial breach between the Reeks and the Purple Mountain, closed to through traffic' },
      ],
    },
    {
      name: 'Dingle',
      lat: 52.1409,
      lon: -10.2687,
      nights: 1,
      why: 'A working fishing harbour in an Irish-speaking district, and the base for the one loop on this route that everyone agrees is better than the famous one — Slea Head, with early Christian stone huts standing in the fields beside the road.',
      pois: [
        { name: 'Slea Head Drive', what: 'The loop round the end of the peninsula, with the Blasket Islands offshore' },
        { name: 'Gallarus Oratory', what: 'A dry-stone corbelled church, still watertight after a very long time' },
        { name: 'Blasket Islands', what: 'Islands evacuated in 1953, with a literature of their own written by the people who left' },
      ],
    },
    {
      name: 'Doolin',
      lat: 53.0153,
      lon: -9.3800,
      nights: 1,
      why: 'Finish on the edge of the Burren, a bare limestone pavement full of Arctic and Mediterranean plants growing in the same cracks — a landscape that looks like nothing else in the country, with the Cliffs of Moher at its southern end.',
      pois: [
        { name: 'The Burren', what: 'A karst plateau of bare limestone pavement, with a famously improbable mix of flora' },
        { name: 'Cliffs of Moher', what: 'Sea cliffs running eight kilometres south of Doolin, with a clifftop walk between the two' },
        { name: 'Poulnabrone', what: 'A portal tomb standing on the open pavement, dated to the Neolithic' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Ireland is one of the thinner countries in our database — 519 sites in total — so the absence of a campsite from a stretch of this coast may mean nobody has mapped it rather than that nothing is there.',
  curatedAt: '2026-09-27',
};
