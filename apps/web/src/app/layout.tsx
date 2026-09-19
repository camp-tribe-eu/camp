import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

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
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
