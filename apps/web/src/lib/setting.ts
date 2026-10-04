import type { SpotContext, TerrainType, WaterKind } from './api';

// CAMP-199 — the facts we compute, said in words rather than listed as
// numbers.
//
// 🔴 WHY THIS EXISTS, and it is not decoration.
//
// Measured 04.10.2026 against the real database: of 61 422 publishable
// campsite pages, 28 808 — 47% — carry no known amenity, no description
// and no stars. Nothing but a name. The duplicate-page guard then finds
// them near-identical to their neighbours, and it is right: two pages
// that differ by one word are two pages Google is entitled to treat as
// one, and the cost of shipping them is the domain, not the page.
//
// What those pages DO have is this: the distance to water and what kind
// of water it is, the nearest town, shop and station, the height above
// the sea and the shape of the land around. We compute all of it
// ourselves and no competitor publishes it. It was sitting in a list of
// figures beside the page instead of being the page's own sentence.
//
// 🔴 THE TRAP, WRITTEN DOWN BECAUSE IT IS EASY TO WALK INTO.
//
// "Stands 120 m from the sea, 4 km from Zadar" and "Stands 1.2 km from
// the sea, 9 km from Zadar" are two pages that differ by NUMBERS ALONE —
// which is precisely what the guard exists to refuse. Substituting a
// value into one template does not make a page its own; it makes a
// mail-merge.
//
// So every fact below BRANCHES ON ITS VALUE into a differently-shaped
// sentence. A campsite on the shore and a campsite an hour inland do not
// say the same thing with different digits — they say different things,
// because they are different places.
//
// 🔴 The test for this is mechanical and worth stating: STRIP THE
// NUMBERS, and the sentences must still differ. If removing the digits
// leaves one string, the pages differ by digits alone, which is what the
// duplicate guard is entitled to call one page.
//
// 🔴 MEASURED, AND THE FIRST TWO MEASUREMENTS WERE OF MY OWN ARRAYS.
//
// This claimed "4.2% alike at the median and 23.1% at the worst, on
// eight real Zadarska campsites". The eight were typed into the spec,
// six with round invented figures and no shop name, and the sentence
// was true only of them. A second copy of the claim sat in `page.tsx`
// on twelve such rows and added "no pair is near the 80% line", which
// was simply false. Review ran the rule over
// `apps/api/test/fixtures/ci-seed.sql` and found 34 of its 70
// context-bearing rows rendering a paragraph byte-identical to
// another's once the digits were stripped.
//
// On the seed the build uses, 70 rows and 2 415 pairs: **median 1.2%,
// p90 13.0%, and ONE pair over the guard's 80% line** — autocamp-pisak
// and autokemp-marin, identical. Of the 30 Zadarska rows: median 3.9%,
// p90 17.4%, 15 distinct openers.
//
// 🔴 And on a corpus nobody here wrote — 70 real campsites from NL, BE,
// DK, DE and FR read from the production API
// (`tests/unit/fixtures/eu-spread.json`): 57 distinct openers of 70,
// median 2.7%, worst pair 50%, no pair near the line. The paragraph
// does better away from the Croatian coast, which is where the hard
// cases were.
//
// 🔴 SIX GROUPS, 13 ROWS, STILL SHARE A SHAPE, and that is not all one
// thing. Some are the same place — pitches at the mouth of one canyon
// sharing a river, a town, a shop and a station — and no honest
// sentence parts them; the noindex half of CAMP-199 is what covers
// those. One is separable and not separated, and it is named as such.
// They are listed in `setting.spec.ts`, each checked by opening it.

// 🔴 AND NOTHING HERE IS INVENTED. Every clause is a restatement of a
// figure we measured. Where a name appears it is OpenStreetMap's, passed
// through unchanged; the distance beside it is ours. No adjective claims
// anything the numbers do not carry — "quiet", "beautiful" and "popular"
// are not facts and do not appear.

/** Straight-line metres, as a reader would say them. */
export function distance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 100) return `${Math.round(m / 10) * 10} m`;
  if (m < 1000) return `${Math.round(m / 50) * 50} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1).replace(/\.0$/, '')} km`;
  return `${Math.round(m / 1000)} km`;
}

