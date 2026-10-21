import type { Metadata } from "next";
import "./globals.css";
import { isPublic } from "@/lib/environment";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { headerNav } from "@/lib/navigation";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import CookieConsent from "@/components/cookie-consent";
import ErrorReporter from "@/components/error-reporter";
import { BOOTSTRAP } from "@/lib/error-bootstrap";
import { BRAND_DESCRIPTION, BRAND_TITLE } from "@/lib/brand";

// Canonical domain from Facts/project-identity.md in the Camping brain.
// Overridable via env so staging/preview deploys don't claim the production URL.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://camptribe.eu";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: BRAND_TITLE,
    template: "%s | CampTribe",
  },
  description:
    BRAND_DESCRIPTION,
  // CAMP-90. Site-wide, from the one flag. A page may still narrow this
  // further (a thin hub, a campsite OSM has dropped) — it can never
  // widen it, because Next merges child metadata over the root and the
  // children only ever say noindex.
  robots: isPublic
    ? { index: true, follow: true, googleBot: { index: true, follow: true } }
    : {
        index: false,
        follow: false,
        googleBot: { index: false, follow: false },
      },
  openGraph: {
    type: "website",
    siteName: "CampTribe",
    title: BRAND_TITLE,
    description:
      BRAND_DESCRIPTION,
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: BRAND_TITLE,
    description:
      BRAND_DESCRIPTION,
  },
};

// 🔴 CAMP-365: МАКЕТ — ЄДИНЕ МІСЦЕ, ЯКЕ ХОДИТЬ ПО МЕНЮ.
//
// Шапка одна на весь сайт, тож і запит один: `headerNav()` кешується на
// 60 секунд (`NAV_REVALIDATE_SECONDS`), і скільки б сторінок не
// віддавалось, у базу йде один запит на хвилину. Якби по дані ходила
// сама шапка, вона перестала б бути чистою, і юніт-тест не намалював би
// її без мережі.
//
// 🔴 ЗАПАСНОГО МЕНЮ В КОДІ НЕМАЄ: `headerNav()` кидає, якщо база
// недосяжна або пунктів нема. Збірка тоді падає гучно замість викласти
// сайт без навігації, а на живому сервері Next лишає попередню справну
// сторінку — читач бачить старе меню, не порожнє.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nav = await headerNav();
  // 🔴 CAMP-40: the language comes from the registry, not from a string
  // written here. This attribute and the `hreflang` on every page have to
  // agree about what language the document is in, and two hand-written
  // copies of that fact are two chances to disagree — silently, because
  // nothing validates it.
  return (
    <html lang={DEFAULT_LOCALE}>
      <head>
        {/* CAMP-88: only the `latin` cuts are preloaded — every visitor needs
            them, so waiting for the CSS to be parsed first costs visible text
            delay. `latin-ext` is deliberately not preloaded: most readers
            never need ą, ř or ț, and preloading it would download 49 KB that
            most of them throw away. */}
        <link
          rel="preload"
          href="/fonts/archivo-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/archivo-narrow-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* CAMP-92. The error listeners, installed before anything else
            can run. They used to be attached in a React effect, which
            runs after hydration — CI proved that too late: a hydration
            mismatch or a chunk that 404s throws before any effect, and
            those are the failures most likely to leave a blank page.
            This queues; components/error-reporter.tsx decides and sends,
            so the privacy rules exist in one language only. */}
        <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        {/* Drains what the head script caught. Renders null. */}
        <ErrorReporter />
        <SiteHeader nav={nav} />
        <div className="flex-1">{children}</div>
        <SiteFooter />
        {/* 🔴 Last in the document, and it blocks nothing above it. The
            banner must never be a gate: a reader who ignores it keeps the
            whole site, which is what makes any consent given freely
            given. */}
        <CookieConsent />
      </body>
    </html>
  );
}
