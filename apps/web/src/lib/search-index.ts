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
 * 🔴 It counts gzip at level 6, and "gzip is a floor" was wrong.
 *
 * An earlier version of this comment said gzip is the floor every host
 * supports "so brotli can only do better". Review measured that and it
 * is false — the quality level matters more than the algorithm, and a
 * CDN compressing on the fly does not use the slow ones:
 *
 *   gzip -9    1.78 MiB     brotli q4   1.86 MiB  ← CDN, on the fly
 *   gzip -6    1.83 MiB     brotli q11  1.37 MiB  ← precompressed only
 *   gzip -1    2.15 MiB
 *
 * Brotli as actually served is BIGGER than gzip -9. So level 6 is used
 * here — the zlib and nginx default, the middle of that spread — and it
 * is a representative number, not a bound. A host on gzip -1 would send
 * 18% more than this counts.
 *
 * This is also why the index was NOT re-packed to make it smaller. A
 * shared table for the repeated place names saves 42% of the raw bytes
 * and 3% of the compressed ones (1.36 → 1.33 MiB) — brotli already
 * finds those repeats, and better. That would have been a format
 * migration and a new way to return the wrong campsite, for 40 KB.
 */
export const TOTAL_MAX_BYTES = 5_000_000;

/**
 * 🔴 Which of the two actually fires, so neither is decoration.
 *
 * Review measured that the compressed ceiling could never fire as first
 * shipped: at a compression ratio of 4.7, raw would pass 20 MB long
 * before gzip passed 5 MB, so the guard this card is named for was dead
 * on arrival — the same defect this file keeps finding elsewhere.
 *
 * With the raw ceiling at 12 MB the arithmetic is explicit: the
 * compressed one binds first only if the ratio falls below 2.4, and our
 * text compresses at 4.7. So TODAY THE RAW CEILING IS THE LIVE ONE, and
 * the compressed one is a backstop against the index ceasing to be
 * text — identifiers, hashes, coordinates at full precision. That is a
 * real way to break this, and it is the only way the compressed limit
 * speaks first. Both are tested at these defaults.
 */

/**
 * And the most it may be UNCOMPRESSED — a different cost, so a
 * different number.
 *
 * Compressed bytes are what the network charges. Raw bytes are what the
 * browser charges, and measured on the live index (8.57 MiB, 61 422
 * campsites, a fast laptop):
 *
 *   JSON.parse of every chunk         31 ms
 *   unpackIndex on top of it         181 ms   ← the real parse cost
 *   heap held by the index          21.3 MiB
 *   search() per keystroke        29 - 80 ms
 *
 * A mid-range phone is roughly four times slower, so today's index
 * already costs it about 0.7 s of parsing and up to 0.3 s per
 * keystroke. This is the binding constraint, not the download.
 *
 * 🔴 12 MB, and the first version of this said 20 MB with nothing
 * behind it. Review caught that, and rightly: 20 MB was 2.2x today's
 * size — a number chosen to sit above what we already have, which is
 * the one thing the comment two screens up forbids. It projects to
 * ~400 ms of unpacking on a laptop and over 1.5 s on a phone, which is
 * not a ceiling, it is a hope.
 *
 * 12 MB is 1.4x today. It is where the phone cost stops being tolerable
 * rather than where it stops being measurable, and hitting it is meant
 * to start the conversation CAMP-61 names — a search service the
 * browser queries instead of a file it keeps — while there is still
 * room to have it.
 */
export const RAW_MAX_BYTES = 12_000_000;

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

/**
 * Bytes as MB, decimal, because that is what the ceilings are written
 * in: 5_000_000 reads back as "5.00 MB", not as "4.77 MiB". Review
 * found the messages quoting 4.77 and 19.07 — numbers that appear
 * nowhere in the code or the cards, which is how a reader ends up
 * hunting for a limit nobody set.
 */
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(2)} MB`;

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

  // 🔴 Both sizes first, then both verdicts.
  //
  // The raw message quotes the compressed figure — "this is not the
  // download, that is N and it is fine" — which is the whole point of
  // having two numbers, and it cannot say so if it runs first.
  const raw = plan.reduce((n, c) => n + c.bytes, 0);
  const sent = plan.reduce(
    (n, c) =>
      n +
      gzipSync(Buffer.from(JSON.stringify(packIndex([...c.docs]))), {
        // Level 6: the zlib and nginx default. See TOTAL_MAX_BYTES.
        level: 6,
      }).length,
    0,
  );

  if (raw > rawMax) {
    throw new Error(
      `The search index is ${mb(raw)} of JSON across ${plan.length} files, ` +
        `past the ${mb(rawMax)} a browser should have to parse and hold.\n` +
        `This is not the download — that is ${mb(sent)} compressed, and fine.\n` +
        `It is what the browser pays: parsing it, holding it, and walking it\n` +
        `on every keystroke. Measured at 8.57 MB: 181 ms to unpack, 21 MB of\n` +
        `heap, up to 80 ms a keystroke on a laptop — four times that on a\n` +
        `phone. This is the point CAMP-67 names: move the search to a real\n` +
        `search service and have the browser query it.`,
    );
  }

  if (sent > sentMax) {
    throw new Error(
      `The search index is ${mb(sent)} compressed across ${plan.length} files ` +
        `(${mb(raw)} raw), past the ${mb(sentMax)} we are willing to\n` +
        `make a reader download — about ${(sent / 1_000_000).toFixed(0)} seconds on the 1 MB/s a phone\n` +
        `on mobile data actually gets.\n` +
        `Loading it in pieces bought time; it has run out. This is the point\n` +
        `CAMP-67 names: move the search to a real search service (MeiliSearch\n` +
        `was the choice on the card) and have the browser query it.`,
    );
  }

  return { plan, total: raw, sent };
}