/**
 * 🔴 A walk, only where a walk is the honest word.
 *
 * Straight-line metres are not a path. Under 1 km the difference between
 * the line and the lane is small enough that "a few minutes' walk" is
 * true however the path runs; past that it stops being true, and we stop
 * saying it.
 */
const WALKABLE_M = 1000;

const WATER_NOUN: Record<WaterKind, string> = {
  sea: 'the sea',
  lake: 'a lake',
  reservoir: 'a reservoir',
  river: 'a river',
};

const WATER_AT_HAND: Record<WaterKind, string> = {
  sea: 'the shore',
  lake: 'the water',
  reservoir: 'the water',
  river: 'the bank',
};

const named = (noun: string, name?: string) => (name ? `${noun} (${name})` : noun);

/**
 * The water sentence.
 *
 * Five bands, five shapes. The point of the bands is not precision — the
 * metres are already precise — it is that a campsite ON the water and a
 * campsite forty minutes from it are describing different holidays, and
 * one sentence shape cannot carry both without lying about one of them.
 */
export function waterClause(water: SpotContext['water']): string | null {
  if (!water || !Number.isFinite(water.m)) return null;
  const kind = water.kind;
  const noun = WATER_NOUN[kind] ?? 'water';
  const atHand = WATER_AT_HAND[kind] ?? 'the water';
  const d = distance(water.m);
  const name = water.name;

  // 🔴 FOUR SHAPES INSIDE THE FIRST 150 METRES, and the reason is
  // measured. The first draft had one band for everything under 150 m
  // and, on the Croatian coast where every campsite is on the water,
  // nine of twelve neighbouring pages opened with the identical
  // sentence and a different number. That is the mail-merge this file
  // exists to avoid, written by the file itself.
  if (water.m < 40) {
    return name ? `the pitches run down to ${name}, ${d} away` : `the pitches run down to ${atHand}, ${d} away`;
  }
  if (water.m < 80) {
    return `${named(atHand, name)} is ${d} from the pitches`;
  }
  if (water.m < 150) {
    return `${named(noun, name)} is ${d} away, in sight of the site`;
  }
  if (water.m < WALKABLE_M) {
    return `it is a short walk of ${d} to ${named(noun, name)}`;
  }
  if (water.m < 5000) {
    return `${named(noun, name)} is ${d} off, a few minutes by road`;
  }
  if (water.m < 20_000) {
    return `the nearest water is ${named(noun, name)}, ${d} away`;
  }
  return `this is dry country: the nearest ${noun === 'the sea' ? 'coast' : noun.replace(/^an? /, '')} we find is ${d} off`;
}

/** The town sentence. Villages are excluded upstream, so this is a real town. */
export function townClause(town: SpotContext['town']): string | null {
  if (!town || !Number.isFinite(town.m)) return null;
  const d = distance(town.m);
  const name = town.name;
  if (town.m < 1000) {
    return name ? `${name} begins at the gate, ${d} away` : `a town begins ${d} away`;
  }
  if (town.m < 6000) {
    return name ? `${name} is ${d} down the road` : `the nearest town is ${d} down the road`;
  }
  // 🔴 A BAND AT 15 km, because that is where the answer to "can we pop
  // out for dinner" changes. Under it a town is an evening; over it, it
  // is an outing you plan.
  //
  // It was one band from 6 to 25 km, and two campsites outside Obrovac
  // — one at 12 km and one at 21 km — came out with the same sentence
  // and a different number. I had written both into `KNOWN_ALIKE` as
  // pages we cannot tell apart; a difference of nine kilometres to the
  // only town is not nothing, and saying it is was the lazy half of
  // that claim.
  if (town.m < 15_000) {
    return name ? `the nearest town is ${name}, ${d} away` : `the nearest town is ${d} away`;
  }
  if (town.m < 25_000) {
    // 🔴 A DIFFERENT SHAPE, NOT A LONGER ONE. The first version of this
    // band read "the nearest town, Obrovac, is 21 km away — far enough
    // to be an outing", and measuring it showed why that is the wrong
    // instinct: a longer clause is more words two neighbours SHARE.
    // `autocamp-marko` and `autocamp-vesna`, 40 m apart on the same
    // river, went from 79% to 80.8% — over the duplicate guard's line —
    // because I had given them a longer sentence to have in common.
    return name ? `${name} is the nearest town, ${d} off` : `the nearest town is ${d} off`;
  }
  return name
    ? `the nearest town of any size is ${name}, and it is ${d} off`
    : `the nearest town of any size is ${d} off`;
}

