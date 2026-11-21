import coats from "@/data/coats.json";

// CAMP-441: where each region coat of arms came from, one record per
// ISO 3166-2 code. It is the manifest the build already holds
// (`src/data/coats.json`, written by scripts/images/fetch-coats.mjs), so
// the list cannot differ from the files served under /coats/.
export const dynamic = "force-static";

export function GET() {
  return Response.json(coats, {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
}
