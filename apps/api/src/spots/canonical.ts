// The rules that build a campsite's URL, and read its amenities.
//
// 🔴 Separate from spots.service.ts so they can be unit-tested. The
// service imports @nestjs/typeorm, which ships as ESM; Jest runs
// CommonJS here and will not parse it, so a spec that reached these
// through the service could not run at all. Measured on 22.09.2026:
// the whole query layer sat at 0% unit coverage for exactly this
// reason, and these two functions are the ones that must never change
// behaviour — CAMP-87 is explicit that a published URL does not move.

import { transliterate } from './transliterate';
import {
  AMENITY_KEYS,
  AmenityValue,
  CampingSpotAmenities,
} from '../osm/tag-mapping';

/**
 * "Šibensko-Kninska" → "sibensko-kninska".
 *
 * 🔴 Accents are stripped rather than transliterated. Croatian and
 * Slovenian region names are full of them, and a URL with a literal Š in
 * it is percent-encoded by every client differently on the way into logs,
 * sitemaps and search consoles. An empty region gives an empty segment,
 * which the caller must not publish.
 */
/**
 * The letters NFD cannot take apart, and what they become.
 *
 * 🔴 CAMP-290: `.normalize('NFD')` strips COMBINING marks — `å` is
 * a + ring, `ö` is o + diaeresis, `é` is e + acute — and those were
 * always handled. `æ`, `ø`, `œ`, `ß`, `ł` and `đ` are not a letter plus
 * a mark; they are letters. NFD leaves them whole, and the next step
 * turned anything outside the allowed class into a hyphen. Measured in
 * the database on 12.10.2026: 921 campsites and 3 regions were
 * published with a hyphen where a letter belongs —
 *
 *     Søby Strand Camping          →  /s-by-strand-camping
 *     Großostheim                  →  /gro-ostheim
 *     Camping & Feriecenter Samsø  →  /camping-feriecenter-sams
 *     Łódź                         →  /odz
 *
 * — an address nobody searches for and no engine ties back to the name
 * on the page. DK 510, DE 242, PL 146, and the rest.
 *
 * 🔴 `ø → o`, NOT `oe`, AND THE CHOICE IS WRITTEN DOWN BECAUSE IT IS
 * NOT THE ONLY DEFENSIBLE ONE. The official Danish ASCII form is `oe`,
 * but the addresses Danish sites actually use and link to are
 * overwhelmingly `o` (`soby`, not `soeby`). `æ → ae` reads the same in
 * both traditions, and German `ß → ss` has no second reading. A slug is
 * frozen once published (`slug` is deliberately absent from the
 * upsert's DO UPDATE, CAMP-87), so this is decided once.
 *
 * 🔴 AND THE PROJECT HAD ALREADY DECIDED IT, in the half that works.
 * `apps/web/src/lib/search.ts` folds a query with its own table —
 * `ø→o`, `æ→ae`, `œ→oe`, `ß→ss`, `ł→l`, `đ→d`, `ð→d`, `þ→th` — so a
 * reader searching "Søby" matches the campsite, and then arrives at
 * `/s-by-strand-camping`. The search knew; the address did not. This
 * table is the same one, which is the point: the two must agree or the
 * site contradicts itself between the box and the bar.
 */
/** Combining marks, the ones NFD does split off. */
const COMBINING = /[\u0300-\u036f]/g;

const UNDECOMPOSABLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/æ/g, 'ae'],
  [/Æ/g, 'ae'],
  [/œ/g, 'oe'],
  [/Œ/g, 'oe'],
  [/ø/g, 'o'],
  [/Ø/g, 'o'],
  [/ß/g, 'ss'],
  [/ẞ/g, 'ss'],
  [/ł/g, 'l'],
  [/Ł/g, 'l'],
  [/đ/g, 'd'],
  [/Đ/g, 'd'],
  [/ħ/g, 'h'],
  [/Ħ/g, 'h'],
  [/ŧ/g, 't'],
  [/Ŧ/g, 't'],
  [/ŋ/g, 'n'],
  [/Ŋ/g, 'n'],
  [/ð/g, 'd'],
  [/Ð/g, 'd'],
  [/þ/g, 'th'],
  [/Þ/g, 'th'],
];

/**
 * A name reduced to the letters a URL may carry.
 *
 * The one place both slugifiers agree: a campsite's own address and the
 * address of the region it sits in are built from this, so they cannot
 * drift apart.
 */