/**
 * The shop sentence — and it is the one a camper checks before arriving,
 * because a site with no shop within reach changes what you pack.
 */
/**
 * The food shop.
 *
 * 🔴 WITH ITS NAME, which this threw away until review counted the cost.
 *
 * `townClause` and `stationClause` both pass the source's name through;
 * this one did not, and the name is the one field here that separates
 * neighbours. Three campsites outside Bovec sit within 500 m of a shop
 * each — and they are Mercator, Mercator and "Kmetijska Zadruga Tolmin
 * Trgovina Market Bovec". Said, that is two different pages; unsaid, it
 * is "there is a food shop within walking distance" three times.
 *
 * It is OpenStreetMap's word, passed through unchanged, exactly like a
 * town's. Nothing is invented and no adjective is added.
 */
export function shopClause(shop: SpotContext['supermarket']): string | null {
  if (!shop || !Number.isFinite(shop.m)) return null;
  const d = distance(shop.m);
  const name = shop.name;
  if (shop.m < WALKABLE_M) {
    return name
      ? `${name} is a walk away, ${d}, for food`
      : `there is a food shop within walking distance, ${d}`;
  }
  if (shop.m < 8000) {
    return name ? `the nearest food shop is ${name}, ${d} away` : `the nearest food shop is ${d} away`;
  }
  return name
    ? `stock up before you arrive: the nearest food shop is ${name}, ${d} off`
    : `stock up before you arrive: the nearest food shop is ${d} off`;
}

/**
 * How you arrive, or that you cannot arrive that way.
 *
 * 🔴 THE 15 km CUT USED TO SILENCE THIS ENTIRELY, and that was the
 * single biggest cause of the mail-merge review found.
 *
 * On the Croatian coast the stations are 18–50 km out, so this returned
 * null for exactly the pages that had least else to say: water, town,
 * shop, three numbers, nothing more. Measured on the CI fixture, 34 of
 * 70 rows rendered a paragraph that was byte-identical to another's once
 * the digits were stripped, and every one of those rows had a station
 * the reader was never told about.
 *
 * "There is no station near enough to use, the closest is Ploče, 48 km
 * off" is not padding. It is the answer to "can I get there without a
 * car", it is measured, and the name is OpenStreetMap's. The earlier
 * rule — "a station 50 km away is true and useless" — was right about
 * one page and wrong about the set: a fact that distinguishes one
 * campsite from its neighbour is the opposite of useless here.
 */
export function stationClause(station: SpotContext['station']): string | null {
  if (!station || !Number.isFinite(station.m)) return null;
  const d = distance(station.m);
  const name = station.name;
  if (station.m < 2000) {
    return name ? `${name} station is ${d} away, so you can arrive by train` : `a railway station is ${d} away`;
  }
  if (station.m <= 15_000) {
    return name ? `the nearest railway station is ${name}, ${d} off` : `the nearest railway station is ${d} off`;
  }
  // 🔴 Past a taxi ride, the honest sentence changes its subject: it
  // stops being "how to arrive" and becomes "you will need a car".
  if (station.m <= 40_000) {
    return name
      ? `the railway does not come close — ${name} is the nearest station, ${d} off`
      : `the railway does not come close: the nearest station is ${d} off`;
  }
  return name
    ? `you will want a car here: the nearest railway station, ${name}, is ${d} away`
    : `you will want a car here: the nearest railway station is ${d} away`;
}

const TERRAIN_WORD: Record<TerrainType, string> = {
  flat: 'flat',
  rolling: 'rolling',
  hilly: 'hilly',
  mountainous: 'mountainous',
};

