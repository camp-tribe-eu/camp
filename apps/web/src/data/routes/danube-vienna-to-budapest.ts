import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'danube-vienna-budapest',
  slug: 'danube-vienna-to-budapest',
  name: 'Down the Danube, Vienna to Budapest',
  countries: ['at', 'sk', 'hu'],
  region: 'The Danube valley',
  days: 7,
  months: [4, 5, 6, 7, 8, 9, 10],
  seasonNote:
    'April to October, and it is the longest usable season of any route in this library because nothing here depends on a pass being open or a sea being warm. High summer is fine — this is a river valley, not a Mediterranean coast — and the two best months are probably May, when the meadows are up, and late September, when the light along the Danube Bend is at its best.',
  suits: ['cyclists', 'families', 'history', 'first-trip'],
  summary:
    'A short, flat, three-country week between two imperial capitals, designed around the fact that the best way to travel this valley is not actually by road.',
  intro: [
    'This is the only route in the library where the van is the support vehicle rather than the point. The EuroVelo 6 cycle path runs the whole length of this valley on dedicated, almost entirely flat tarmac, separated from traffic for most of it, and it is one of the busiest long-distance cycle routes in Europe for good reason. The sensible way to do this week is to drive a short hop each morning, park, and ride.',
    'Which means the stages here are close together on purpose. This is the shortest route in this library by distance and it has as many stages as routes twice its length — that is not padding, it is the design. Every stage is a place to leave the vehicle for a day, and the interesting ground between them is covered on two wheels rather than four.',
    'Three countries in seven days, and unusually for Europe they are genuinely different from one another on the same river. Vienna is monumental and orderly. Bratislava is forty minutes downstream, was a Hungarian coronation city for centuries, spent fifty years behind the Iron Curtain, and has an old town the size of a large village under a castle on a rock. Hungary begins in flat farmland and ends with the river turning sharply south through wooded hills at the Danube Bend, which is the prettiest stretch of the whole week and the one most people miss because it is not on the motorway.',
    'Campsite provision is solid and well distributed — between 19 and 54 sites within 25 km of each stage in our records, with the highest count around Szentendre because it is effectively Budapest’s weekend hinterland. This is also the one route here where you will find genuinely good municipal riverside sites, a central European habit that the Atlantic coast has largely lost.',
  ],
  roads: 'Flat, easy and unremarkable — this is the least demanding driving in the library. Two things to know: Austria, Slovakia and Hungary each require their own motorway vignette or e-toll, bought separately, and the old centres of Bratislava, Szentendre and Budapest are tight, cobbled and not places to take a long vehicle.',
  stages: [
    {
      name: 'Wien',
      lat: 48.2082,
      lon: 16.3738,
      nights: 1,
      why: 'Start at the imperial end of the river, where the Danube has been engineered into straight channels and an artificial island, and where a single night is enough because the city deserves a separate trip rather than a rushed one.',
      pois: [
        { name: 'Donauinsel', what: 'A 21-kilometre artificial island built as flood defence and now the city’s swimming and cycling strip' },
        { name: 'Schloss Schönbrunn', what: 'The Habsburg summer palace and its gardens on the western edge of the city' },
        { name: 'Nationalpark Donau-Auen', what: 'The floodplain forest downstream — one of the last largely unregulated stretches of the river in central Europe' },
      ],
    },
    {
      name: 'Bratislava',
      lat: 48.1486,
      lon: 17.1077,
      nights: 1,
      why: 'Barely an hour downstream and an entirely different country: a compact baroque old town under a square white castle, and the only capital in the world that borders two other states.',
      pois: [
        { name: 'Bratislavský hrad', what: 'The rebuilt castle on the rock above the river' },
        { name: 'Devín', what: 'A ruined fortress where the Morava meets the Danube, on what was the Iron Curtain frontier' },
        { name: 'Modrý kostolík', what: 'A small, entirely blue Art Nouveau church east of the old town' },
      ],
    },
    {
      name: 'Győr',
      lat: 47.6875,
      lon: 17.6504,
      nights: 1,
      why: 'The first Hungarian stop, at the meeting of three rivers, with a baroque old town that almost no foreign visitor stops for and that is all the better for it.',
      pois: [
        { name: 'Káptalandomb', what: 'The cathedral hill above the confluence, the oldest part of the town' },
        { name: 'Pannonhalmi Főapátság', what: 'A Benedictine abbey founded in 996 on a hill south of the town, still a working monastery and school' },
      ],
    },
    {
      name: 'Esztergom',
      lat: 47.7855,
      lon: 18.7405,
      nights: 1,
      why: 'Hungary’s ecclesiastical capital and the start of the Danube Bend, with the largest church in the country on a hill above the river and a bridge across to Slovakia that was left broken from 1944 until 2001.',
      pois: [
        { name: 'Esztergomi bazilika', what: 'The country’s largest church, on the hill above the river' },
        { name: 'Mária Valéria híd', what: 'The bridge to Štúrovo in Slovakia, destroyed in the war and only rebuilt in 2001' },
        { name: 'Dunakanyar', what: 'The Danube Bend, where the river turns sharply south between wooded hills' },
      ],
    },
    {
      name: 'Szentendre',
      lat: 47.6695,
      lon: 19.0755,
      nights: 1,
      why: 'A small riverside town of Serbian orthodox churches and steep lanes, close enough to Budapest to be its weekend escape, which makes it the right place to sleep before the city rather than in it.',
      pois: [
        { name: 'Szabadtéri Néprajzi Múzeum', what: 'An open-air museum of rebuilt village buildings from across Hungary' },
        { name: 'Belgrád székesegyház', what: 'The Serbian Orthodox cathedral, from the community that settled here in the seventeenth century' },
        { name: 'Visegrád', what: 'A hilltop citadel upstream, over the sharpest point of the Bend' },
      ],
    },
    {
      name: 'Budapest',
      lat: 47.4979,
      lon: 19.0402,
      nights: 1,
      why: 'Finish in the one European capital whose defining feature is that it is two cities on opposite banks — hilly Buda and flat Pest — and where the correct end to a week on the river is a thermal bath.',
      pois: [
        { name: 'Széchenyi fürdő', what: 'A large outdoor thermal bath complex, open year round and hot enough to sit in in winter' },
        { name: 'Budai Várnegyed', what: 'The castle quarter on the Buda hill, above the river' },
        { name: 'Országház', what: 'The parliament building on the Pest bank, best seen from the opposite side' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Austria, Slovakia and Hungary are all OpenStreetMap-only in our database, so the record for a municipal riverside site is whatever a volunteer last wrote down.',
  curatedAt: '2026-09-27',
};
