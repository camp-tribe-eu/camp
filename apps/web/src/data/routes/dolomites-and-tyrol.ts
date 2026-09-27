import type { CuratedRoute } from '@/lib/route-types';

export const route: CuratedRoute = {
  id: 'alps-dolomites-tyrol',
  slug: 'dolomites-and-tyrol',
  name: 'The Alps Without Switzerland: Tyrol and the Dolomites',
  countries: ['at', 'it'],
  region: 'Tirol, Südtirol and Belluno',
  days: 7,
  months: [6, 7, 8, 9],
  seasonNote:
    'June to September, and the boundaries are hard rather than soft. The high passes this route uses carry snow gates and several do not open until late May or early June; by mid-October they begin to close again. A week planned for May here is a week of valley roads and closed signs.',
  suits: ['hikers', 'large-motorhome', 'wild-swimming', 'slow'],
  summary:
    'A seven-day mountain week through Austrian Tyrol and the Italian Dolomites, planned around the one thing that actually governs alpine travel: which passes are open and how high you are sleeping.',
  intro: [
    'The card that started this library asked for an Alps route. It is worth being precise about what that can mean for us: our database covers the EU-27, and Switzerland is not in it. There is not one Swiss campsite in our records — not because Switzerland has none, but because it is outside the scope the project decided on. So this is the Alps as the European Union holds them, which is Austria, the Italian Dolomites, and the German and Slovenian edges. It is not a lesser version. The Dolomites are limestone rather than granite, they are vertical in a way the western Alps are not, and they are the part of the range a first visit should see anyway.',
    'Altitude is the organising fact of this week. It decides the temperature you sleep at — a valley campsite at 600 metres and a pass at 2 200 metres are different climates on the same afternoon — and it decides where a large vehicle can and cannot go. Several of the roads connecting these stages are engineered hairpin passes with length restrictions, and a long motorhome with a trailer is genuinely excluded from some of them rather than merely uncomfortable.',
    'The route crosses a language border in the middle of it, twice, without crossing much of a cultural one. South Tyrol is Italian territory where German is the first language of most of the population, so Bressanone is also Brixen and the menu changes before the country does. The stages are ordered so that the crossing happens on a main valley road rather than a pass, which matters if the weather turns.',
    'Campsite density is good and evenly spread: between 23 and 45 sites within 25 km of every stage in our data. What varies is altitude, and the route notes it where it matters, because a site at 1 400 metres in mid-September is a genuinely cold night in a van without heating.',
  ],
  roads: 'Engineered mountain roads — wide, well surfaced, and relentlessly steep and twisting, with hairpins signed for vehicle length on several passes. Descending is the part that punishes a heavy vehicle: use the gears, not the brakes. Check pass status the morning you drive it, not the week before.',
  stages: [
    {
      name: 'Innsbruck',
      lat: 47.2692,
      lon: 11.4041,
      nights: 1,
      why: 'Start in the valley city that the whole range funnels through — a compact old town with a mountain wall directly behind it, and a funicular from the centre that puts you above 2 000 metres inside half an hour.',
      pois: [
        { name: 'Goldenes Dachl', what: 'A late-Gothic balcony roofed with thousands of gilded copper tiles' },
        { name: 'Nordkettenbahnen', what: 'The cable railway from the city centre up onto the Nordkette ridge' },
        { name: 'Bergisel', what: 'The ski jump above the city, rebuilt by Zaha Hadid, open outside competitions' },
      ],
    },
    {
      name: 'Brixen / Bressanone',
      lat: 46.7154,
      lon: 11.6567,
      nights: 1,
      why: 'Cross into Italy without noticing it: an old episcopal town in the Eisack valley where the architecture is Tyrolean, the street signs are bilingual, and the surrounding orchards are the first sign you are on the southern side of the range.',
      pois: [
        { name: 'Dom von Brixen', what: 'The cathedral, with a Romanesque cloister painted in the fourteenth and fifteenth centuries' },
        { name: 'Plose', what: 'The mountain above the town, with a cable car and high meadow walking' },
        { name: 'Kloster Neustift', what: 'A twelfth-century Augustinian abbey just north of the town, still working, with vineyards' },
      ],
    },
    {
      name: 'Cortina d’Ampezzo',
      lat: 46.5405,
      lon: 12.1357,
      nights: 2,
      why: 'Two nights in the middle of the limestone, because this is the base for the Dolomites proper and because the drive in over the passes is long enough that arriving and leaving on the same day wastes it.',
      pois: [
        { name: 'Tre Cime di Lavaredo', what: 'Three near-vertical limestone towers with a circuit path around their base' },
        { name: 'Lago di Misurina', what: 'A lake below the Sorapiss massif, on the road towards the Tre Cime' },
        { name: 'Cinque Torri', what: 'A cluster of rock towers with preserved First World War positions among them' },
      ],
    },
    {
      name: 'Canazei',
      lat: 46.4769,
      lon: 11.7700,
      nights: 1,
      why: 'The highest stage on the route, at the head of the Val di Fassa and the junction of four famous passes — which is exactly why it is a single night: it is a place to be positioned, not a place to settle.',
      pois: [
        { name: 'Passo Pordoi', what: 'The pass east of the village, with a cable car to the Sass Pordoi plateau above it' },
        { name: 'Marmolada', what: 'The highest peak in the Dolomites, and the one whose glacier is visibly and rapidly retreating' },
        { name: 'Passo Sella', what: 'The pass under the Sassolungo, with high walking straight from the road' },
      ],
    },
    {
      name: 'Lienz',
      lat: 46.8295,
      lon: 12.7687,
      nights: 1,
      why: 'Come down and finish back in Austria where the Drau valley opens out — a warmer, lower, gentler end to the week, with a Roman town under the fields outside it.',
      pois: [
        { name: 'Aguntum', what: 'The excavated Roman municipium just east of the town' },
        { name: 'Schloss Bruck', what: 'The medieval castle above Lienz, now the town museum' },
        { name: 'Nationalpark Hohe Tauern', what: 'The national park north of here, the largest in the Alps' },
      ],
    },
  ],
  attribution:
    'Campsites come from OpenStreetMap under the Open Database License. Alpine campsites are seasonal in a way our data does not record: we can tell you a site exists and where it is, and we cannot tell you whether it opens before June.',
  curatedAt: '2026-09-27',
};
