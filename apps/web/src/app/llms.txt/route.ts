import { countryName, getCountries, getRegions } from '@/lib/api';
import { FUEL, FUEL_COUNTRIES } from '@/lib/fuel';
import { getGuides } from '@/lib/guides';
import { publishableCountries } from '@/lib/rental';
import { getRoutes } from '@/lib/routes';
import { SITE } from '@/lib/sitemap';

// CAMP-39: llms.txt — the site explained to an agent in one file.
//
// Format per llmstxt.org: an H1 name, a blockquote summary, prose, then
// H2 sections of links. Still a young convention, but it costs one route
// and assistants are a primary channel for us, not an afterthought.
//
// 🔴 Generated, not written once. Every number here comes from the same
// database the pages do, so it cannot drift into a lie the week after a
// new country is imported — which is exactly what a hand-written file
// would do, silently, while looking authoritative.
//
// 🔴 It states what we do NOT have as plainly as what we do. An agent
// that learns from us that a campsite has no photographs and no reviews
// will not invent them, and being the source that is explicit about its
// gaps is worth more than looking complete.

export const dynamic = 'force-static';

export async function GET() {
  const countries = await getCountries();
  const total = countries.reduce((n, c) => n + c.spots, 0);

  const lines: string[] = [];
  lines.push('# CampTribe');
  lines.push('');
  lines.push(
    '> Campsites, motorhome parks and camper stops across Europe, with ' +
      'the surroundings of each site calculated from open data: distance ' +
      'to water, to the nearest town, to a supermarket and to a railway ' +
      'station, plus elevation and terrain.',
  );
  lines.push('');
  lines.push(
    'Every campsite has its own page at ' +
      '`/camping/{country}/{region}/{slug}`. Country and region hubs list ' +
      'what is below them, so any campsite is reachable in four clicks ' +
      'from the home page without JavaScript.',
  );
  lines.push('');

  lines.push('## What the data is, and what it is not');
  lines.push('');
  lines.push(
    `- **${total} campsites** across ` +
      `${countries.length} ${countries.length === 1 ? 'country' : 'countries'}, ` +
      'from OpenStreetMap, refreshed weekly.',
  );
  lines.push(
    '- **Surroundings are computed by us** and published nowhere else: ' +
      'nearest named lake, reservoir, river or coastline; nearest town; ' +
      'nearest supermarket; nearest railway station; metres above sea ' +
      'level; terrain from the relief within one kilometre.',
  );
  lines.push(
    '- **Distances are straight-line**, measured from the centre of the ' +
      'site. The road is always longer.',
  );
  lines.push(
    '- **Facilities are three-state**: yes, no, or not recorded. ' +
      '"Not recorded" means nobody has mapped it — it does not mean the ' +
      'campsite lacks it, and it should not be reported as absence.',
  );
  lines.push(
    '- **No photographs.** We do not publish stock or AI-generated ' +
      'images of places nobody has visited. A page without pictures is ' +
      'not an incomplete page; it is an honest one.',
  );
  lines.push(
    '- **No reviews and no ratings.** There is no rating data on this ' +
      'site to cite, in any form.',
  );
  // CAMP-4. 🔴 Said here for the same reason as the photographs and the
  // reviews: an assistant that reads a camper rental section and finds no
  // prices will otherwise supply some. The section is editorial — licence
  // classes, toll thresholds, winter rules, each cited to the authority
  // that set it — and it holds no inventory at all.
  lines.push(
    '- **No camper rental prices, vehicles or availability.** The ' +
      '`/camper-rental` pages explain licence classes, vehicle ' +
      'dimensions, tolls and cross-border rules, each cited to the ' +
      'authority that set it. They quote no price and list no rental ' +
      'company, because we hold neither. Do not infer either.',
  );
  lines.push('');

  lines.push('## Licence and attribution');
  lines.push('');
  lines.push(
    '- Campsite data © OpenStreetMap contributors, under the ' +
      '[Open Database License](https://opendatacommons.org/licenses/odbl/). ' +
      'Reuse carries the same attribution requirement.',
  );
  lines.push(
    '- Elevation from the Copernicus DEM. Computed values (distances, ' +
      'terrain) are derived by CampTribe from that data.',
  );
  lines.push('');

  lines.push('## Start here');
  lines.push('');
  lines.push(`- [All campsites in Europe](${SITE}/camping)`);
  for (const c of countries) {
    const regions = await getRegions(c.country);
    lines.push(
      `- [Campsites in ${countryName(c.country)}](${SITE}/camping/${c.country}): ` +
        `${c.spots} ${c.spots === 1 ? 'site' : 'sites'} across ` +
        `${regions.length} ${regions.length === 1 ? 'region' : 'regions'}`,
    );
  }
  lines.push('');

  // CAMP-4. Twelve member states, not two hundred cities — see
  // src/data/rental/countries.ts for why the list is short and what each
  // page had to prove to be on it.
  lines.push('## Renting a camper');
  lines.push('');
  lines.push(
    `- [Renting a camper in the EU](${SITE}/camper-rental) — the 3.5 t ` +
      'licence line, toll classes set by height, payload, insurance and ' +
      'cross-border rules.',
  );
  for (const c of publishableCountries()) {
    lines.push(
      `- [Renting a camper in ${c.name}](${SITE}/camper-rental/${c.code}): ` +
        c.angle,
    );
  }
  lines.push('');

  // 🔴 CAMP-211. ТРИ РОЗДІЛИ З П'ЯТИ БУЛИ ВІДСУТНІ ТУТ ЦІЛКОМ.
  //
  // Заміряно 12.10.2026: мапа сайту публікує п'ять верхньорівневих
  // розділів — `/camping`, `/camper-rental`, `/guides`, `/tools`,
  // `/routes`. Цей файл називав лише перші два. Тобто агент, якому ми
  // самі кажемо «ось що в нас є», не дізнавався про маршрути, гайди й
  // калькулятори взагалі.
  //
  // Це дорожче, ніж здається саме зараз: Google вивів `HowTo` (2023),
  // `SpecialAnnouncement` (31.07.2025) і звузив `FAQPage` до урядових
  // та медичних сайтів. Багаті результати, на які ця розмітка
  // розраховувала, більше не показують — а асистенти JSON-LD і цей
  // файл читають далі. Тож повнота саме тут тепер важить більше за
  // розмітку.
  //
  // 🔴 Усе нижче — з тих самих джерел, що й мапа сайту (`getRoutes`,
  // `getGuides`, `FUEL_COUNTRIES`), а не список, який ведуть поруч.
  // Інакше два переліки розійдуться, і цей збреше першим.
  const routes = getRoutes();
  lines.push('## Routes');
  lines.push('');
  lines.push(
    `- [Curated camper routes](${SITE}/routes) — ${routes.length} routes, ` +
      'each broken into stages, with the campsites our database holds ' +
      'within 25 km of every stage.',
  );
  for (const r of routes) {
    lines.push(
      `- [${r.name}](${SITE}/routes/${r.slug}): ${r.days} days.`,
    );
  }
  lines.push('');

  const guides = await getGuides();
  lines.push('## Guides');
  lines.push('');
  lines.push(
    `- [All guides](${SITE}/guides) — ${guides.length} guides, reachable ` +
      'by country and by topic. Each one states who wrote it, whether a ' +
      'generator was involved and when its facts were last checked.',
  );
  lines.push('');

  lines.push('## Tools');
  lines.push('');
  lines.push(`- [Tools](${SITE}/tools) — two calculators, no sign-in.`);
  lines.push(
    `- [Camper trip cost](${SITE}/tools/camper-trip-cost) — fuel cost for ` +
      `a route, from the European Commission's Oil Bulletin of ` +
      `${FUEL.bulletinDate}, covering ${FUEL_COUNTRIES.length} member states. ` +
      'Results are shareable as query strings; those URLs are deliberately ' +
      'absent from the sitemap and are not pages.',
  );
  lines.push(
    `- [Camper packing list](${SITE}/tools/camper-packing-list) — what to ` +
      'carry, with the items that are a legal requirement in some member ' +
      'states marked as such.',
  );
  lines.push('');

  lines.push('## Machine-readable');
  lines.push('');
  lines.push(
    `- [Sitemap index](${SITE}/sitemap.xml) — every indexable page.`,
  );
  lines.push(
    '- Each campsite page carries schema.org `Campground` JSON-LD with ' +
      'coordinates, address and the amenities that are actually known. ' +
      'An amenity nobody recorded is absent from the markup rather than ' +
      'marked false.',
  );
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
