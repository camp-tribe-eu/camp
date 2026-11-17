import PostCards from "@/components/post-cards";
import { GridBanner, type GridBannerItem } from "@/components/grid-banner";
import { BLOG_PATH } from "@/components/blog-index";
import { postDate, postList } from "@/lib/posts";

/**
 * CAMP-443 (14, 17, 21): the owner asked for sections at the bottom of
 * /tools and /routes — blog posts and the site's other features — the way
 * the country page already ends.
 *
 * 🔴 A FAILING BLOG NEVER TAKES THE PAGE DOWN: `postList()` errors become an
 * empty list, and an empty list draws no section and no heading (a heading
 * over nothing reads as a breakage). Same rule as the country page.
 */
export async function MoreForTheTrip({
  testId,
  features,
}: {
  testId: string;
  features: readonly [GridBannerItem, GridBannerItem];
}) {
  const posts = await postList().catch(() => []);
  return (
    <div data-testid={testId}>
      {posts.length > 0 && (
        <section className="mt-12" aria-labelledby={`${testId}-blog`}>
          <h2 id={`${testId}-blog`} className="text-xl md:text-[25px]">
            From the blog
          </h2>
          <div className="mt-4">
            <PostCards
              testId={`${testId}-posts`}
              columns={3}
              items={posts.slice(0, 3).map((p) => ({
                key: p.slug,
                href: `${BLOG_PATH}/${p.slug}`,
                title: p.title,
                excerpt: p.summary ?? undefined,
                meta: p.publishedAt ? postDate(p.publishedAt) : undefined,
              }))}
            />
          </div>
        </section>
      )}
      <GridBanner className="mt-10" items={features} />
    </div>
  );
}
