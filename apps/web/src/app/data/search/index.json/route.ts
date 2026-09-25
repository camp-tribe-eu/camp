import { checkedPlan, fetchDocs } from '@/lib/search-index';
import type { SearchIndex } from '@/lib/search-chunks';

// CAMP-129: the search index's table of contents.
//
// 🔴 Why the search stopped being one file.
//
// The route it replaces refused to send more than 1.5 MB to every
// visitor, and after the EU-27 import the index was 6.9 MB — so the
// search page has been answering "the search index could not be loaded"
// since 24.09.2026. Deriving `text` and the slug took a single packed
// file to 3.40 MB (measured), better and still more than twice the
// limit. Split by country it is 3.14 MiB across 28 files, largest
// 1 003 KiB.
//
// This file is the list of the pieces: 5 KB, fetched first, and it is
// what lets the loader start with the ones that land soonest.
//
// 🔴 Everything it knows lives in lib/search-index.ts, because a route
// module may not export anything but route handlers.

export const dynamic = 'force-static';

export async function GET() {
  const { plan, total } = checkedPlan(await fetchDocs());

  const index: SearchIndex = {
    v: 1,
    chunks: plan.map((c) => ({
      id: c.id,
      country: c.country,
      count: c.docs.length,
      bytes: c.bytes,
    })),
  };

  // 🔴 Said out loud on every build, like the file this replaces.
  // A number nobody prints is a number nobody notices growing.
  // eslint-disable-next-line no-console
  console.log(
    `search index: ${plan.reduce((n, c) => n + c.docs.length, 0)} campsites in ` +
      `${index.chunks.length} files, ${(total / 1024 / 1024).toFixed(2)} MiB total, ` +
      `largest ${(Math.max(...index.chunks.map((c) => c.bytes)) / 1024).toFixed(0)} KiB`,
  );

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
