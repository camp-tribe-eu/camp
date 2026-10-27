import { formatOvernightDay } from './overnight';

// The stat tiles and the FAQ of the hub pages (design-audit §11, screens
// 1 and 2), from the counts the API took over OUR rows
// (apps/api/src/spots/hub-stats.ts). The survey the card stands on is
// docs/region-insight-survey.md (27.10.2026).
//
// 🔴 A FIGURE IS PRINTED ONLY FROM A FIELD THAT IS FILLED IN. The mock-up
// shows "From €9 / night", "Open in September" and "Above 1 000 m"; the
// base has a dated overnight price for 1 site in 52 549, no season at
// all, and a height for 2 %. A tile is printed when the field it rests on
// is recorded for at least FILL_MIN of the region's sites AND for at
// least MIN_KNOWN of them (`enoughRecorded`) — and below that it is not
// printed as "—" or "n/a", it is not printed. This is the one lock on
// the threshold; the API sends raw counts. Removing it is the first
// mutation hub-screens.spec.tsx exists to catch.
//
// 🔴 THE DENOMINATOR IS WHAT IS KNOWN, NEVER THE REGION. "12 of the 15
// sites where OpenStreetMap records it" — the 15 is yes + no, added up
// HERE, so a site nobody tagged is in neither, and the sites with no
// record are named in the same tile. In OSM an empty tag means "nobody
// wrote it", not "no" (osm/import-spots.ts). Printing "12 of 100" is the
// second mutation the spec catches. The one exception is `type`, which
// is recorded on every row (survey §1: 100 %), so "Free & wild spots"
// counts against the region itself.
//
// 🔴 THE FAQ ASKS ONLY WHAT OUR DATA ANSWERS. A question whose answer
// would need data we do not hold — when the season opens, what a night
// costs, whether wild camping is legal — is not asked. A region with one
// answer prints one question; three is the ceiling, not the norm. No
// percentages, and every block carries the day its figures were read —
// the two rules of OvernightCoverage (CAMP-255).

/** Share of a region's sites a field must be recorded for. */
export const FILL_MIN = 0.2;
/** And at least this many sites, whatever the share. */
export const MIN_KNOWN = 5;

export interface HubRegionStats {
  region: string;
  slug: string;
  spots: number;
  readAt: string | null;
  freeWild: number;
  electricity: { yes: number; no: number };
  overnight: { allowed: number; forbidden: number };
  price: { known: number; minEur: string | null };
}

export interface HubTile {
  /** What the tile is about: the key a test picks it out by. */
  key: 'campsites' | 'free-wild' | 'regions' | 'electricity' | 'price';
  label: string;
  value: string;
  /** The denominator and the unrecorded, where the value has them. */
  note?: string;
}

export interface HubFaqItem {
  key: 'free' | 'overnight' | 'electricity';
  question: string;
  answer: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONEY = /^\d+(\.\d{1,2})?$/;

const count = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;

/**
 * One row of the API payload → the counts the page may use, or null.
 *
 * Every figure must be a non-negative integer, every day a day and the
 * price money: a row that disagrees with that shape yields NO row rather
 * than a tile with "undefined" in it.
 */
export function readHubRegionStats(raw: unknown): HubRegionStats | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.region !== 'string' || r.region === '') return null;
  if (typeof r.slug !== 'string' || r.slug === '') return null;
  const spots = count(r.spots);
  const freeWild = count(r.freeWild);
  if (spots === null || freeWild === null || freeWild > spots) return null;

  const e = (r.electricity ?? {}) as Record<string, unknown>;
  const yes = count(e.yes);
  const no = count(e.no);
  if (yes === null || no === null || yes + no > spots) return null;

  const o = (r.overnight ?? {}) as Record<string, unknown>;
  const allowed = count(o.allowed);
  const forbidden = count(o.forbidden);
  if (allowed === null || forbidden === null || allowed + forbidden > spots) {
    return null;
  }

  const p = (r.price ?? {}) as Record<string, unknown>;
  const known = count(p.known);
  if (known === null || known > spots) return null;
  let minEur: string | null = null;
  if (p.minEur !== null && p.minEur !== undefined) {
    if (typeof p.minEur !== 'string' || !MONEY.test(p.minEur)) return null;
    minEur = p.minEur;
  }
  if ((known > 0) !== (minEur !== null)) return null;

  return {
    region: r.region,
    slug: r.slug,
    spots,
    readAt: typeof r.readAt === 'string' && DAY.test(r.readAt) ? r.readAt : null,
    freeWild,
    electricity: { yes, no },
    overnight: { allowed, forbidden },
    price: { known, minEur },
  };
}

