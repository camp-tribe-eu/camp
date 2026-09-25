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
 * The most the whole index may be, across every file.
 *
 * 🔴 Without this, the ceiling CAMP-67 put in place is gone.
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
 * Measured 25.09.2026: 3.14 MiB across 28 files. A real ceiling with
 * real headroom, not a number chosen to fit what we already have.
 */
export const TOTAL_MAX_BYTES = 5_000_000;

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

export const sizeOfGroup = (group: readonly SearchDoc[]): number =>
  Buffer.byteLength(JSON.stringify(packIndex([...group])));

/**
 * The plan, and every check that must pass before any of it ships.
 *
 * 🔴 One function, called by both routes, so the table of contents and
 * the files it promises cannot be derived differently.
 */
export function checkedPlan(docs: SearchDoc[]) {
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

  const total = plan.reduce((n, c) => n + c.bytes, 0);
  if (total > TOTAL_MAX_BYTES) {
    throw new Error(
      `The search index is ${(total / 1024 / 1024).toFixed(2)} MB across ` +
        `${plan.length} files, past the ${(TOTAL_MAX_BYTES / 1024 / 1024).toFixed(0)} MB ` +
        `we are willing to make a reader download in total.\n` +
        `Loading it in pieces bought time; it has run out. This is the point\n` +
        `CAMP-67 names: move the search to a real search service (MeiliSearch\n` +
        `was the choice on the card) and have the browser query it.`,
    );
  }

  return { plan, total };
}
