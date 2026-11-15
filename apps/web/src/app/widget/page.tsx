import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { alternatesFor } from "@/lib/i18n";
import { pageContent } from "@/lib/page-content";
import { PageSections } from "@/components/page-sections";
import { embedSnippet, WIDGET_PAGE, WIDGET_SLOTS } from "@/lib/provider-widget";
import { SITE } from "@/lib/sitemap";

// CAMP-523 — the manual for a campsite that wants the widget on its own
// website. The widget itself is `/embed/camping/…` (a route handler); this
// is an ordinary page of the site and is served under the ordinary policy.
//
// 🔴 EVERY WORD COMES FROM THE CMS PAGE `provider-widget` — the same page
// the widget reads its four labels from, so the owner edits both in one
// place. The only thing built here is the snippet, and it is built by the
// same function the tests frame from another origin: the markup a
// campsite copies is the markup that was measured.

const PATH = "/widget";

/** Stand-ins a campsite replaces with the three parts of its own address. */
const EXAMPLE = { country: "COUNTRY", region: "REGION", slug: "CAMPSITE" };

export async function generateMetadata(): Promise<Metadata> {
  const page = await pageContent(WIDGET_PAGE);
  if (!page) return { title: "Not found" };
  return {
    title: page.metaTitle ?? page.title,
    description: page.metaDescription ?? undefined,
    alternates: alternatesFor(PATH),
    ...(page.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

export default async function WidgetManual() {
  const page = await pageContent(WIDGET_PAGE);
  if (!page) notFound();

  const own = new Set<string>(WIDGET_SLOTS);
  // The widget's own labels are not prose for this page; the two snippet
  // slots are placed by hand around the code block below.
  const manual = page.sections.filter(
    (s) => !s.slot || (!own.has(s.slot) && !s.slot.startsWith("snippet")),
  );
  const only = (slot: string) => {
    const found = page.sections.filter((s) => s.slot === slot);
    return found.length === 1 ? found[0] : null;
  };
  const snippet = only("snippet");
  const linkText = only("snippet-link")?.heading;

  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <h1 className="text-3xl text-heading">{page.title}</h1>
      <div className="mt-6">
        <PageSections sections={manual} />
      </div>
      {/* 🔴 No snippet without both of its texts: a code block nobody
          explained, or a link with no words in it, is worse than none. */}
      {snippet && linkText && (
        <div className="mt-6" data-widget-snippet>
          <PageSections sections={[snippet]} />
          <pre className="mt-4 max-w-read overflow-x-auto rounded-sm border border-line bg-surface-2 p-4 text-sm">
            <code>
              {embedSnippet({
                address: EXAMPLE,
                siteUrl: SITE,
                title: page.title,
                linkText,
              })}
            </code>
          </pre>
        </div>
      )}
    </main>
  );
}