/**
 * Height and the shape of the land, together, because apart they are
 * both dull and together they place you.
 *
 * 🔴 Relief is measured across a kilometre around the site, not under
 * it — so this describes the landscape the campsite sits in, never the
 * slope of the pitch. The wording says "around", and that is deliberate.
 */
export function groundClause(ctx: SpotContext): string | null {
  const e = ctx.elevation;
  const t = ctx.terrain;
  const hasE = Number.isFinite(e);
  if (!hasE && !t) return null;
  const word = t ? TERRAIN_WORD[t.type] : null;

  if (hasE && (e as number) >= 1000) {
    return word
      ? `it sits high up, ${Math.round(e as number)} m above the sea, in ${word} country`
      : `it sits high up, ${Math.round(e as number)} m above the sea`;
  }
  if (hasE && (e as number) <= 15) {
    return word ? `the ground is barely above the sea here, and ${word}` : 'the ground is barely above the sea here';
  }
  if (hasE && word) {
    // 🔴 THE RELIEF, which this measured and then threw away — AND
    // WHICH SAYS LESS THAN THE FIRST WORDING CLAIMED.
    //
    // `relief = max − min` over an eight-point ring at a kilometre, the
    // site's own height included (compute-context.ts:553). That is a
    // RANGE. It carries no direction and no shape.
    //
    // The first version of this printed "the walls of the valley rise
    // over 700 m around it, and the floor lies 950 m above the sea".
    // Review put in a site sitting at the ring's HIGH point and got
    // exactly that sentence — a summit published as a valley floor. The
    // 400-band said "the land climbs a few hundred metres on either
    // side", which asserts a symmetry a max−min cannot establish. Both
    // broke this file's own first rule, in the clause added to defend
    // it.
    //
    // So the wording now says the range and nothing else: how much
    // height there is within a kilometre. Three bands, because the
    // difference between 268 and 281 is noise and the difference
    // between 281 and 920 is what you see out of the tent. The number
    // itself is not printed — the eight-point ring does not support
    // that precision — and no word places the campsite inside the
    // range.
    const relief = t && Number.isFinite(t.relief) ? (t.relief as number) : null;
    const height = Math.round(e as number);
    if (relief !== null && relief >= 700) {
      return `the ground within a kilometre rises and falls by more than 700 m, and the site itself is ${height} m above the sea`;
    }
    if (relief !== null && relief >= 400) {
      return `there are a few hundred metres of height within a kilometre of it, and the site is ${height} m above the sea`;
    }
    if (relief !== null && relief < 120) {
      return `the ground barely changes height for a kilometre around, ${height} m above the sea`;
    }
    return `the land around is ${word}, ${height} m above the sea`;
  }
  if (hasE) return `the ground lies ${Math.round(e as number)} m above the sea`;
  return `the land around is ${word}`;
}

/**
 * How unusual a fact is here, so the sentence leads with what actually
 * distinguishes this place.
 *
 * ⚠️ AND IT IS NOT THE MAIN THING, which an earlier draft of this
 * comment claimed. Measured on eight real Zadarska campsites: with the
 * ordering, the worst pair is 23.1% similar and six of eight openers are
 * distinct; with it removed and the clauses left in a fixed order,
 * 26.3% and five of eight. Real, small, and not the mechanism.
 *
 * The mechanism is the BANDS — a sentence that changes shape with the
 * value, so that stripping the digits still leaves two different
 * sentences. Ordering is kept because it helps a little and costs
 * nothing, but anyone tempted to rely on it should read those numbers
 * first.
 */
