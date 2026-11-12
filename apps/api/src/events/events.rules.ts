import { createHash, randomBytes } from 'node:crypto';

// CAMP-504 — що саме приймає запис подій, і чого він не пропускає.
// Чисті функції, без Nest і без бази: усе, що тут вирішується, перевіряється
// на даних.

/** Події над кемпінгом. Той самий перелік у CHECK міграції `EventRollups`. */
export const SPOT_EVENTS = [
  'spot_view',
  'website_click',
  'phone_click',
  'coords_copy',
  'gpx_download',
  'route_inclusion',
] as const;
export type SpotEvent = (typeof SPOT_EVENTS)[number];

/** Події, які може надіслати БРАУЗЕР. `website_click` і `route_inclusion` ставить лише сервер. */
export const BROWSER_EVENTS: readonly SpotEvent[] = [
  'spot_view',
  'phone_click',
  'coords_copy',
  'gpx_download',
];

/** Клас джерела переходу. Повного реферера не зберігаємо ніде. */
export const SOURCE_CLASSES = ['organic', 'ai', 'direct', 'other'] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];

export const SURFACES = ['search', 'map'] as const;
export type Surface = (typeof SURFACES)[number];

const SLUG = /^[a-z0-9][a-z0-9-]{0,199}$/;

/** Slug кемпінгу або null. Усе, що не схоже на slug, відкидається до бази. */
export function parseSlug(value: unknown): string | null {
  return typeof value === 'string' && SLUG.test(value) ? value : null;
}

export function parseBrowserEvent(value: unknown): SpotEvent | null {
  return typeof value === 'string' &&
    (BROWSER_EVENTS as readonly string[]).includes(value)
    ? (value as SpotEvent)
    : null;
}

export function parseSurface(value: unknown): Surface | null {
  return typeof value === 'string' &&
    (SURFACES as readonly string[]).includes(value)
    ? (value as Surface)
    : null;
}

// ── Боти ────────────────────────────────────────────────────────────────

/**
 * 🔴 Відомі боти й автоматика. Порожній user-agent — теж бот: браузер людини
 * його завжди має. Список навмисно широкий на слові `bot`/`crawl`/`spider`:
 * хибне відсікання коштує одного людського перегляду, а один краулер без
 * відсікання коштує тисяч хибних.
 */
const BOT_UA =
  /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pagespeed|phantom|puppeteer|playwright|selenium|curl\/|wget|python-requests|python-urllib|aiohttp|httpclient|go-http-client|java\/|libwww|scrapy|node-fetch|undici|axios|okhttp|perplexity|bytespider|monitor|uptime/i;

export function isBot(userAgent: unknown): boolean {
  if (typeof userAgent !== 'string') return true;
  const ua = userAgent.trim();
  return ua.length === 0 || BOT_UA.test(ua);
}

// ── Джерело переходу ────────────────────────────────────────────────────

const SEARCH_HOSTS = [
  'google',
  'bing.com',
  'duckduckgo.com',
  'ecosia.org',
  'yahoo',
  'brave.com',
  'qwant.com',
  'yandex',
  'startpage.com',
  'baidu.com',
  'seznam.cz',
];
const AI_HOSTS = [
  'chatgpt.com',
  'chat.openai.com',
  'perplexity.ai',
  'claude.ai',
  'gemini.google.com',
  'bard.google.com',
  'copilot.microsoft.com',
  'you.com',
  'phind.com',
  'poe.com',
  'chat.mistral.ai',
  'chat.deepseek.com',
  'grok.com',
];