export function foldToAscii(text: string): string {
  // 🔴 AFTER the decomposition, not before, and the first version had
  // it the other way round with a comment claiming the opposite.
  //
  // Review measured it: `ǿ` is ø + acute and `ǽ` is æ + acute, so NFD
  // splits the mark off and leaves the base letter for this table to
  // take. Folding first meant NFD never saw them and the character
  // class turned them into a hyphen — the very defect this function
  // exists to remove. No row in the database carries one today, which
  // is exactly why the wrong order survived: the comment asserted a
  // reason nobody had checked.
  // 🔴 CAMP-291: Greek and Cyrillic BEFORE the decomposition, and the
  // table owns its accents for exactly that reason.
  //
  // Both orders were tried on the live rows. Transliterating after NFD
  // read `й` as `и` — the breve had already been stripped — and wrote
  // «Чайка» as `chaika` instead of `chayka`. Transliterating before NFD
  // with the accents left out of the table wrote `Αστερίας` as
  // `aster-as`. A script this table owns, it owns whole, and then the
  // decomposition below has only Latin left to work on.
  //
  // Nothing else can help these two: NFD has no Latin letter to fall
  // back to, so a Greek or Bulgarian name left no letter at all and the
  // campsite was published as `spot-<osm_ref>` — 188 pages, 93 of
  // Greece's 102 campsites and 89 of Bulgaria's 91.
  let out = transliterate(text).normalize('NFD').replace(COMBINING, '');
  for (const [from, to] of UNDECOMPOSABLE) out = out.replace(from, to);
  return out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function slugifyRegion(region: string | null): string {
  if (!region) return '';
  // 🔴 NOT `foldToAscii`, AND THIS IS THE WHOLE POINT OF THE REVIEW
  // THAT CAUGHT IT.
  //
  // `canonicalPath` builds the region segment from this on every call,
  // and the campsite page declares `dynamicParams = false` with
  // `generateStaticParams` taken from the current index. So changing
  // this does not add a URL — it MOVES one, and the old path stops
  // being built at all: 350 published pages would answer 404 rather
  // than 301 (DK Sjaælland 306, PL Łódź 41, MT Mellieħa 3, measured).
  //
  // No redirect could catch them either: `SPOT_REDIRECTS` is generated
  // from `spot_links`, which describes "campsite A → campsite B", and
  // knows nothing about a region being renamed.
  //
  // CAMP-288 refused this same step one day ago, in writing, and this
  // function would have taken it by accident. The fold arrives here
  // together with the redirects, in CAMP-289 — not before.
  return region
    .normalize('NFD')
    .replace(COMBINING, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The one address a campsite has — or null, when it has none.
 *
 * 🔴 Null, not a path with a hole in it.
 *
 * This returned `/camping/cy//arazi` for a campsite with no region: a
 * double slash, a 404, and a link the map was already offering. Measured
 * 24.09.2026: 135 campsites carry no region, and every one of them had a
 * broken link on the map — 36 of those are on Cyprus, where the boundary
 * file gives no ISO code and CAMP-125 has yet to decide what to call the
 * area.
 *
 * A campsite without a region has no page, because the page URL is built
 * from the region (CAMP-34). The location is still real and still belongs
 * on the map; what must not happen is a link that promises a page and
 * lands on a 404. Callers get null and have to say so.
 */
export function canonicalPath(
  country: string,
  region: string | null,
  slug: string,
): string | null {
  const where = slugifyRegion(region);
  if (!where || !country || !slug) return null;
  return `/camping/${country.toLowerCase()}/${where}/${slug}`;
}

/**
 * The stored jsonb, read as a complete amenity set.
 *
 * A value we cannot read is unknown, never "no": a row written before an
 * amenity existed simply has no such key, and a missing key is not a
 * denial. Every read path goes through this, so the page and the map
 * cannot disagree about which amenities exist.
 */
export function readAmenities(stored: unknown): CampingSpotAmenities {
  const raw = (stored ?? {}) as Partial<CampingSpotAmenities>;
  return Object.fromEntries(
    AMENITY_KEYS.map((k) => [
      k,
      Object.values(AmenityValue).includes(raw[k] as AmenityValue)
        ? (raw[k] as AmenityValue)
        : AmenityValue.UNKNOWN,
    ]),
  ) as unknown as CampingSpotAmenities;
}
