// CAMP-288: Natural Earth's spelling is not France's spelling.
//
// `region` comes from the name of the admin-1 polygon a campsite falls
// in (`import-spots.ts`), and that name was published verbatim. Two of
// Natural Earth's names are misspelt, and both reached the URL:
//
//     Haute-Rhin       238 campsites   /camping/fr/haute-rhin/…
//     Seien-et-Marne    70 campsites   /camping/fr/seien-et-marne/…
//
// Measured in the database on 12.10.2026. `Bas-Rhin` beside it is
// spelt correctly, so Alsace had one département right and one wrong.
//
// 🔴 WHY A TABLE AND NOT A FUZZY MATCH. A near-miss repair would also
// "fix" names that are merely similar, and the two départements of
// Alsace are one letter apart from each other in exactly that way. Each
// row below is one named polygon, with what the state itself calls it.
//
// 🔴 AND WHY THE SOURCE RATHER THAN AN UPDATE. The weekly OSM import is
// the only writer of `region`, so a correction anywhere else is undone
// the following Monday. Moving the published URLs is a separate job
// with a redirect for every one of them (CAMP-87); this file only makes
// sure the next import stops creating them.

/**
 * The 101 départements, as the French state writes them.
 *
 * 96 of metropolitan France plus the five overseas departments. The
 * list is here rather than in a JSON file because it is the thing the
 * correction table is checked against, and a check whose reference can
 * be edited without review is not a check.
 */
export const FRENCH_DEPARTEMENTS: readonly string[] = [
  'Ain',
  'Aisne',
  'Allier',
  'Alpes-de-Haute-Provence',
  'Hautes-Alpes',
  'Alpes-Maritimes',
  'Ardèche',
  'Ardennes',
  'Ariège',
  'Aube',
  'Aude',
  'Aveyron',
  'Bouches-du-Rhône',
  'Calvados',
  'Cantal',
  'Charente',
  'Charente-Maritime',
  'Cher',
  'Corrèze',
  'Corse-du-Sud',
  'Haute-Corse',
  "Côte-d'Or",
  "Côtes-d'Armor",
  'Creuse',
  'Dordogne',
  'Doubs',
  'Drôme',
  'Eure',
  'Eure-et-Loir',
  'Finistère',
  'Gard',
  'Haute-Garonne',
  'Gers',
  'Gironde',
  'Hérault',
  'Ille-et-Vilaine',
  'Indre',
  'Indre-et-Loire',
  'Isère',
  'Jura',
  'Landes',
  'Loir-et-Cher',
  'Loire',
  'Haute-Loire',
  'Loire-Atlantique',
  'Loiret',
  'Lot',
  'Lot-et-Garonne',
  'Lozère',
  'Maine-et-Loire',
  'Manche',
  'Marne',
  'Haute-Marne',
  'Mayenne',
  'Meurthe-et-Moselle',
  'Meuse',
  'Morbihan',
  'Moselle',
  'Nièvre',
  'Nord',
  'Oise',
  'Orne',
  'Pas-de-Calais',
  'Puy-de-Dôme',
  'Pyrénées-Atlantiques',
  'Hautes-Pyrénées',
  'Pyrénées-Orientales',
  'Bas-Rhin',
  'Haut-Rhin',
  'Rhône',
  'Haute-Saône',
  'Saône-et-Loire',
  'Sarthe',
  'Savoie',
  'Haute-Savoie',
  'Paris',
  'Seine-Maritime',
  'Seine-et-Marne',
  'Yvelines',
  'Deux-Sèvres',
  'Somme',
  'Tarn',
  'Tarn-et-Garonne',
  'Var',
  'Vaucluse',
  'Vendée',
  'Vienne',
  'Haute-Vienne',
  'Vosges',
  'Yonne',
  'Territoire de Belfort',
  'Essonne',
  'Hauts-de-Seine',
  'Seine-Saint-Denis',
  'Val-de-Marne',
  "Val-d'Oise",
  'Guadeloupe',
  'Martinique',
  'Guyane',
  'La Réunion',
  'Mayotte',
];

/**
 * What Natural Earth calls a polygon, and what the state calls it.
 *
 * Keyed by ISO country code, because the same string can be right in
 * one country and wrong in another: `Rheinland-Pfalz` is a correct
 * German Land and a wrong French département, and a table without the
 * country would have to choose.
 */
export const NATURAL_EARTH_FIXES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  // Natural Earth 1:10m admin-1, `name` field. Checked against the
  // Code officiel géographique (INSEE), which is what the state uses on
  // its own documents.
  FR: {
    // INSEE 68. "Haut", not "Haute": the Rhine is masculine.
    'Haute-Rhin': 'Haut-Rhin',
    // INSEE 77. Two letters transposed in the source.
    'Seien-et-Marne': 'Seine-et-Marne',
  },
};

const BY_COUNTRY: Readonly<Record<string, ReadonlySet<string>>> = {
  FR: new Set(FRENCH_DEPARTEMENTS),
};

/**
 * The name this region should be published under.
 *
 * Returns the input unchanged when there is nothing to correct — which
 * is every region of every country except the two rows above.
 */
export function correctRegion(
  country: string | null | undefined,
  region: string | null | undefined,
): string | null {
  if (typeof region !== 'string' || region.trim() === '') return null;
  if (typeof country !== 'string') return region;
  return NATURAL_EARTH_FIXES[country.toUpperCase()]?.[region] ?? region;
}

/**
 * Is this a region the country actually has?
 *
 * `null` means "we hold no list for this country", which is not the
 * same as `false` and must not be reported as a problem: today only
 * France is listed, and claiming every German Land is unknown would
 * bury the two real findings under 811 false ones.
 */
export function isKnownRegion(
  country: string | null | undefined,
  region: string | null | undefined,
): boolean | null {
  if (typeof country !== 'string' || typeof region !== 'string') return null;
  const known = BY_COUNTRY[country.toUpperCase()];
  if (known === undefined) return null;
  return known.has(region);
}
