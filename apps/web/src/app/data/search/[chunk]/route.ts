import { packIndex } from '@/lib/search';
import { planChunks } from '@/lib/search-chunks';
import { fetchDocs, sizeOfGroup, MAX_BYTES } from '../index.json/route';

// CAMP-129: one piece of the search index.
//
// The table of contents next door lists these; this hands them out. Both
// derive the same plan from the same data, so a chunk the index promises
// is a chunk that exists — see the assertion in GET, which is there
// because "promised but missing" is the one way this pair can lie.

export const dynamic = 'force-static';
// 🔴 No chunk id that the plan did not produce. Without this, a request
// for /data/search/xx.json would be rendered on demand and answer 200
// with whatever an unknown country packs to — an empty index — instead
// of 404. An empty search result is indistinguishable from "we have no
// campsites there", which is the failure this whole card is about.
export const dynamicParams = false;

/**
 * The plan, derived once per build.
 *
 * 🔴 Both this route and generateStaticParams need it, and Next calls
 * the handler once per chunk. Without the cache that is 28 identical
 * requests for a 4 MB payload on every build.
 */
let planned: ReturnType<typeof buildPlan> | null = null;
function buildPlan() {
  return fetchDocs().then((docs) => planChunks(docs, MAX_BYTES, sizeOfGroup));
}
const plan = () => (planned ??= buildPlan());

export async function generateStaticParams() {
  return (await plan()).map((c) => ({ chunk: `${c.id}.json` }));
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ chunk: string }> },
) {
  const { chunk } = await params;
  const id = chunk.replace(/\.json$/, '');
  const part = (await plan()).find((c) => c.id === id);

  if (!part) {
    // Unreachable while dynamicParams is false, and kept anyway: the day
    // somebody turns that flag back on, this is the difference between a
    // 404 and a silently empty search.
    return new Response('Not found', { status: 404 });
  }

  const body = JSON.stringify(packIndex(part.docs));

  // 🔴 The index told the browser this file holds `part.docs.length`
  // campsites and roughly `part.bytes` bytes. If packing produces
  // something else, the loader's progress line is a lie and the build
  // should stop rather than ship a number nobody can trust.
  if (part.docs.length === 0) {
    throw new Error(`Chunk ${id} holds no campsites — the index lists it, so the plan and the payload disagree.`);
  }
  if (Buffer.byteLength(body) > MAX_BYTES) {
    throw new Error(
      `Chunk ${id} packs to ${Buffer.byteLength(body)} bytes, over the ${MAX_BYTES} limit the plan guaranteed.`,
    );
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Immutable in spirit: a chunk's contents change only when the
      // import does, and then the whole site is rebuilt.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