/**
 * 🔴 One bad row costs one row, never the payload: the rows that read
 * are kept, the ones that do not are dropped, and a region whose row is
 * dropped simply gets no tiles.
 */
export function readHubStats(raw: unknown): HubRegionStats[] {
  if (!Array.isArray(raw)) return [];
  const out: HubRegionStats[] = [];
  for (const row of raw) {
    const r = readHubRegionStats(row);
    if (r) out.push(r);
  }
  return out;
}

/** 🔴 The gate. `known` is yes + no (or sites with a price), never `spots`. */
export function enoughRecorded(known: number, spots: number): boolean {
  return known >= MIN_KNOWN && known >= spots * FILL_MIN;
}

const n = (v: number) => v.toLocaleString('en-GB');

/** `9.00` → "€9", `12.50` → "€12.50": money as the feed wrote it, no rounding. */
export function formatEur(minEur: string): string {
  const [whole, frac] = minEur.split('.');
  return frac === undefined || /^0+$/.test(frac) ? `€${whole}` : `€${whole}.${frac}`;
}

/** The lowest price across rows, as text, or null when no row has one. */
function lowestEur(rows: readonly HubRegionStats[]): string | null {
  let best: string | null = null;
  for (const r of rows) {
    const v = r.price.minEur;
    if (v !== null && (best === null || Number(v) < Number(best))) best = v;
  }
  return best;
}

function priceTile(known: number, spots: number, minEur: string | null): HubTile | null {
  if (!enoughRecorded(known, spots) || minEur === null) return null;
  return {
    key: 'price',
    label: 'From',
    value: `${formatEur(minEur)} a night`,
    note: `lowest dated overnight rate; ${n(known)} of the ${n(spots)} sites have one`,
  };
}

/**
 * Screen 1 — the country page: campsites, free & wild spots, regions, and
 * a price only where enough sites carry one. Empty when there is nothing
 * to count: no tiles, not four zeros.
 */
export function countryTiles(rows: readonly HubRegionStats[]): HubTile[] {
  if (rows.length === 0) return [];
  const spots = rows.reduce((s, r) => s + r.spots, 0);
  if (spots === 0) return [];
  const freeWild = rows.reduce((s, r) => s + r.freeWild, 0);
  const priceKnown = rows.reduce((s, r) => s + r.price.known, 0);
  const out: HubTile[] = [
    { key: 'campsites', label: 'Campsites', value: n(spots) },
    {
      key: 'free-wild',
      label: 'Free & wild spots',
      value: n(freeWild),
      note: 'free campsites and wild camping spots, by their OpenStreetMap tag',
    },
    { key: 'regions', label: 'Regions', value: n(rows.length) },
  ];
  const price = priceTile(priceKnown, spots, lowestEur(rows));
  if (price) out.push(price);
  return out;
}

/**
 * Screen 2 — the region page: campsites, free & wild spots, electricity
 * where enough sites have a record, a price where enough carry one.
 */
export function regionTiles(r: HubRegionStats): HubTile[] {
  if (r.spots === 0) return [];
  const out: HubTile[] = [
    { key: 'campsites', label: 'Campsites', value: n(r.spots) },
    {
      key: 'free-wild',
      label: 'Free & wild spots',
      value: n(r.freeWild),
      note: 'free campsites and wild camping spots, by their OpenStreetMap tag',
    },
  ];
  const known = r.electricity.yes + r.electricity.no;
  if (enoughRecorded(known, r.spots)) {
    const unknown = r.spots - known;
    out.push({
      key: 'electricity',
      label: 'Electricity',
      value: `${n(r.electricity.yes)} of ${n(known)}`,
      note:
        `sites where OpenStreetMap records it` +
        (unknown === 0
          ? ''
          : `; ${n(unknown)} ${unknown === 1 ? 'site has' : 'sites have'} no record`),
    });
  }
  const price = priceTile(r.price.known, r.spots, r.price.minEur);
  if (price) out.push(price);
  return out;
}

