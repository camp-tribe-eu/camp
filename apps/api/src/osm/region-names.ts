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
  // Natural Earth 1:10m admin-1, `name` field. Every row below was
  // found by joining `ne_admin1` to the campsites that carry the name,
  // and each is checked against the polygon's own `iso_3166_2` code —
  // the thing that says which administrative unit it IS, independently
  // of how this build spells it.
  FR: {
    // FR-68. "Haut", not "Haute": the Rhine is masculine. 238 campsites.
    'Haute-Rhin': 'Haut-Rhin',
    // FR-77. Two letters transposed in the source. 70 campsites.
    'Seien-et-Marne': 'Seine-et-Marne',
    // FR-GF. The state's short form, and the one the other four
    // overseas departments are listed under. No campsite carries it
    // today; the row exists so a future import does not report a real
    // department as unknown.
    'Guyane française': 'Guyane',
  },
  DK: {
    // DK-85. A stray `a`: Sjælland, not Sjaælland. 306 campsites —
    // more than both French misspellings together, and the biggest
    // single one found. Denmark's other four regions are listed under
    // their Danish names (Syddanmark, Midtjylland, Nordjylland,
    // Hovedstaden), so `Sjælland` is the consistent form, not `Zealand`.
    Sjaælland: 'Sjælland',
  },
  IT: {
    // IT-OR. 32 campsites.
    Oristrano: 'Oristano',
    // IT-KR. 29 campsites.
    Crotene: 'Crotone',
  },
  HU: {
    // HU-GY and HU-HV. A circumflex where Hungarian uses a double
    // acute — the classic transliteration slip. 3 and 1 campsites.
    Gyôr: 'Győr',
    Hódmezôvásárhely: 'Hódmezővásárhely',
  },
  IE: {
    // IE-LS. `Laoighis` is the pre-1922 anglicised spelling; the county
    // is Laois. 2 campsites.
    Laoighis: 'Laois',
  },
};

// 🔴 WHY THIS TABLE IS HAND-PICKED AND NOT GENERATED.
//
// Review proposed a rule: Natural Earth also carries `name_en`, so take
// every polygon where `name <> name_en` and treat the difference as a
// misspelling. Measured over the EU-27, that rule returns the wrong
// thing almost every time — the two columns differ because one is the
// local name and the other the English exonym:
//
//     DE  Bayern              Bavaria                 1 336 campsites
//     DE  Nordrhein-Westfalen North Rhine-Westphalia  1 067
//     NL  Noord-Brabant       North Brabant             415
//     CZ  Jihočeský           South Bohemian            246
//
// Not one of those is an error, and "correcting" them would rename
// 1 336 German pages to an English word the country does not use. The
// same column even runs the other way: for FR-64 `name` is the correct
// `Pyrénées-Atlantiques` and `name_en` is the mangled
// `Pyrenees-Atlantics`.
//
// So `name <> name_en` is evidence that fits both readings, which makes
// it evidence for neither. Each row above was decided one at a time
// against the polygon's `iso_3166_2` code and the state's own spelling.

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
