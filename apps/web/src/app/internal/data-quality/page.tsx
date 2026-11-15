import type { Metadata } from "next";

import { PageShell } from "@/components/layout";
import {
  DataQualityUnavailable,
  DataQualityView,
} from "@/components/data-quality-view";
import { getDataQuality } from "@/lib/data-quality";

/**
 * CAMP-522 — `/internal/data-quality`: how many of our rows are
 * campsites, how many are duplicates, how many are stale, and the query
 * behind each answer.
 *
 * 🔴 INTERNAL, BY THE SAME THREE LOCKS AS `/internal/sections`:
 *   1. `robots: { index: false, follow: false }` in the metadata here;
 *   2. `Disallow: /internal/` in `robots-rules.ts`;
 *   3. it is not in the sitemap, and nothing links to it.
 * And a fourth the showcase does not need: the figures come from
 * `GET /ops/data-quality`, which answers only this server's build token.
 * The page is not secret — it is reachable by anyone who has the
 * address — it is simply not for a reader and not for a search engine.
 *
 * 🔴 RENDERED PER REQUEST, NEVER AT BUILD. A static page would bake
 * today's counts into the build and go on showing them after tomorrow's
 * import — the exact defect the card was opened for (CAMP-508: typed
 * figures that had moved a day later). The API keeps one measurement for
 * ten minutes, which is all the caching this needs.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Data quality",
  robots: { index: false, follow: false },
};

export default async function DataQualityPage() {
  const answer = await getDataQuality();
  return (
    <PageShell rhythm="tight">
      <h1 className="text-3xl text-heading">Data quality</h1>
      {answer.report ? (
        <DataQualityView report={answer.report} />
      ) : (
        <DataQualityUnavailable why={answer.why} />
      )}
    </PageShell>
  );
}
