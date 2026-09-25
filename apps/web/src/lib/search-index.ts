// CAMP-129: how the search index is assembled, and how big it may be.
//
// 🔴 In `lib`, not in the route file beside it.
//
// A Next route module may export only route handlers and a fixed set of
// config names. Exporting `fetchDocs` / `MAX_BYTES` / `sizeOfGroup` from
// one is a build error:
//
//   Type error: Route "…/route.ts" does not match the required types of
//   a Next.js Route. "fetchDocs" is not a valid Route export field.
//
// Our build passed only because Next happened to emit no validator for
// that one segment — reproduced on a minimal app in review, and
// `.next/types/app/data/search/` had no entry for it while its siblings
// did. It worked by accident, and accidents end at an upgrade.

import { gzipSync } from 'node:zlib';

import { apiFetch } from '@/lib/api';
import {
  packIndex,
  searchText,
  unpackIndex,
  type PackedIndex,
  type SearchDoc,
} from '@/lib/search';
import { planChunks } from '@/lib/search-chunks';

/**
 * The most any ONE file may be.
 *
 * 🔴 The number is the old one, the MEANING is not, and the first
 * version of this comment said "unchanged, for the same reason". The
 * deleted route's 1.5 MB was what every visitor downloaded; this is one
 * file of twenty-eight.
 */
export const MAX_BYTES = 1_500_000;

/**
 * The most the whole index may be, across every file — as a reader
 * downloads it, which means COMPRESSED.
 *
 * 🔴 Without a total, the ceiling CAMP-67 put in place is gone.
 * `planChunks` answers growth by making more files, so the per-file
 * limit can never fail again — it would take a single campsite whose
 * own row exceeded 1.5 MB. Review measured the consequence: the page
 * queues every chunk and pulls 3.29 MB, where the old route failed the
 * build past 1.5 MB. The guard had quietly become unfailable.
 *
 * 5 MB, because that is roughly five seconds on the 1 MB/s a phone on
 * mobile data actually gets, and past that "it loads progressively" has
 * stopped being an answer — which is exactly when the card's real fix,
 * a search service the browser queries (CAMP-61), has to happen.
 *
 * 🔴 CAMP-135: the number kept its meaning and changed what it counts.
 *
 * It used to count `JSON.stringify().length`, while the sentence above
 * it reasoned about seconds on mobile data. Nobody ever downloads
 * uncompressed JSON. Measured on the live index (61 422 campsites, 27
 * files, 25.09.2026):
 *
 *   raw JSON   8.57 MiB   9.0 s at 1 MB/s   ← what this used to count
 *   gzip -9    1.78 MiB   1.9 s
 *   brotli 11  1.36 MiB   1.4 s             ← what a CDN actually sends
 *
 * So the build was failing at 8.57 MB over a budget meant to cap a
 * five-second download that in fact takes 1.4 seconds.
 *
 * It counts gzip, not brotli, deliberately: gzip is the floor every
 * host and browser supports, so brotli can only do better, and if we
 * ever serve this uncompressed the raw ceiling below catches it.
 *
 * This is also why the index was NOT re-packed to make it smaller. A
 * shared table for the repeated place names saves 42% of the raw bytes
 * and 3% of the compressed ones (1.36 → 1.33 MiB) — brotli already
 * finds those repeats, and better. That would have been a format
 * migration and a new way to return the wrong campsite, for 40 KB.
 */
export const TOTAL_MAX_BYTES = 5_000_000;

/**
 * And the most it may be UNCOMPRESSED — a different cost, so a
 * different number.
 *
 * Compressed bytes are what the network charges. Raw bytes are what the
 * browser charges: `JSON.parse` on the main thread, 61 422 objects held
 * for the session, and a `search()` that walks all of them on every
 * keystroke. One number cannot honestly be both limits, and the version
 * of this file that tried was the reason a 1.4-second download failed a
 * five-second budget.
 *
 * 20 MB is deliberately loose. It is not a target — it is the point
 * where the cost stops being the network and starts being the phone,
 * and where the answer is the search service CAMP-61 names rather than
 * another round of packing. Measured 25.09.2026: 8.57 MiB.
 */
export const RAW_MAX_BYTES = 20_000_000;

interface Doc {
  name: string | null;
  country: string;
  region: string;
  slug: string;
  near: { name: string; m: number }[];
}

export function toSearchDocs(rows: Doc[]): SearchDoc[] {
  return rows.map((r) => ({
    kind: 'campsite' as const,
    name: r.name ?? '',
    path: `/camping/${r.country}/${r.region}/${r.slug}`,
    country: r.country,
    region: r.region,
    near: r.near,
    text: searchText({
      name: r.name ?? '',
      region: r.region,
      country: r.country,
      near: r.near,
    }),
  }));
}

