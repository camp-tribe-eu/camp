import type { Metadata } from "next";
import "./globals.css";

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
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
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
  return (
    <html lang="en">
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
