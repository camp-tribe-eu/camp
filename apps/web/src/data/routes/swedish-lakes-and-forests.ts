import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'se-lakes-forests',
  slug: 'swedish-lakes-and-forests',
  name: 'Swedish Lakes, Stockholm to Dalarna',
  countries: ['se'],
  region: 'Svealand',
  days: 9,
  months: [6, 7, 8],
  seasonNote:
    'June to August. July is when Sweden itself is on holiday and the lakeside sites are busiest; late June is midsummer, which is the single best week to be here and also the one week when a lot of the country stops working. September is beautiful and cold, and the seasonal sites start closing.',
  suits: ['wild-swimming', 'families', 'slow', 'van-conversion'],
  summary:
    'Nine days between Stockholm and the Dalarna lakes, through the country that gave Europe its clearest legal right to camp — and a route that explains exactly where that right stops applying to you.',
  intro: [
    'Allemansrätten, the right of public access, is the reason people come to Sweden with a tent, and it is also the most misunderstood thing about travelling here. The right is real and it is broad: you may walk, swim, pick berries and pitch a tent for a night on most uncultivated land without asking anyone. It is not a right to park a motorhome wherever you like. Vehicles are governed by road traffic law, not by allemansrätten, and a van parked overnight on a forest track is in a completely different legal position from a tent carried there on foot.',
    'That distinction runs through this whole route and it is worth getting right, because getting it wrong is how visitors end up resented in a country that is otherwise extraordinarily welcoming to campers. The practical shape of it: sleep on a site or in a marked parking area, and use the right of access for the walking, the swimming and the berry-picking, which is where it is genuinely generous.',
    'The landscape does not change dramatically over these nine days and that is the appeal. It is water and conifer and birch, over and over, at an enormous scale — Sweden has something over 95 000 lakes large enough to name, and this route threads between two of the biggest, Vänern and Siljan. The change you do notice is northward: by Dalarna the summer nights have stopped going properly dark, the villages are red-painted timber, and the folk traditions that the rest of the country treats as heritage are still in ordinary use.',
    'Campsite density here is the second-thinnest of any route in this library, after the Peloponnese — between 6 and 32 sites within 25 km of each stage, and only 6 around Uppsala. Swedish sites tend to be large, lakeside, well equipped and busy in July, and the gaps between them are long. This is a route to plan the fuel stops on.',
  ],
  roads: 'Excellent, empty two-lane roads through forest, with the two hazards that Swedish road signs keep warning you about and visitors keep underestimating: elk, which are large enough to come through a windscreen, and long dusk periods when they move. Distances between services are long.',
  stages: [
    {
      name: 'Stockholm',
      lat: 59.3293,
      lon: 18.0686,
      nights: 1,
      why: 'Start in a city built across fourteen islands where the lake meets the Baltic, and see the one thing you cannot see anywhere else: a seventeenth-century warship raised almost intact from the harbour mud.',
      pois: [
        { name: 'Vasamuseet', what: 'The warship Vasa, sunk on her maiden voyage in 1628 and raised in 1961, largely complete' },
        { name: 'Gamla stan', what: 'The old town on its own island, medieval street plan intact' },
        { name: 'Stockholms skärgård', what: 'The archipelago east of the city — tens of thousands of islands, served by public boats' },
      ],
    },
    {
      name: 'Örebro',
      lat: 59.2753,
      lon: 15.2134,
      nights: 1,
      why: 'A castle on an island in the middle of a town, and the right place to break the drive west — also the gateway to Kilsbergen, the low forested ridge that is the first properly empty country on this route.',
      pois: [
        { name: 'Örebro slott', what: 'A moated castle on an islet in the Svartån, in the centre of the town' },
        { name: 'Wadköping', what: 'A collection of relocated timber buildings forming a preserved old quarter' },
        { name: 'Kilsbergen', what: 'The forested ridge west of the town, with walking and small lakes' },
      ],
    },
    {
      name: 'Karlstad',
      lat: 59.3793,
      lon: 13.5036,
      nights: 2,
      why: 'Two nights on the northern shore of Vänern, which is the largest lake in the European Union and big enough that the far side is below the horizon — this is the stage for getting in the water.',
      pois: [
        { name: 'Vänern', what: 'The EU’s largest lake, with an archipelago of its own off this shore' },
        { name: 'Mariebergsskogen', what: 'A lakeside park on the edge of the city' },
        { name: 'Klarälven', what: 'The river that enters the lake here, once used for floating timber down from the north' },
      ],
    },
    {
      name: 'Mora',
      lat: 61.0058,
      lon: 14.5381,
      nights: 1,
      why: 'The northern turning point, at the top of Lake Siljan — a crater lake formed by a meteorite impact, and the heart of the Dalarna traditions that most visitors only meet as a painted wooden horse.',
      pois: [
        { name: 'Siljan', what: 'The lake in the ring of a 377-million-year-old impact crater' },
        { name: 'Zornmuseet', what: 'The museum of the painter Anders Zorn, in the town he came from' },
        { name: 'Nusnäs', what: 'The village where the carved Dala horses are actually made' },
      ],
    },
    {
      name: 'Leksand',
      lat: 60.7299,
      lon: 14.9995,
      nights: 2,
      why: 'Two nights at the southern end of the same lake, because this is where the midsummer celebrations are largest and where the traditional timber villages around the shore are worth a slow day rather than a drive-through.',
      pois: [
        { name: 'Leksands kyrka', what: 'The lakeside church with an onion dome, above the water' },
        { name: 'Sommarland', what: 'The reason families with children end up here in July' },
        { name: 'Tällberg', what: 'A village of timber houses on the slope above Siljan, looking down the lake' },
      ],
    },
    {
      name: 'Uppsala',
      lat: 59.8586,
      lon: 17.6389,
      nights: 1,
      why: 'Finish in the old ecclesiastical and university capital, with Scandinavia’s largest cathedral and, four kilometres north, the burial mounds of the kings who ruled here before any of it.',
      pois: [
        { name: 'Uppsala domkyrka', what: 'The largest church in Scandinavia, and the burial place of Gustav Vasa and Linnaeus' },
        { name: 'Gamla Uppsala', what: 'Royal burial mounds from the sixth century, on the plain north of the city' },
        { name: 'Linnéträdgården', what: 'Linnaeus’s own botanical garden, replanted to his 1745 layout' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Sweden is OpenStreetMap-only in our database, which means the large commercial lakeside sites are well recorded and the small municipal ones are patchy — the gaps on this route are likelier to be mapping gaps than empty ground.',
  curatedAt: '2026-09-27',
};
