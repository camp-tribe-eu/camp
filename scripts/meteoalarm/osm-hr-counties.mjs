// CAMP-GISCO: Croatia's counties as OpenStreetMap draws them, tied to the
// NUTS3 code the feed publishes. A module, not a script: no entry point.
//
// 🔴 WHY CROATIA IS DIFFERENT. MeteoAlarm's own zone list knows Croatia as
// HR001-008 (regions) and HR801-806 (sea channels); the feed's counties
// carry HR011-HR031 EMMA ids that are in NO list (measured 02.11.2026:
// HR018, HR019, HR023, HR025, HR027, HR028, ... against a file that stops
// at HR008). Their only usable handle is the NUTS3 code beside them — and
// names do not help, "Knin region" is not a county.
//
// 🔴 THE SOURCE IS OPENSTREETMAP, which is ODbL and already ours. Each
// county relation carries `ref:nuts:3`, and Croatia's feed uses the CURRENT
// nomenclature (HR050 Zagreb, HR065 Zagrebačka), so these tie at 12 of 12
// live codes. Measured 02.11.2026.
//
// 🔴 THE TRAP, MEASURED. Other countries' OSM mappers also write the
// current code while their feeds still publish 2013: for France the two
// agree on 0 of 6. That is why this is Croatia ONLY — every other country
// goes through `nuts-binding.mjs`.
//
// 🔴 PINNED BY RELATION, CHECKED BY TAG. The ids below are looked up in
// one call, and a relation is accepted only if it still says, in its own
// `ref:nuts:3`, the code we expect of it. A county re-tagged, merged or
// replaced by a mapper costs ITS row and is named — never the run.

/** NUTS3 code → the OSM relation of the county, and its name for humans. */
export const HR_COUNTIES = Object.freeze({
  HR021: { rel: 224165, name: 'Bjelovarsko-bilogorska' },
  HR022: { rel: 222869, name: 'Virovitičko-podravska' },
  HR023: { rel: 222870, name: 'Požeško-slavonska' },
  HR024: { rel: 222861, name: 'Brodsko-posavska' },
  HR025: { rel: 222646, name: 'Osječko-baranjska' },
  HR026: { rel: 222649, name: 'Vukovarsko-srijemska' },
  HR027: { rel: 226271, name: 'Karlovačka' },
  HR028: { rel: 224139, name: 'Sisačko-moslavačka' },
  HR031: { rel: 226452, name: 'Primorsko-goranska' },
  HR032: { rel: 226465, name: 'Ličko-senjska' },
  HR033: { rel: 226726, name: 'Zadarska' },
  HR034: { rel: 226741, name: 'Šibensko-kninska' },
  HR035: { rel: 226749, name: 'Splitsko-dalmatinska' },
  HR036: { rel: 226351, name: 'Istarska' },
  HR037: { rel: 226750, name: 'Dubrovačko-neretvanska' },
  HR050: { rel: 226224, name: 'Grad Zagreb' },
  HR061: { rel: 224183, name: 'Međimurska' },
  HR062: { rel: 226210, name: 'Varaždinska' },
  HR063: { rel: 226209, name: 'Koprivničko-križevačka' },
  HR064: { rel: 226223, name: 'Krapinsko-zagorska' },
  HR065: { rel: 226241, name: 'Zagrebačka' },
});

/**
 * One request for all of them, assembled into GeoJSON by Nominatim.
 *
 * `polygon_threshold=0` keeps the full outline; the default simplifies.
 * The public instance asks for an identifying User-Agent — see `HR_HEADERS`.
 */
export const HR_COUNTIES_URL =
  'https://nominatim.openstreetmap.org/lookup?osm_ids=' +
  Object.values(HR_COUNTIES).map((c) => `R${c.rel}`).join(',') +
  '&format=geojson&polygon_geojson=1&extratags=1&polygon_threshold=0';

/** Nominatim's usage policy wants to know who is asking; a bare `node` is refused. */
export const HR_HEADERS = Object.freeze({
  'User-Agent': 'camptribe-warning-zones/1.0 (+https://camptribe.eu)',
});

/**
 * Nominatim's answer as features keyed by NUTS code, plus the counties it
 * could not vouch for.
 *
 * Accepted only when the relation is a relation, is one of ours, SAYS the
 * code we expect in `ref:nuts:3`, and has an area. A county absent from
 * the answer is rejected too: its spots would otherwise lose the NUTS3
 * code with nothing saying so.
 */
export function hrCountiesFeatures(collection) {
  const byRel = new Map(Object.entries(HR_COUNTIES).map(([code, c]) => [c.rel, code]));
  const features = [];
  const rejected = [];
  const seen = new Set();
  for (const f of collection?.features ?? []) {
    const p = f?.properties ?? {};
    const code = byRel.get(Number(p.osm_id));
    if (p.osm_type !== 'relation' || !code) {
      rejected.push({ code: null, why: `${p.osm_type ?? '?'} ${p.osm_id ?? '?'} is not one of the counties we asked for` });
      continue;
    }
    seen.add(code);
    const says = p.extratags?.['ref:nuts:3'];
    if (says !== code) {
      rejected.push({ code, why: `OSM relation ${p.osm_id} now says ref:nuts:3=${says ?? '(nothing)'}, expected ${code}` });
      continue;
    }
    if (!['Polygon', 'MultiPolygon'].includes(f?.geometry?.type)) {
      rejected.push({ code, why: `OSM relation ${p.osm_id} came back as ${f?.geometry?.type ?? 'no geometry'}, not an area` });
      continue;
    }
    features.push({ type: 'Feature', properties: { NUTS_ID: code, osm_id: p.osm_id }, geometry: f.geometry });
  }
  for (const code of Object.keys(HR_COUNTIES)) {
    if (!seen.has(code)) rejected.push({ code, why: `relation ${HR_COUNTIES[code].rel} (${HR_COUNTIES[code].name}) is absent from the answer` });
  }
  return { features, rejected };
}
