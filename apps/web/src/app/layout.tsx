import type { Metadata } from "next";
import "./globals.css";
import { isPublic } from "@/lib/environment";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { DEFAULT_LOCALE } from "@/lib/i18n";
import CookieConsent from "@/components/cookie-consent";

// Canonical domain from Facts/project-identity.md in the Camping brain.
// Overridable via env so staging/preview deploys don't claim the production URL.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://camptribe.eu";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "CampTribe — Plan Better. Camp Smarter.",
    template: "%s | CampTribe",
  },
  description:
    "Find campsites, plan routes and book camper rentals across Europe in one place.",
  // CAMP-90. Site-wide, from the one flag. A page may still narrow this
  // further (a thin hub, a campsite OSM has dropped) — it can never
  // widen it, because Next merges child metadata over the root and the
  // children only ever say noindex.
  robots: isPublic
    ? { index: true, follow: true, googleBot: { index: true, follow: true } }
    : { index: false, follow: false, googleBot: { index: false, follow: false } },
  openGraph: {
    type: "website",
    siteName: "CampTribe",
    title: "CampTribe — Plan Better. Camp Smarter.",
    description:
      "Find campsites, plan routes and book camper rentals across Europe in one place.",
    url: siteUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "CampTribe — Plan Better. Camp Smarter.",
    description:
      "Find campsites, plan routes and book camper rentals across Europe in one place.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
      </head>
      <body className="flex min-h-screen flex-col antialiased">
        <SiteHeader />
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
