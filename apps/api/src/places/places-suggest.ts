// CAMP-456 — підказки місць для /plan: «Ant» → Антверпен (місто, Бельгія).
//
// 🔴 ЛИШЕ З ТОГО, ЩО Є В НАШІЙ БАЗІ. Три джерела, і кожне — наявна таблиця:
//   · `camping_spots`  — кемпінги (ті самі, що на сайті: опубліковані, не вторинні);
//   · `osm_ctx_place`  — міста, містечка й села з OSM (`place=city|town|village`);
//   · `ne_admin1`      — регіони Natural Earth.
// Зовнішнього геокодера немає й не додається (docs/trip-planner-design.md,
// крок 3: «газетир замість геокодера»).
//
// 🔴 ЩО ЦЕ НЕ ВМІЄ, і це межа, а не недогляд: назви в `osm_ctx_place` —
// ЛОКАЛЬНІ (`name`; `name:en` пайплайн не завантажує, див. lib/search.ts у
// вебі). «München» знайдеться за «Mun», «Munich» — ні. Сторінка каже це
// словами, а не мовчить.
//
// 🔴 ОБЛАСТЬ — ЄС-27. Країну знайденого населеного пункту визначає ТОЙ САМИЙ
// `countrySql`, що й планувальник (`osm_ctx_place` тримає смугу за кордоном:
// Калінінград у польському екстракті), а не колонка `country`, якої на
// будь-якій копії бази може не бути. Кіпр, прихований рішенням власника
// (`UNPUBLISHED_COUNTRIES`), не пропонується.

/** Скільки літер мінімум: три, як у прикладі власника («Ant»). */
export const MIN_QUERY = 3;
/** Найдовше, що береться; довше — 400, а не мовчазне обрізання. */
export const MAX_QUERY = 60;
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 10;

export type SuggestKind = 'city' | 'town' | 'village' | 'region' | 'campsite';

export interface Suggestion {
  kind: SuggestKind;
  name: string;
  /** Нижній регістр, ISO 3166-1 alpha-2, як `searchDocuments`. */
  country: string;
  lat: number;
  lon: number;
  /** Лише для кемпінгу: його slug і адреса сторінки на цьому сайті. */
  slug?: string;
  path?: string;
}

// Групами «літера → її форми», а не двома рядками однакової довжини: два
// рядки, зіставлені позиційно, одного дня зсунуться на один знак, і «ř»
// стане «s» без жодної помилки.
const GROUPS: ReadonlyArray<readonly [string, string]> = [
  ['a', 'àáâãäåāăąæ'],
  ['c', 'çćč'],
  ['d', 'ďđ'],
  ['e', 'èéêëēęě'],
  ['g', 'ğ'],
  ['i', 'ìíîïīį'],
  ['l', 'ł'],
  ['n', 'ñńň'],
  ['o', 'òóôõöøōőœ'],
  ['r', 'ř'],
  ['s', 'śšşșß'],
  ['t', 'ťţț'],
  ['u', 'ùúûüūůűų'],
  ['y', 'ýÿ'],
  ['z', 'źżž'],
];

const MAP = new Map<string, string>();
for (const [base, forms] of GROUPS) for (const ch of forms) MAP.set(ch, base);

/**
 * Рядок для порівняння: малі літери, діакритику знято, дефіс і апостроф —
 * пробіл, усе, що не літера, цифра чи пробіл, прибране. Один і той самий
 * для назв (при побудові індексу) і для запиту, тож вони не розійдуться.
 *
 * `ß` → `s` (а не `ss`) — прийнятно для префікса: «stras» знаходить
 * «Straße» і «Strasse».
 */
export function foldForSearch(text: string): string {
  // NFD знімає наголос і діакритику в усіх письмах (грецький «ή» → «η», «é» → «e»),
  // а таблиця нижче бере те, що NFD не розкладає: ł, ø, đ, æ, œ, ß.
  let out = '';
  for (const ch of text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')) {
    if (ch === '-' || ch === '’' || ch === "'") out += ' ';
    else out += MAP.get(ch) ?? ch;
  }
  return out
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type ParsedSuggest =
  | { ok: true; q: string; limit: number }
  | {
      ok: false;
      code:
        | 'query_missing'
        | 'query_too_short'
        | 'query_too_long'
        | 'limit_invalid';
    };

/** Тіло запиту — недовірений вхід: тип, довжина, межа. */
export function parseSuggestQuery(
  rawQ: unknown,
  rawLimit?: unknown,
): ParsedSuggest {
  if (typeof rawQ !== 'string') return { ok: false, code: 'query_missing' };
  if (rawQ.length > MAX_QUERY) return { ok: false, code: 'query_too_long' };
  const q = foldForSearch(rawQ);
  // Три ЛІТЕРИ, а не три знаки: «a b» — це дві літери з пробілом.
  if ([...q.replace(/\s/g, '')].length < MIN_QUERY)
    return { ok: false, code: 'query_too_short' };
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    // Число в JSON, а не рядок: тіло — не адреса, і «"3"» тут не число.
    if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit)) {
      return { ok: false, code: 'limit_invalid' };
    }
    limit = rawLimit;
    if (limit < 1 || limit > MAX_LIMIT)
      return { ok: false, code: 'limit_invalid' };
  }
  return { ok: true, q, limit };
}