export async function fetchDocs(): Promise<SearchDoc[]> {
  const res = await apiFetch('/spots/search-index');
  if (!res.ok) throw new Error(`Search index request failed: ${res.status}`);
  const rows = (await res.json()) as Doc[];
  if (rows.length === 0) {
    // 🔴 An empty index is a broken build, not a site with no campsites.
    // Nothing downstream can tell the two apart, and the second one
    // renders as a search that silently finds nothing.
    throw new Error('The search index is empty — the API returned no rows.');
  }
  return toSearchDocs(rows);
}

/** Bytes as MiB, to one place — the unit both ceilings are quoted in. */
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

export const sizeOfGroup = (group: readonly SearchDoc[]): number =>
  Buffer.byteLength(JSON.stringify(packIndex([...group])));

/**
 * The plan, and every check that must pass before any of it ships.
 *
 * 🔴 One function, called by both routes, so the table of contents and
 * the files it promises cannot be derived differently.
 */
export function checkedPlan(
  docs: SearchDoc[],
  // 🔴 The ceilings are arguments so a test can reach them.
  //
  // They were constants, and nothing tested them: the only way to make
  // this throw was to build an index of several real megabytes, so
  // nobody ever did, and the whole guard — the one thing standing
  // between us and a search that quietly costs a reader nine seconds —
  // ran unexercised. That is the shape of defect this repository keeps
  // finding in its own safeguards, so it is not left as one more.
  //
  // The defaults ARE the constants, and a test asserts that too, so
  // injecting a small limit cannot quietly become the only thing tested.
  { sentMax = TOTAL_MAX_BYTES, rawMax = RAW_MAX_BYTES } = {},
) {
  const plan = planChunks(docs, MAX_BYTES, sizeOfGroup);

  // 🔴 The round trip, restored.
  //
  // The deleted route checked packIndex/unpackIndex field by field on
  // every build, and `search.ts` went on telling the reader it did —
  // while nothing under src/app imported `unpackIndex` at all. A
  // mistake in the packing is not a build that fails, it is a search
  // that finds the WRONG campsite. That is why the check existed, and
  // why losing it silently was worse than never having had it.
  for (const chunk of plan) {
    const back = unpackIndex(
      JSON.parse(JSON.stringify(packIndex(chunk.docs))) as PackedIndex,
    );
    if (back.length !== chunk.docs.length) {
      throw new Error(
        `chunk ${chunk.id} lost rows: ${chunk.docs.length} in, ${back.length} out`,
      );
    }
    for (let i = 0; i < chunk.docs.length; i++) {
      const a = back[i];
      const b = chunk.docs[i];
      if (
        a.path !== b.path ||
        a.name !== b.name ||
        a.text !== b.text ||
        a.country !== b.country ||
        a.region !== b.region ||
        a.near.length !== b.near.length
      ) {
        throw new Error(
          `chunk ${chunk.id} does not round-trip at row ${i} (${b.path})`,
        );
      }
    }
  }

  // 🔴 Ids must be unique, because two chunks sharing a URL is the same
  // silent half-index as a stale chunk. Unreachable with today's 27
  // two-letter country codes; one line keeps it that way.
  const ids = new Set(plan.map((c) => c.id));
  if (ids.size !== plan.length) {
    throw new Error('two chunks share an id, so they would share a URL');
  }

  const raw = plan.reduce((n, c) => n + c.bytes, 0);
  if (raw > rawMax) {
    throw new Error(
      `The search index is ${mib(raw)} of JSON across ${plan.length} files, ` +
        `past the ${mib(rawMax)} a browser should have to parse and hold.\n` +
        `This is not about the download — see the compressed check below.\n` +
        `It is the point CAMP-61 names: move the search to a service the\n` +
        `browser queries instead of a file it keeps.`,
    );
  }

  // 🔴 What a reader actually waits for. See TOTAL_MAX_BYTES.
  const sent = plan.reduce(
    (n, c) =>
      n +
      gzipSync(Buffer.from(JSON.stringify(packIndex([...c.docs]))), {
        level: 9,
      }).length,
    0,
  );
  if (sent > sentMax) {
    throw new Error(
      `The search index is ${mib(sent)} compressed across ${plan.length} files ` +
        `(${mib(raw)} raw), past the ${mib(sentMax)} we are willing to\n` +
        `make a reader download — about ${(sent / 1_000_000).toFixed(0)} seconds on the 1 MB/s a phone\n` +
        `on mobile data actually gets.\n` +
        `Loading it in pieces bought time; it has run out. This is the point\n` +
        `CAMP-67 names: move the search to a real search service (MeiliSearch\n` +
        `was the choice on the card) and have the browser query it.`,
    );
  }

  return { plan, total: raw, sent };
}
