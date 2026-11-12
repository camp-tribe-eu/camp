// CAMP-504 — запис подій із боку браузера.
//
// 🔴 ЩО ЙДЕ ПО МЕРЕЖІ — і лише це: назва події з закритого переліку, slug
// кемпінгу, і ХОСТ сайту, з якого прийшов читач (не адреса й не запит). Сервер
// з хоста робить клас `organic / ai / direct / other` і викидає рядок; нічого
// не зберігається в браузері: ані cookie, ані localStorage, ані ідентифікатора.
// Дедуплікація — на сервері, в памʼяті, на добу.
//
// 🔴 НІКОЛИ НЕ КИДАЄ. Подія — побічна справа сторінки: збій запису не
// повинен бути видимим читачеві.

/** Адреса API з браузера. Порожня — події не надсилаються. Читається на виклик, не при імпорті. */
export const eventsApi = (): string => process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/** Подія, яку може надіслати браузер (копія `BROWSER_EVENTS` в API; специфікація звіряє). */
export type BrowserEvent =
  | 'spot_view'
  | 'phone_click'
  | 'coords_copy'
  | 'gpx_download';

/**
 * Куди веде посилання на сайт кемпінгу. З налаштованим API — через наш
 * редирект `/out/<slug>`, який веде ЛИШЕ на адресу з бази; без нього — прямо.
 * 🔴 Жодного URL у параметрі: slug, і більше нічого.
 */
export function websiteHref(
  slug: string,
  site: string,
  base: string = eventsApi(),
): string {
  const b = base.replace(/\/+$/, '');
  return b ? `${b}/out/${encodeURIComponent(slug)}` : site;
}

type Fetch = (url: string, init: RequestInit) => unknown;

function post(
  path: string,
  body: unknown,
  base: string,
  f: Fetch | undefined,
): void {
  const url = base.replace(/\/+$/, '');
  if (!url) return;
  try {
    const send: Fetch =
      f ?? ((u, init) => fetch(u, init).catch(() => undefined));
    void send(`${url}${path}`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* побічна справа */
  }
}

/** Хост із `document.referrer`; порожній рядок, якщо його немає. */
export function referrerHost(referrer: string): string {
  try {
    return referrer ? new URL(referrer).hostname : '';
  } catch {
    return '';
  }
}

export function sendSpotEvent(
  event: BrowserEvent,
  slug: string,
  ref: string,
  base: string = eventsApi(),
  f?: Fetch,
): void {
  post('/events', { event, slug, ref }, base, f);
}

/** Фільтри карти → токени закритого переліку (їх перевіряє API). */
export function filterTokens(state: {
  types: readonly string[];
  amenities: readonly string[];
  overnight: boolean;
  includeUnknown: boolean;
}): string[] {
  return [
    ...state.types.map((t) => `type:${t}`),
    ...state.amenities.map((a) => `amenity:${a}`),
    ...(state.overnight ? ['overnight'] : []),
    ...(state.includeUnknown ? ['unknown'] : []),
  ];
}

export function sendZeroResult(
  surface: 'search' | 'map',
  filters: string[],
  base: string = eventsApi(),
  f?: Fetch,
): void {
  post('/events/zero', { surface, filters }, base, f);
}
