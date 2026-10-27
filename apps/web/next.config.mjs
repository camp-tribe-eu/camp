import {
  cspForDevServer,
  SECURITY_HEADERS,
} from './scripts/security-headers.mjs';

/** @type {import('next').NextConfig} */

// CAMP-90: `X-Robots-Tag` at the transport level, not only in a meta tag.
//
// 🔴 A meta tag lives inside HTML. It does nothing for the sitemap XML,
// llms.txt, the woff2 fonts, or any JSON or PDF we ever serve — and
// those get indexed too. The header covers every response regardless of
// content type, which is the whole reason the card asks for it.
//
// This path covers a Node runtime (`next start`, and our own checks).
// Cloudflare Pages serves static files and ignores it, so the same
// directive is also written into `public/_headers` by
// scripts/gen-headers.mjs before every build. Two mechanisms, one
// source of truth in src/lib/environment.ts — and the pre-launch
// checker verifies both agree.

// 🔴 CAMP-383: БАНДЛЕР ЗБІРКИ — WEBPACK, ЯВНО (скрипт `build` у package.json
// каже `next build --webpack`), І ОСЬ ЧОМУ.
//
// Next 16 мовчки робить Turbopack бандлером за замовчуванням, а цей файл
// про бандлер не каже нічого — тобто без прапорця бандлер змінився б
// непомітно. Наша продакшн-збірка — 57 507 сторінок на машині 4 CPU /
// 7,7 ГБ під `--max-old-space-size=5120` (infra/bin/camptribe-deploy), і
// для Turbopack відкриті vercel/next.js #97802 (збірка насичує 4 ГБ і
// зависає або OOM) та #95745 (воркери ігнорують ліміт памʼяті).
//
// Заміряно 27.10.2026 на фікстурі CI (73 кемпінги, 183 HTML), 8 CPU /
// 16 ГБ, пік RSS усього дерева процесів (sampler, 0,5 с):
//   next 15.5.28 webpack     19 с   2 421 МБ
//   next 16.4.3  --webpack   11 с   2 051 МБ
//   next 16.4.3  Turbopack    7 с   2 459 МБ
// Turbopack швидший, але бере на 20 % більше памʼяті вже на 183
// сторінках, а як він поводиться на 57 507 — тут не заміряти. Тому
// бандлер лишається тим, яким зібрано кожен реліз досі. Перехід на
// Turbopack — окрема картка з повною збіркою на машині, не побічний
// ефект оновлення фреймворку.

const isPublic = process.env.NEXT_PUBLIC_SITE_MODE === 'public';

const nextConfig = {
  // 🔴 Do not announce the framework. It tells an attacker which
  // advisory list to read and tells a reader nothing.
  poweredByHeader: false,

  images: {
    // 🔴 Off, because we do not use it and it is the one endpoint in a
    // Next server that decodes attacker-supplied binary.
    //
    // /_next/image exists whether or not the app renders <Image>: it
    // answered requests here before this line, and it is the route
    // behind the AVIF/libheif remote-code-execution advisory
    // (GHSA-2xp9-vwfh-vxw4). We ship no images, so switching it off
    // costs nothing and removes the surface rather than relying on
    // "nobody points it at an image".
    unoptimized: true,
  },

  async headers() {
    const headers = Object.entries(SECURITY_HEADERS).map(([key, value]) => ({
      key,
      value,
    }));
    if (!isPublic) {
      headers.push({ key: 'X-Robots-Tag', value: 'noindex, nofollow' });
    }
    // 🔴 The security headers are NOT conditional on the build mode.
    // They were, in effect, before this: the only `headers()` entry was
    // the robots one, so a public build sent no security headers at all
    // from `next start` — the mode that will one day be production.
    //
    // 🔴 ONE exception, and only for `next dev`.
    //
    // Next compiles client modules through `eval` in development, so the
    // production CSP stops the browser running any of our client code.
    // Measured: /map answered 200 with full HTML and mounted nothing —
    // no map, no filters, no search, no calculator — with one console
    // line as the only evidence. `next dev` is not a deployment target
    // and never reaches a reader; `next build` and `next start` keep the
    // header exactly as production has it, and so does public/_headers.
    if (process.env.NODE_ENV === 'development') {
      const i = headers.findIndex(
        (h) => h.key === 'Content-Security-Policy',
      );
      if (i >= 0) headers[i] = { ...headers[i], value: cspForDevServer() };
    }
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