function hostOf(ref: string): string | null {
  const text = ref.trim();
  if (text.length === 0 || text.length > 2048) return null;
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

const isHost = (host: string, name: string) =>
  host === name || host.endsWith(`.${name}`);

/** `google` = google.com, google.de, google.co.uk, але не notgoogle.com і не google.evil.example. */
const isSearch = (host: string, name: string) =>
  name.includes('.')
    ? isHost(host, name)
    : new RegExp(`(^|\\.)${name}\\.(com?\\.)?[a-z]{2,3}$`).test(host);

/**
 * 🔴 КЛАС, А НЕ РЕФЕРЕР. Із того, що прислав браузер, виходить одне слово з
 * чотирьох, а рядок далі не йде: ні в базу, ні в лог, ні у відповідь.
 *   · порожнє або наш власний хост → `direct` (зовнішнього джерела немає);
 *   · ШІ-помічники → `ai` (раніше за пошуковики: gemini.google.com);
 *   · пошуковики → `organic`;
 *   · решта → `other`.
 */
export function classifyReferrer(
  ref: unknown,
  ownHosts: readonly string[],
): SourceClass {
  if (typeof ref !== 'string' || ref.trim() === '') return 'direct';
  const host = hostOf(ref);
  if (host === null) return 'other';
  if (ownHosts.some((h) => host === h.replace(/^www\./, ''))) return 'direct';
  if (AI_HOSTS.some((n) => isHost(host, n))) return 'ai';
  if (SEARCH_HOSTS.some((n) => isSearch(host, n))) return 'organic';
  return 'other';
}

/** Наші власні хости: усе, що з них, — навігація всередині сайту. */
export function ownHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = (env.SITE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return ['camptribe.eu', 'localhost', '127.0.0.1', ...fromEnv];
}

// ── Фільтри пошуку з нульовим результатом ───────────────────────────────

const SPOT_TYPES = ['free', 'paid', 'wild', 'camper_stop', 'rv_park'];
/** Копія `AMENITY_KEYS` з apps/web/src/lib/api.ts; специфікація порівнює. */
export const AMENITY_KEYS = [
  'electricity',
  'water',
  'shower',
  'toilets',
  'dogFriendly',
  'wifi',
  'greyWater',
  'laundry',
  'wheelchair',
  'wheelchairFull',
];
const MAX_TOKENS = 16;

/**
 * Список фільтрів → канонічний рядок, або null, якщо хоч один токен поза
 * закритим переліком. Порядок не має значення (сортуємо), дублі зливаються.
 * Порожній список — дозволений: пошук без фільтрів теж буває порожнім.
 *
 * 🔴 ЗАКРИТИЙ ПЕРЕЛІК, не «будь-який короткий рядок»: у цю колонку не можна
 * покласти слово, якого немає в інтерфейсі.
 */
export function canonicalFilters(value: unknown): string | null {
  if (!Array.isArray(value) || value.length > MAX_TOKENS) return null;
  const types = new Set<string>();
  const amenities = new Set<string>();
  const flags = new Set<string>();
  for (const t of value) {
    if (typeof t !== 'string') return null;
    if (t === 'overnight' || t === 'unknown') flags.add(t);
    else if (t.startsWith('type:') && SPOT_TYPES.includes(t.slice(5)))
      types.add(t.slice(5));
    else if (t.startsWith('amenity:') && AMENITY_KEYS.includes(t.slice(8)))
      amenities.add(t.slice(8));
    else return null;
  }
  const parts: string[] = [];
  if (types.size) parts.push(`type:${[...types].sort().join(',')}`);
  if (amenities.size) parts.push(`amenity:${[...amenities].sort().join(',')}`);
  for (const f of [...flags].sort()) parts.push(f);
  return parts.join('|');
}

// ── Дедуплікація ────────────────────────────────────────────────────────

export interface DedupParts {
  ip: string;
  userAgent: string;
  object: string;
  event: string;
  day: string;
}

/**
 * 🔴 ОДНОСТОРОННІЙ ХЕШ, ЛИШЕ В ПАМʼЯТІ. sha256(сіль | IP | UA | обʼєкт |
 * подія | дата), урізаний до 16 hex. Сіль випадкова на запуск процесу й
 * ніде не зберігається: навіть з дампом памʼяті без неї хеш не підібрати
 * перебором усіх IPv4. Функція повертає рядок — що з ним робити, вирішує
 * `DailyDedup`, і ця тека не пише його нікуди.
 */
export function dedupHash(salt: string, parts: DedupParts): string {
  return createHash('sha256')
    .update(
      [
        salt,
        parts.ip,
        parts.userAgent,
        parts.object,
        parts.event,
        parts.day,
      ].join('\u0000'),
    )
    .digest('hex')
    .slice(0, 16);
}

export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

/** День за UTC, `YYYY-MM-DD`. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
