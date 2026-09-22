import { countryName, getCountries, getRegions } from '@/lib/api';
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
