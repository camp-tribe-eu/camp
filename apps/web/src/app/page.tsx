import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-bold">CampTribe</h1>
      <p className="text-lg text-gray-600 dark:text-gray-300">
        Plan Better. Camp Smarter.
      </p>
      <p className="max-w-md text-sm text-ink-2">
        Campsite map, route library and camper rental search for Europe — under
        construction.
      </p>
      {/* CAMP-71: the first link of the crawl path. The card's criterion is
          four clicks from here to any campsite with no JavaScript, and the
          map cannot serve — it renders client-side. The real home page is
          CAMP-41; this link must survive it. */}
      <Link
        href="/camping"
        className="inline-flex h-10 items-center rounded bg-btn px-4 font-semibold text-btn-ink transition-colors hover:bg-btn-hover"
      >
        Browse campsites in Europe
      </Link>
    </main>
  );
}
