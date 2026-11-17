import { expect, test } from "@playwright/test";

import { MoreForTheTrip } from "@/components/more-for-the-trip";
import { renderAsyncComponent } from "./render-component";

/**
 * CAMP-443 (14, 17, 21): blog + two feature cards at the bottom of /tools
 * and /routes. A failing blog draws no blog section — no heading over
 * nothing — and never takes the cards down with it.
 */
const features = [
  { image: { src: "/banners/routes.webp" }, heading: "Road trips", text: "t", cta: { href: "/routes", label: "See the routes" } },
  { image: { src: "/banners/guides.webp" }, heading: "Guides", text: "t", cta: { href: "/guides", label: "Read the guides" } },
] as const;

async function withFetch(impl: (url: string) => Response, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = ((url: string) => Promise.resolve().then(() => impl(String(url)))) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const post = (n: number) => ({ slug: `p${n}`, title: `Post ${n}`, summary: "s", publishedAt: "2026-11-0" + n + "T10:00:00Z" });

test("blog section with the three newest posts, then the two feature cards", async () => {
  await withFetch(
    (url) => (url.includes("/posts") ? json({ posts: [post(1), post(2), post(3), post(4)] }) : new Response("", { status: 404 })),
    async () => {
      const html = await renderAsyncComponent(MoreForTheTrip, { testId: "tools-more", features });
      expect(html).toContain("From the blog");
      expect(new Set(html.match(/href="\/blog\/p\d"/g)).size).toBe(3);
      expect(html).not.toContain('href="/blog/p4"');
      expect(html).toContain('href="/routes"');
      expect(html).toContain('href="/guides"');
    },
  );
});

test("🔴 the blog is down: no blog heading, the feature cards still render", async () => {
  await withFetch(
    () => new Response("boom", { status: 503 }),
    async () => {
      const html = await renderAsyncComponent(MoreForTheTrip, { testId: "routes-more", features });
      expect(html).not.toContain("From the blog");
      expect(html).toContain('href="/routes"');
      expect(html).toContain('href="/guides"');
    },
  );
});