/** Порядок видів за однакового збігу: великі пункти раніше за малі, кемпінги після населених. */
const KIND_ORDER: Record<SuggestKind, number> = {
  city: 0,
  town: 1,
  region: 2,
  village: 3,
  campsite: 4,
};

/** Slug із адреси — той самий алфавіт, що в URL кемпінгу. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

// ── Індекс у памʼяті ──────────────────────────────────────────────────

/**
 * Запис індексу. `f` — згорнута назва, за якою шукають; `name` — як
 * надрукувати. Країна в населених пунктів порожня до відповіді бази: її
 * визначають лише для тих, що пройшли відбір.
 */
export interface IndexEntry {
  f: string;
  kind: SuggestKind;
  name: string;
  lat: number;
  lon: number;
  country: string;
  slug?: string;
  path?: string;
}

export type Hit = IndexEntry & { lead: boolean };

type Group = 'place' | 'region' | 'campsite';
const groupOf = (e: IndexEntry): Group =>
  e.kind === 'campsite' ? 'campsite' : e.kind === 'region' ? 'region' : 'place';

/**
 * 🔴 ЧОМУ ПАМʼЯТЬ, А НЕ ЗАПИТ НА КОЖНУ ЛІТЕРУ. Сканування 253 тисяч
 * населених пунктів і 63 тисяч кемпінгів у базі коштує секунди (заміряно на
 * копії), а підказка живе рівно доти, доки людина не набрала ще одну
 * літеру. Індекс будується одним читанням, пошук по ньому — один прохід
 * по масиву. Ціна — застарілість: новий кемпінг зʼявиться в підказках після
 * перебудови індексу (`TTL_MS` у сервісі), а `GET /places/campsite/:slug`
 * читає базу напряму.
 */
export class PlaceIndex {
  constructor(private readonly entries: readonly IndexEntry[]) {}

  get size(): number {
    return this.entries.length;
  }

  /**
   * Кандидати за запитом, не більше `caps` кожної групи (населені пункти,
   * регіони, кемпінги), найкращі першими: які починаються з введеного,
   * потім які мають його на початку слова; далі вид, коротша назва, алфавіт.
   * `q` — уже згорнутий (`parseSuggestQuery`).
   */
  search(q: string, caps: Record<Group, number>): Hit[] {
    const inside = ` ${q}`;
    const hits: Hit[] = [];
    for (const e of this.entries) {
      const lead = e.f.startsWith(q);
      if (lead || e.f.includes(inside)) hits.push({ ...e, lead });
    }
    hits.sort(compare);
    const taken: Record<Group, number> = { place: 0, region: 0, campsite: 0 };
    return hits.filter((e) => {
      const g = groupOf(e);
      if (taken[g] >= caps[g]) return false;
      taken[g] += 1;
      return true;
    });
  }
}

function compare(a: Hit, b: Hit): number {
  return (
    Number(b.lead) - Number(a.lead) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    a.name.length - b.name.length ||
    a.name.localeCompare(b.name, 'en') ||
    (a.slug ?? '').localeCompare(b.slug ?? '')
  );
}

/**
 * Кандидати → видача: однакові (вид, назва, країна, slug) — один раз, не
 * більше `limit`, у порядку `compare`. Країна в кожного вже відома.
 */
export function rank(hits: Hit[], limit: number): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const h of [...hits].sort(compare)) {
    // Регіон має дві назви (місцеву й англійську) в одній точці: це ОДНЕ
    // місце, тож його ключ — точка, а не назва.
    const key =
      h.kind === 'region'
        ? `region|${h.lat},${h.lon}|${h.country}`
        : `${h.kind}|${h.f}|${h.country}|${h.slug ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item: Suggestion = {
      kind: h.kind,
      name: h.name,
      country: h.country,
      lat: h.lat,
      lon: h.lon,
    };
    if (h.slug !== undefined) item.slug = h.slug;
    if (h.path !== undefined) item.path = h.path;
    out.push(item);
    if (out.length === limit) break;
  }
  return out;
}