function notability(ctx: SpotContext): { key: string; score: number; text: string }[] {
  const out: { key: string; score: number; text: string }[] = [];
  const push = (key: string, score: number, text: string | null) => {
    if (text) out.push({ key, score, text });
  };

  // 🔴 ORDINARY IS NOT NOTABLE, even when it is pleasant.
  //
  // The first scoring gave "within 150 m of water" the top mark, so on
  // any coast every page led with the same clause. Being on the sea is
  // what Croatian campsites have in COMMON; it cannot be the thing that
  // tells one from another. What is unusual is the extreme in either
  // direction — water you can step into, or no water for twenty
  // kilometres — and the same for the rest.
  const w = ctx.water;
  push(
    'water',
    w && Number.isFinite(w.m)
      ? w.m > 20_000
        ? 90
        : w.m < 40
        ? 70
        : w.m < 1000
        ? 45
        : 55
      : 0,
    waterClause(w),
  );

  const e = ctx.elevation;
  push(
    'ground',
    Number.isFinite(e) ? ((e as number) >= 1000 ? 95 : (e as number) <= 15 ? 50 : 40) : ctx.terrain ? 40 : 0,
    groundClause(ctx),
  );

  const t = ctx.town;
  push('town', t && Number.isFinite(t.m) ? (t.m > 25_000 ? 85 : t.m < 1000 ? 75 : 50) : 0, townClause(t));

  const sh = ctx.supermarket;
  push('shop', sh && Number.isFinite(sh.m) ? (sh.m > 8000 ? 80 : sh.m < 1000 ? 60 : 35) : 0, shopClause(sh));

  // 🔴 Scored like everything else: the EXTREMES are notable, the
  // middle is not. A station you can walk to is rare and leads; a
  // station 50 km off is the reason you need a car and is worth saying;
  // one 20 minutes away by road is ordinary and goes last.
  const st = ctx.station;
  push(
    'station',
    // 🔴 FAR IS NOT NOTABLE, and I got this wrong on the first try.
    // Scoring "no station near" at 72 put it top on every Croatian
    // coastal page at once: four of six Zadar openers became "You will
    // want a car here". Having no railway is what those campsites have
    // in COMMON, which is the definition of not notable — the same
    // mistake the water score was written to avoid. A station you can
    // WALK to is the rare one.
    st && Number.isFinite(st.m) ? (st.m < 2000 ? 88 : st.m <= 15_000 ? 48 : 25) : 0,
    stationClause(st),
  );

  return out.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

const upperFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The paragraph. Empty string when we have nothing measured — never a
 * sentence that says nothing.
 *
 * 🔴 Between two and four clauses, chosen by notability, never all of
 * them in a fixed order. A page that always recited the same five facts
 * in the same order would be the template this exists to avoid, however
 * varied each individual sentence was.
 */
export function settingParagraph(ctx: SpotContext | null | undefined): string {
  if (!ctx) return '';
  const ranked = notability(ctx);
  if (ranked.length === 0) return '';

  // 🔴 EVERY FACT WE HAVE, up to four, not a chosen two.
  //
  // Measured: elevation and terrain are computed for 1 288 campsites of
  // 61 557 — two per cent. For everyone else there are three facts in
  // the world: water, town, shop. Dropping one of three to keep the
  // sentence short threw away a third of what distinguishes the page,
  // and the pages that lost it were the ones with least else to say.
  // 🔴 FOUR, AND I TRIED FIVE AND MEASURED IT WORSE.
  //
  // Review was right that `camping-nadiza` and `kamp-lebanc` are not
  // inseparable — their stations differ, Kanal at 22 235 m and Plave at
  // 24 105 m — and that the cut at four drops that clause. So I took
  // five and measured the whole seed again:
  //
  //                        shapes shared   pairs over 80%   median
  //     four clauses          16 of 70            1          1.3%
  //     five clauses          14 of 70            2          3.2%
  //
  // The fifth clause is more words, and more words two neighbours share.
  // It removed one shape-collision and pushed `autocamp-marko` /
  // `autocamp-vesna` — two campsites 40 m apart at the mouth of the same
  // canyon — from 79% to 80.8%, over the line the duplicate-page guard
  // actually enforces. It also reads as a run-on: five comma-spliced
  // clauses is a list, not a sentence.
  //
  // So: four. `camping-nadiza` / `kamp-lebanc` stay alike, and they are
  // listed in `setting.spec.ts` as SEPARABLE-BUT-NOT-SEPARATED rather
  // than as the same place, because that is what they are.
  const picked = ranked.slice(0, 4);
  const parts = picked.map((p) => p.text);
  if (parts.length === 1) return `${upperFirst(parts[0])}.`;
  const last = parts.pop() as string;
  return `${upperFirst(parts.join(', '))}, and ${last}.`;
}
