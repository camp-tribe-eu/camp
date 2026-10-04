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
      // 🔴 `\b[^>]*>` after the tag name, and it is not pedantry.
      //
      // CodeQL (js/bad-tag-filter, high) caught `</script>` written without
      // it. Twice: the first fix allowed only whitespace, and CodeQL came
      // back with `</script\t\n bar>`. An HTML parser closes the element on
      // `</script` followed by ANYTHING up to the `>` — whitespace, a slash,
      // even junk. Anything narrower leaves a page shape on which the script
      // body stays in the text we search, and the check below — which
      // asserts our sentence is NOT inside a script — would pass for the
      // wrong reason.
      //
      // `\b` keeps it honest in the other direction: `</scriptfoo>` is not a
      // close tag and must not be swallowed.
      //
      // 🔴 `|$` is the third shape, and it was live on main until the
      // retroactive review of #85 (CAMP-194) found it. Both earlier patches
      // required a closing tag, so a script that never closes — truncated
      // response, `</script` cut off at EOF — was left whole, its body
      // stayed in the text, and `sentenceIsOn` reported our attribution
      // "present" on a page where a reader sees nothing. A browser treats
      // everything after an unclosed `<script>` as script content; so do we.
      // Measured on the three shapes: without `|$` the sentence was visible
      // to the checker (`true`) and invisible to the reader.
      //
      // 🔴 COMMENTS COME OUT FIRST, and the order is load-bearing. `|$`
      // above means an unclosed `<script` swallows everything after it,
      // and a commented-out tag —
      //   `<!-- <script src="/old/analytics.js"> dropped 2024 -->`
      // — is exactly that: a `<script` with no `</script>`. Stripped in
      // the other order it ate the rest of the document, attribution
      // included, and the checker reported our credit missing from a page
      // that plainly shows it. Measured: `✗ the attribution is NOT on …`,
      // exit 1, on a page where a reader sees it.
      //
      // KNOWN RESIDUAL, stated rather than hidden: `<script` inside an
      // ATTRIBUTE value (`<div data-tpl="<script>">`) still opens a
      // swallow, because knowing it is an attribute means parsing, not
      // matching. The direction is the safe one — a false NEGATIVE, so a
      // red run and a re-read, never a silent green that ships data we
      // have no permission to show. Measured on both live pages today
      // (viewer 27 `<script` / 27 `</script`, legal notice 8 / 8): both
      // orders yield identical text, so nothing is triggered now.
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script[\s\S]*?(?:<\/script\b[^>]*>|$)/gi, ' ')
      .replace(/<style[\s\S]*?(?:<\/style\b[^>]*>|$)/gi, ' ')
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
  // 🔴 The try/catch is the point, not decoration. `!res.ok` below only
  // covers a page that ANSWERED. The dead viewer page this function's
  // comment describes — ECONNREFUSED, DNS, TLS, timeout — throws out of
  // `fetch` itself, and the first version of this fix left that throw
  // alone: the run died with `TypeError: fetch failed` and the permission
  // verdict, including the "quote case #309009, do not ship" line, was
  // never printed. Measured against a closed port.
  let res: Response;
  let body: string;
  try {
    res = await fetch(url);
    body = res.ok ? await res.text() : '';
  } catch (err) {
    console.error(`✗ ${url} could not be read — ${what} unread:\n  ${err}`);
    return false;
  }
  // 🔴 Return, do not throw. These two calls sit in one array literal, so a
  // throw here skips the other check entirely — and the two fail for
  // different reasons and need different answers. A dead viewer page used
  // to hide the permission verdict, including the "quote case #309009, do
  // not ship" line below. An unreachable page is still a failure: `false`
  // reaches `ok.every(Boolean)` and the script exits 1.
  if (!res.ok) {
    console.error(`✗ ${url} answered HTTP ${res.status} — ${what} unread`);
    return false;
  }
  if (sentenceIsOn(body, sentence)) {
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
