import { NextResponse, type NextRequest } from 'next/server';
import GONE_PATHS from '@/generated/gone-paths.json';
import REGION_RENAMES from '@/generated/region-renames.json';
import SPOT_REDIRECTS from '@/generated/spot-redirects.json';

// 🔴 CAMP-284: NOTHING IN THIS REPOSITORY DEPLOYS THIS FILE.
//
// Measured on 12.10.2026, after a `next build` of this app:
//
//     .next/server/middleware-manifest.json   1 entry, matcher ^/.*$
//     .next/server/middleware.js              1 575 362 B   (378 222 gz)
//     .next/server/edge-runtime-webpack.js       44 654 B     (8 601 gz)
//     src/generated/spot-redirects.json       4 455 rules, 420 858 B
//
// So the build DOES emit an edge function over every path. What is
// missing is everything that would run it:
//
//   * `next.config.mjs` has no `output: 'export'`, so the build leaves
//     `.next/` and no `out/` — there is no directory of static files to
//     upload to Pages in the first place;
//   * there is no `@cloudflare/next-on-pages`, no wrangler config and
//     no `pages:build` script anywhere in the repository;
//   * no workflow deploys anything: `grep -rl 'deploy\|wrangler\|cloudflare'
//     .github/workflows/` is empty.
//
// Cloudflare's own Next.js guide (fetched 12.10.2026) points Pages at
// static exports and says full-stack features "including server-side
// rendering, React Server Components, Server Actions, route handlers,
// and middleware" belong on Workers. The neighbouring comment in
// scripts/security-headers.mjs — "Cloudflare Pages serves the built
// files and never runs Next's headers()" — is the same observation from
// the other side.
//
// 🔴 AND `_redirects` CANNOT HOLD THIS. Cloudflare documents the Pages
// `_redirects` file as "limited to 2,000 static redirects and 100
// dynamic redirects, for a combined total of 2,100", with no support
// for 404 or 410. We have 4 455 redirects — 2.1× the ceiling — and the
// 410 list has no expression in that format at all.
//
// This file is therefore correct and unreachable until somebody decides
// where the site runs. That decision costs money and an account, so it
// is the owner's; the numbers above are what it should be decided with.
// Until then, every 301 and every 410 written here is a promise the
// project has not yet been able to keep.

// CAMP-73 — 410 Gone for campsites OpenStreetMap has dropped.
//
// 🔴 Why this needs middleware at all. Every campsite page is
// prerendered, so a removed campsite simply stops being built and its
// URL falls through to the 404. That is not wrong, but it is weaker than
// it should be: Google treats a 404 as possibly temporary and keeps
// recrawling the URL for months, while a 410 says "gone on purpose" and
// drops it far sooner. With a weekly import we will produce a steady
// trickle of these, and we would rather spend crawl budget on campsites
// that exist.
//
// 🔴 Why the body is fetched rather than written here. Middleware runs
// on the edge runtime and cannot render React, so the alternative was a
// second copy of the page as a string in this file — which would drift
// from the real one the first time anybody changed the design. Instead
// the prerendered /gone document is fetched and returned under a 410.
// These requests are rare by definition: one per dead URL a crawler
// still remembers.

const GONE = new Set(GONE_PATHS as string[]);

// CAMP-144 — 301 for a campsite that is now shown on another page.
//
// 🔴 Two sources described one campsite and we published both. The rows
// are still there and neither was deleted: the other page carries the
// contacts from one and the official star rating from the other, so this
// URL's content did not disappear, it moved. 301 is the only status that
// says that — a 404 would discard whatever the URL had earned, and the
// 410 above would tell a crawler a business that is open has closed.
//
// 🔴 Checked BEFORE the gone list, not after. A campsite cannot honestly
// be both, but if a bug ever put one in both lists, "it moved here" is
// the answer that loses nothing, and "it is gone for ever" is the one
// that cannot be taken back out of an index.
const REDIRECTS = new Map<string, string>(
  Object.entries(SPOT_REDIRECTS as Record<string, string>),
);

// 🔴 CAMP-294, друга редакція. ПЕРША БУЛА ГІРШОЮ ЗА БАГ.
//
// Спершу я зробив `Location` відносним. Це здавалось елегантним: відносна
// адреса не залежить від того, що Next думає про себе. Рецензія показала,
// що вона ПАДАЄ: Next обгортає будь-який middleware в `adapter()`, а той
// на рядку 319 робить `new NextURL(redirect, {forceLocale, headers,
// nextConfig})` — другий аргумент це ОПЦІЇ, не база. Заміряно прямим
// викликом:
//
//     new NextURL('/camping/at/b/new', {headers})        → TypeError: Invalid URL
//     new NextURL('https://camptribe.eu/camping/at/b/new', {headers}) → OK
//
// Тобто 4 455 неправильних редиректів перетворились би на 4 455 падінь.
// Саме тому `NextResponse.redirect()` і вимагає абсолютної адреси — це
// не примха API.
//
// Правильне рішення: `Location` лишається АБСОЛЮТНИМ, але хост береться
// з того, що передав проксі, а не з адреси, на якій слухає Next.
export function publicOrigin(headers: Headers, fallback: string): string {
  // `x-forwarded-host` ставить проксі; `host` лишається, якщо проксі немає.
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) return fallback;
  const proto = headers.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

export function normalisePath(pathname: string): string {
  // Кінцеві скісні й регістр приходять зі старих посилань і від роботів,
  // і жодне з двох не має вирішувати, чи адреса переїхала.
  return pathname.replace(/\/+$/, '').toLowerCase();
}