/** The latest day any row was read, as OvernightCoverage takes it. */
export function hubStatsReadAt(rows: readonly HubRegionStats[]): string | null {
  let best: string | null = null;
  for (const r of rows) {
    if (r.readAt !== null && (best === null || r.readAt > best)) best = r.readAt;
  }
  return best;
}

/** "Counted from our listings as of 16 October 2026." or null without a day. */
export function countedAsOf(readAt: string | null): string | null {
  return readAt ? `Counted from our listings as of ${formatOvernightDay(readAt)}.` : null;
}

/**
 * The questions a region page may ask, each one answered from this
 * region's own counts. In reading order; at most three; often one.
 */
export function regionFaq(r: HubRegionStats): HubFaqItem[] {
  if (r.spots === 0) return [];
  const out: HubFaqItem[] = [];
  const asOf = countedAsOf(r.readAt);
  const tail = asOf ? ` ${asOf}` : '';
  const sites = `${n(r.spots)} ${r.spots === 1 ? 'site' : 'sites'} we list in ${r.region}`;

  // `type` is recorded for every row, so this question always has its
  // answer — a zero here is a count, not a gap.
  //
  // 🔴 Four shapes, not two. "21 of the 21 sites … the other 0 are
  // campsites" was printed on 8 regions (ee/Jõgeva, seven single-site
  // regions of Latvia): when every site is free there is no "other", and
  // the sentence says "all" — or, for one site, "the one site".
  const free =
    r.freeWild === 0
      ? `None of the ${sites} carries a free-camping or wild-camping tag in OpenStreetMap.`
      : r.freeWild === r.spots
        ? r.spots === 1
          ? `The one site we list in ${r.region} is a free campsite or a wild camping spot by its OpenStreetMap tag.`
          : `All ${n(r.spots)} sites we list in ${r.region} are free campsites or wild camping spots by their OpenStreetMap tag.`
        : `${n(r.freeWild)} of the ${sites} ${
            r.freeWild === 1 ? 'is a free campsite or a wild camping spot' : 'are free campsites or wild camping spots'
          } by their OpenStreetMap tag; the other ${n(r.spots - r.freeWild)} are campsites, motorhome parks or camper stops.`;
  out.push({
    key: 'free',
    question: `Are there free places to camp in ${r.region}?`,
    answer: free + tail,
  });

  const ov = r.overnight.allowed + r.overnight.forbidden;
  if (enoughRecorded(ov, r.spots)) {
    const unknown = r.spots - ov;
    out.push({
      key: 'overnight',
      question: `Can a motorhome stay overnight at campsites in ${r.region}?`,
      answer:
        `For ${n(r.overnight.allowed)} of the ${sites}, OpenStreetMap says an overnight stay in a motorhome is allowed` +
        (r.overnight.forbidden > 0 ? `, and for ${n(r.overnight.forbidden)} that it is not` : '') +
        `.` +
        (unknown > 0
          ? ` For the other ${n(unknown)} we do not know, which is not the same as not allowed.`
          : '') +
        tail,
    });
  }

  const el = r.electricity.yes + r.electricity.no;
  if (enoughRecorded(el, r.spots)) {
    const unknown = r.spots - el;
    out.push({
      key: 'electricity',
      question: `Do campsites in ${r.region} have electricity?`,
      answer:
        `Of the ${n(el)} sites where OpenStreetMap records whether there is electricity, ${
          r.electricity.no === 0
            ? `all ${n(el)} have it`
            : r.electricity.yes === 0
              ? 'none has it'
              : `${n(r.electricity.yes)} ${r.electricity.yes === 1 ? 'has' : 'have'} it and ${n(r.electricity.no)} ${r.electricity.no === 1 ? 'does' : 'do'} not`
        }.` +
        (unknown > 0
          ? ` The other ${n(unknown)} ${unknown === 1 ? 'site has' : 'sites have'} no record either way.`
          : '') +
        tail,
    });
  }

  return out;
}
