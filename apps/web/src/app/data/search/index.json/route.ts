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
// limit. Split by country it was 3.14 MiB across 28 files.
//
// 🔴 Measured again 25.09.2026, after CAMP-33 finished computing what
// is near every campsite: 8.98 MB raw across 29 files (France splits
// three ways), 1.92 MB once gzipped — which is exactly what the line
// below prints on every build, because a comment that disagrees with
// the log beside it is how both stop being read. Two budgets for two
// different costs: see TOTAL_MAX_BYTES and RAW_MAX_BYTES.
//
// This file is the list of the pieces: 1.5 KiB for 29 chunks (it said
// 5 KB, measured 1 587 bytes), fetched first, and it is what lets the
// loader start with the ones that land soonest.
//
// 🔴 Everything it knows lives in lib/search-index.ts, because a route
// module may not export anything but route handlers.

export const dynamic = 'force-static';

export async function GET() {
  const { plan, total, sent } = checkedPlan(await fetchDocs());

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
  //
  // Both numbers, because there are two ceilings and they answer
  // different questions: `sent` is what the reader waits for, `total`
  // is what their phone then has to parse and hold. CAMP-135 shipped
  // the compressed one and printed only the raw one, which is how a
  // budget goes unwatched for a second time.
  // eslint-disable-next-line no-console
  console.log(
    `search index: ${plan.reduce((n, c) => n + c.docs.length, 0)} campsites in ` +
      `${index.chunks.length} files, ${(sent / 1_000_000).toFixed(2)} MB gzipped ` +
      `(${(total / 1_000_000).toFixed(2)} MB raw), ` +
      `largest ${(Math.max(...index.chunks.map((c) => c.bytes)) / 1024).toFixed(0)} KiB`,
  );

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