// CAMP-289 — 301 для регіону, який перейменували.
//
// 🔴 ПРАВИЛО НА РЕГІОН, А НЕ ПАРА НА СТОРІНКУ. Карта редиректів уже на
// 80% стелі edge-бандла; пара на кожну сторінку коштувала б ~65 КБ і
// забрала б її на 92,7%. Вісім правил коштують 607 байт — бо це і є
// те, чим воно є: перейменування регіону, а не 668 окремих рішень.
const RENAMES: ReadonlyMap<string, string> = new Map(
  (REGION_RENAMES as { country: string; from: string; to: string }[]).map((r) => [
    `${r.country}/${r.from}`,
    r.to,
  ]),
);

/**
 * Новий шлях, якщо сегмент регіону переїхав. Інакше `null`.
 *
 * Працює і для сторінки кемпінга (`/camping/dk/sja-lland/x`), і для
 * хабу регіону (`/camping/dk/sja-lland`) — старе посилання на хаб таке
 * саме опубліковане, як і на кемпінг.
 */
export function renameRegion(
  pathname: string,
  renames: ReadonlyMap<string, string> = RENAMES,
): string | null {
  const parts = normalisePath(pathname).split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'camping') return null;
  const to = renames.get(`${parts[1]}/${parts[2]}`);
  if (to === undefined || to === parts[2]) return null;
  parts[2] = to;
  return `/${parts.join('/')}`;
}

export function redirectFor(
  pathname: string,
  search: string,
  origin: string,
  redirects: ReadonlyMap<string, string> = REDIRECTS,
): NextResponse | null {
  const moved = redirects.get(normalisePath(pathname));
  if (!moved) return null;

  // 🔴 Рядок запиту переноситься: читач, що прийшов за посиланням із
  // `?from=map`, має дістатись туди, куди йшов, із тим, що ніс.
  // `target.search =` нормалізує відсутню `?` — тому саме так, а не
  // конкатенацією: виклик із `'a=1'` інакше дав би `/новий-шляхa=1`.
  const target = new URL(moved, origin);
  target.search = search;
  return NextResponse.redirect(target, 301);
}

// 🔴 УВЕСЬ МАРШРУТИЗАТОР ЖИВЕ ТУТ, а не в `middleware`, і це не стиль.
//
// Спершу я дав `middleware` додаткові параметри для фікстур:
// `middleware(request, redirects = REDIRECTS, gone = GONE)`. CI впав на
// кожному запиті з `TypeError: d.get is not a function`, бо **Next кличе
// `middleware(request, event)`** — другим аргументом іде `NextFetchEvent`,
// і він прилітав замість мапи. Тобто сайт віддавав би 500 на все.
//
// Угода виклику фреймворку — частина контракту, і підпис `middleware`
// належить Next, а не нам. Тож фікстури приймає `route`, а `middleware`
// лишається рівно таким, яким його кличуть.
export function route(
  request: NextRequest,
  redirects: ReadonlyMap<string, string>,
  gone: ReadonlySet<string>,
  renames: ReadonlyMap<string, string> = RENAMES,
) {
  const origin = publicOrigin(request.headers, request.nextUrl.origin);

  // 🔴 СПЕРШУ ПЕРЕЙМЕНУВАННЯ, І ОДИН 301, А НЕ ЛАНЦЮЖОК. Якщо регіон
  // переїхав, а кемпінг на новій адресі ще й склеєний з іншим, читач
  // мав би два послідовні 301. Ми рахуємо новий шлях, питаємо карту
  // саме про нього — і віддаємо одну відповідь із кінцевою адресою.
  const renamed = renameRegion(request.nextUrl.pathname, renames);
  const effective = renamed ?? request.nextUrl.pathname;

  const redirect = redirectFor(effective, request.nextUrl.search, origin, redirects);
  if (redirect) return redirect;

  // 🔴 410 ПЕРЕВІРЯЄТЬСЯ РАНІШЕ за редирект регіону. Якщо кемпінг
  // зник, то він зник на обох адресах, і вести читача 301-им на
  // сторінку, яка одразу віддасть 410, — це два кроки замість одного
  // і гірша відповідь роботу: 301 каже «шукай далі», 410 каже «кінець».
  if (gone.has(normalisePath(effective))) {
    return serveGone(request);
  }

  // Переїхав лише регіон — ведемо туди.
  if (renamed !== null) {
    const target = new URL(renamed, origin);
    target.search = request.nextUrl.search;
    return NextResponse.redirect(target, 301);
  }

  return NextResponse.next();
}

export function middleware(request: NextRequest) {
  return route(request, REDIRECTS, GONE);
}

async function serveGone(request: NextRequest) {
  const url = new URL('/gone', request.nextUrl.origin);
  const res = await fetch(url, { headers: { 'x-ct-gone': '1' } });

  // If even that cannot be fetched, a bare 410 is still the right answer
  // — the status is the part search engines act on, and a plain body
  // beats a 500 that says nothing.
  if (!res.ok) {
    return new NextResponse('This campsite is no longer listed.', {
      status: 410,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new NextResponse(await res.text(), {
    status: 410,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // 🔴 Never cached at the edge under the campsite's own URL. The
      // /gone body is identical for every gone campsite and the reader's
      // browser fills in which one from the path, so a cached copy is
      // harmless — but a stale one would keep answering 410 after the
      // campsite came back, and objects deleted from OSM by mistake do
      // come back.
      'cache-control': 'no-store',
    },
  });
}

export const config = {
  // Only campsite URLs can be gone, and keeping the matcher narrow means
  // the middleware never runs for assets, the sitemap or the map data.
  matcher: ['/camping/:path*'],
};
