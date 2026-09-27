import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'gr-peloponnese',
  slug: 'peloponnese-loop',
  name: 'The Peloponnese, Nafplio to Olympia',
  countries: ['gr'],
  region: 'Peloponnese',
  days: 9,
  months: [4, 5, 6, 9, 10],
  seasonNote:
    'April to June and September to October, and the constraint is not comfort but the archaeology. The sites on this route are open, unshaded stone in full sun, and walking round Mycenae or Olympia in a Greek July afternoon is a genuinely bad idea rather than merely a hot one. In May the same walk is pleasant and the sea is already swimmable.',
  suits: ['history', 'wild-swimming', 'off-season', 'slow'],
  summary:
    'Nine days round the southern peninsula of Greece, where every stage is ruins in the morning and a swim in the afternoon — and where the thinnest campsite data in this library is a fact about the ground, not about us.',
  intro: [
    'The Peloponnese is where Greek history is densest and Greek tourism is thinnest, which is an unusual combination and the whole argument for this route. Mycenae, Epidaurus, Sparta, Olympia and Messene are all on this peninsula, within a few hours of one another, and none of them carries anything like the crowds of Athens or Santorini. You can stand in the stadium at Olympia in May with a handful of other people in it.',
    'The rhythm of the week writes itself and it is the opposite of a beach holiday’s. Start early, be at the site by eight or nine while the stone is still cool, be finished by noon, and spend the afternoon in the sea — which on this coast is warm from May and clear almost everywhere. Trying to do it the other way round is how people end up remembering Greek archaeology as an ordeal.',
    'Be honest about the campsite picture before you commit, because this route has the thinnest coverage in the library. Our database holds only 2 campsites within 25 km of Mystras and 4 around Olympia, against 19 at Nafplio and 13 at Pylos. Greece as a whole gives us 625 sites. Some of that is genuine — the interior is mountainous, empty and not set up for this — and some of it is mapping: Greek campsites are less thoroughly recorded in OpenStreetMap than Dutch or Croatian ones. Either way, the two inland stages need to be planned rather than improvised.',
    'The peninsula is also more mountainous than people expect. The Taygetos range behind Sparta runs to well over 2 000 metres, the roads over it are serious, and the three southern prongs — Messenian, Mani and the eastern cape — are separated by them rather than by distance. This route deliberately stays on one side and ends inland rather than trying to loop all three in nine days.',
  ],
  roads: 'A modern toll motorway across the north and then a great deal of narrow mountain road, some of it with no barrier and a long drop. Village streets in the Mani are stone-walled and tight. Fuel is in the towns; assume nothing on the mountain sections, including phone signal.',
  stages: [
    {
      name: 'Nafplio',
      lat: 37.5675,
      lon: 22.8079,
      nights: 2,
      why: 'Two nights in the first capital of independent Greece — a Venetian-built harbour town under two fortresses, and the base for the two greatest sites in the Argolid, both within half an hour.',
      pois: [
        { name: 'Palamidi', what: 'The Venetian fortress on the rock above the town, reached by a long flight of steps' },
        { name: 'Mycenae', what: 'The Bronze Age citadel with the Lion Gate, inland from here' },
        { name: 'Epidaurus', what: 'A fourth-century BC theatre with acoustics that still work, still used for performances' },
      ],
    },
    {
      name: 'Mystras',
      lat: 37.0714,
      lon: 22.3678,
      nights: 1,
      why: 'One night under the Byzantine city on the flank of Taygetos — a whole abandoned late-medieval town of churches, palaces and lanes climbing a hillside, which is a completely different Greece from the classical one either side of it.',
      pois: [
        { name: 'Mystras', what: 'A Byzantine fortified town abandoned in the nineteenth century, its painted churches still standing' },
        { name: 'Sparti', what: 'Modern Sparta on the plain below, with very little of the ancient city left to see' },
        { name: 'Taygetos', what: 'The range behind, rising above 2 400 metres, with a long-distance path over it' },
      ],
    },
    {
      name: 'Gytheio',
      lat: 36.7554,
      lon: 22.5661,
      nights: 2,
      why: 'Two nights at the top of the Mani, in a working port with a tiny island joined by a causeway and a shipwreck on the beach outside town — and the point from which the tower villages of the peninsula are a day trip rather than a commitment.',
      pois: [
        { name: 'Mani Peninsula', what: 'The middle southern prong, with fortified stone tower houses in the villages' },
        { name: 'Diros Caves', what: 'A flooded cave system south of here, visited by boat along an underground river' },
        { name: 'Cape Tainaron', what: 'The southernmost point of mainland Greece, with a lighthouse walk at the end of a track' },
      ],
    },
    {
      name: 'Pylos',
      lat: 36.9140,
      lon: 21.6966,
      nights: 1,
      why: 'A bay with a naval battle in it and a Mycenaean palace above it — and Voidokilia, a beach in an almost perfect circle that is genuinely worth a detour on a coast full of good ones.',
      pois: [
        { name: 'Palace of Nestor', what: 'The best-preserved Mycenaean palace, where the Linear B archive was found' },
        { name: 'Voidokilia', what: 'A near-circular sand bay backed by a lagoon, with a Frankish castle on the headland' },
        { name: 'Navarino Bay', what: 'The natural harbour where the 1827 battle was fought' },
      ],
    },
    {
      name: 'Olympia',
      lat: 37.6440,
      lon: 21.6300,
      nights: 2,
      why: 'Finish with two nights inland at the site the whole peninsula is best known for, so that you can be in the sanctuary at opening and still have a day for the museum — which holds the sculpture the site itself no longer has.',
      pois: [
        { name: 'Ancient Olympia', what: 'The sanctuary and stadium where the games were held for a thousand years' },
        { name: 'Archaeological Museum of Olympia', what: 'The pediment sculpture from the temple of Zeus, and the Hermes of Praxiteles' },
        { name: 'Alfeios valley', what: 'The river valley the sanctuary sits in, green in a way the coast is not' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Greece is among the more thinly mapped countries in our database, so on this route in particular the absence of a campsite from the map is weak evidence that there is none — it is worth checking locally as well as here.',
  curatedAt: '2026-09-27',
};
