import { apiFetch } from '@/lib/api';
import { packIndex, searchText, type SearchDoc } from '@/lib/search';
import { planChunks, type SearchIndex } from '@/lib/search-chunks';

// CAMP-129: the search index's table of contents.
//
// 🔴 Why the search stopped being one file.
//
// The route it replaces refused to send more than 1.5 MB to every
// visitor, and after the EU-27 import the index was 6.9 MB — so the
// search page has been answering "the search index could not be loaded"
// since 24.09.2026. Deriving `text` and the slug took it to 4.26 MB,
// which is better and still not close.
//
// This file is the list of the pieces: 5 KB, fetched first, and it is
// what lets the loader start with the ones that land soonest.

export const dynamic = 'force-static';

/** Unchanged from the file this replaces, and for the same reason. */
export const MAX_BYTES = 1_500_000;

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

export async function GET() {
  const docs = await fetchDocs();
  const plan = planChunks(docs, MAX_BYTES, sizeOfGroup);

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
  const total = index.chunks.reduce((n, c) => n + c.bytes, 0);
  // eslint-disable-next-line no-console
  console.log(
    `search index: ${docs.length} campsites in ${index.chunks.length} files, ` +
      `${(total / 1024 / 1024).toFixed(2)} MB total, ` +
      `largest ${(Math.max(...index.chunks.map((c) => c.bytes)) / 1024).toFixed(0)} KB`,
  );

  return new Response(JSON.stringify(index), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
