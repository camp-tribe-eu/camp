// CAMP-164: is our attribution still the EEA's own sentence?
//
//   npx ts-node src/air/verify-attribution.ts
//
// Reads the viewer page and fails (exit 1) unless AIR_ATTRIBUTION is on
// it, word for word. Not part of the unit suite — it needs the network,
// and a test that goes red because the EEA's site is down teaches
// people to ignore red — but it is the check a RETYPED attribution
// cannot pass, and the one to run when either side is touched.
//
// 🔴 Why it exists at all: `copyrightText` is empty on every image
// service behind this index, so there is no field to take the credit
// from (see AIR_ATTRIBUTION in source.ts). The sentence we print is
// taken from the viewer's own text; this is what proves it is still
// there, and still spelled the way we print it.

import { AIR_ATTRIBUTION, AIR_VIEWER_URL } from './source';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
};

/** The words of a page as a reader meets them: tags removed, entities decoded, whitespace collapsed. */
export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1].toLowerCase() === 'x'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[body.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Is `sentence` on the page, once both are read the way a reader reads them? */
export function sentenceIsOn(html: string, sentence: string): boolean {
  return pageText(html).includes(sentence.replace(/\s+/g, ' ').trim());
}

async function main() {
  const res = await fetch(AIR_VIEWER_URL);
  if (!res.ok) throw new Error(`${AIR_VIEWER_URL} answered HTTP ${res.status}`);
  const html = await res.text();
  if (sentenceIsOn(html, AIR_ATTRIBUTION)) {
    console.log(`✓ the attribution is on ${AIR_VIEWER_URL}, word for word`);
    return;
  }
  console.error(
    `✗ the attribution is NOT on ${AIR_VIEWER_URL}:\n  ${AIR_ATTRIBUTION}`,
  );
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
