import { apiFetch, countryName } from '@/lib/api';
import {
  fold,
  packIndex,
  unpackIndex,
  type PackedIndex,
  type SearchDoc,
} from '@/lib/search';

// CAMP-67: the search index, built once at build time.
//
// 🔴 Static, like the map's GeoJSON and for the same reason. The web app
// runs with the backend switched off (CAMP-39), so a search that called
// an endpoint per keystroke would be the one feature that breaks when the
// API does — and it would need a publicly reachable API and a CORS
// allowlist to do it.
//
// 🔴 The card's MeiliSearch trigger, made measurable.
//
// CAMP-67 says to move to MeiliSearch "when the catalogue grows to
// hundreds of pages". We are already past that and this design is still
// comfortable, because the real constraint was never the page count — it
// is how much every visitor downloads. So the trigger is the size of this
// file, and the build FAILS when it is crossed rather than quietly
// shipping a slower site. The same shape as the map's `truncated` check:
// a limit nobody has to remember.

export const dynamic = 'force-static';

/**
 * Past this, the index stops being something to send to a phone on a
 * campsite's wifi. 1.5 MB is roughly ten thousand campsites at the size
 * one entry actually takes — measured, not guessed, and printed below on
 * every build so the number stays honest.
 */
const MAX_BYTES = 1_500_000;

interface Doc {
  name: string | null;
  country: string;
  region: string;
  slug: string;
  lat: number;
  lon: number;
  near: { name: string; m: number }[];
}

export async function GET() {
  const res = await apiFetch(`/spots/search-index`);
  if (!res.ok) {
    throw new Error(`Search index request failed: ${res.status}`);
  }
  const rows = (await res.json()) as Doc[];

  const docs: SearchDoc[] = rows.map((r) => ({
    kind: 'campsite' as const,
    // 🔴 The name a reader sees, not a fabricated one. 212 Croatian
    // campsites have no name in OSM; they are still findable by region
    // and by what they are near, and the interface says "unnamed" rather
    // than inventing something.
    name: r.name ?? '',
    path: `/camping/${r.country}/${r.region}/${r.slug}`,
    country: r.country,
    region: r.region,
    // Folded once here so the browser never folds 1000 documents on a
    // keystroke — only the query, which is one short string.
    text: fold(
      [
        r.name ?? '',
        r.region.replace(/-/g, ' '),
        countryName(r.country),
        ...r.near.map((n) => n.name),
      ].join(' '),
    ),
    near: r.near,
  }));

  // CAMP-107. Packed, not pretty-printed: see packIndex. The same
  // documents, without the keys and the two derivable fields.
  const body = JSON.stringify(packIndex(docs));
  const bytes = Buffer.byteLength(body);

  // 🔴 Proved on every build, not assumed once.
  //
  // The packing is a format change to the one file the search depends
  // on, and a mistake in it would be a search that finds the wrong
  // campsite rather than a build that fails. So the round trip is
  // checked here, against the real index, before the file is written.
  const back = unpackIndex(JSON.parse(body) as PackedIndex);
  if (back.length !== docs.length) {
    throw new Error(
      `packed index lost rows: ${docs.length} in, ${back.length} out`,
    );
  }
  for (let i = 0; i < docs.length; i++) {
    if (
      back[i].path !== docs[i].path ||
      back[i].name !== docs[i].name ||
      back[i].text !== docs[i].text ||
      back[i].country !== docs[i].country ||
      back[i].region !== docs[i].region ||
      back[i].near.length !== docs[i].near.length
    ) {
      throw new Error(
        `packed index does not round-trip at row ${i} (${docs[i].path})`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `search index: ${docs.length} campsites, ${(bytes / 1024).toFixed(0)} KB ` +
      `(${((100 * bytes) / MAX_BYTES).toFixed(0)}% of the limit)`,
  );

  if (bytes > MAX_BYTES) {
    throw new Error(
      `The search index is ${(bytes / 1024 / 1024).toFixed(1)} MB, past the ` +
        `${MAX_BYTES / 1_000_000} MB we are willing to send to every visitor.\n` +
        'This is the point CAMP-67 names: move the search to a real search\n' +
        'service (MeiliSearch was the choice on the card) and have the\n' +
        'browser query it instead of downloading everything.',
    );
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
