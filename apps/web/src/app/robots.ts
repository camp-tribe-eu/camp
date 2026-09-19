import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://camptribe.eu";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Trip planning is a logged-in, per-user feature - nothing there is
      // meant to rank, and letting it index would waste crawl budget that
      // should go to camping-directory and route pages instead.
      disallow: ["/trips/", "/api/"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
