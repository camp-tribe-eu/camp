// CAMP-164: is our attribution still the EEA's own sentence — and are we
// still allowed to print it?
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

import {
  AIR_ATTRIBUTION,
  AIR_VIEWER_URL,
  EEA_LEGAL_NOTICE_URL,
  EEA_REUSE_SENTENCE,
} from './source';

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
  return (
    html
      // 🔴 `\s*` before the `>`, and it is not pedantry.
      //
      // CodeQL (js/bad-tag-filter, high) caught `</script>` written without
      // it: browsers close the element on `</script >` too, so a page with a
      // space there kept its script body in the text we search. The check
      // below asserts our sentence is NOT found inside a script — which it
      // would have been, silently, on such a page.
      .replace(/<script[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style\s*>/gi, ' ')
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
      .trim()
  );
}

/** Is `sentence` on the page, once both are read the way a reader reads them? */
export function sentenceIsOn(html: string, sentence: string): boolean {
  return pageText(html).includes(sentence.replace(/\s+/g, ' ').trim());
}

/**
 * 🔴 Two questions, and only one of them was ever asked here.
 *
 *   1. Is the sentence we print still THEIRS, word for word?
 *   2. Are we still ALLOWED to print it?
 *
 * Until 01.10.2026 this script asked only the first. The second looked
 * settled, so nothing watched it — and a permission nobody watches is a
 * permission that can be withdrawn in silence. The EEA could reword the
 * Copyright notice tomorrow and every check here would stay green.
 *
 * So the grant is now a string we hold (`EEA_REUSE_SENTENCE`) and read
 * back from the page it came from. If that sentence leaves the legal
 * notice, this fails and says what to do: ask the EEA again, quoting
 * case #309009, before the next build ships the data.
 */
async function check(url: string, sentence: string, what: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  if (sentenceIsOn(await res.text(), sentence)) {
    console.log(`✓ ${what} is on ${url}, word for word`);
    return true;
  }
  console.error(`✗ ${what} is NOT on ${url}:\n  ${sentence}`);
  return false;
}

async function main() {
  // 🔴 Both run before either verdict. Stopping at the first failure
  // would hide the second, and these two fail for different reasons and
  // need different answers.
  const ok = [
    await check(AIR_VIEWER_URL, AIR_ATTRIBUTION, 'the attribution'),
    await check(
      EEA_LEGAL_NOTICE_URL,
      EEA_REUSE_SENTENCE,
      'the re-use permission',
    ),
  ];
  if (ok.every(Boolean)) return;
  if (!ok[1]) {
    console.error(
      '\n🔴 The permission we rely on is no longer on the page we took it\n' +
        '   from. Do not ship air quality data until the EEA confirms the\n' +
        '   terms again — quote case #309009, which is the reply that let\n' +
        '   us publish this in the first place.',
    );
  }
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
