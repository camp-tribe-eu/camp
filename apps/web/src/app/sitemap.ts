import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://camptribe.eu";

// Static routes for now. Once /camping/{country}/{region}/{slug} and
// /routes/{slug} pages exist (CAMP-5, CAMP-3), this fetches from the API
// and appends those entries here - one sitemap function, not one per
// content type, so a new content type can't be added to the site while
// forgetting to add it to the sitemap.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
