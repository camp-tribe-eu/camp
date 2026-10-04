// CAMP-36 / CAMP-190 — what a reader actually sees on a built page, and
// how two pages are compared.
//
// 🔴 ITS OWN FILE SO SOMETHING OTHER THAN A BUILT PAGE CAN DRIVE IT.
//
// `check-duplicate-pages.mjs` runs this over 65 435 files in CI, after a
// build, which is far too late to learn that a component's new paragraph
// is template text. `apps/web/tests/unit/boilerplate.spec.ts` asks the
// same functions the same question about a component it just rendered,
// in half a second.
//
// One definition of "visible text", two callers. A unit test carrying
// its own copy of the stripping rule would agree with itself and with
// nothing else — and the rule is subtle enough (that `data-boilerplate`
// regex is lazy, and stops at the first closing tag) that two copies
// would drift the first time either was touched.

/**
 * Remove every `data-boilerplate` block, CONTENTS AND ALL.
 *
 * 🔴 Blocks that are identical on every page by construction are
 * stripped before comparing. The attribution block (CAMP-101) and the
 * travel notice (CAMP-56) are word-for-word the same everywhere,
 * because both are promises we make about every campsite rather than
 * statements about one. Counting them inflates every pair equally:
 * adding the attribution block pushed hr/zadarska/autocamp-tabor and
 * autocamp-punta from below the line to 80.7%, which is a true
 * measurement of the wrong thing.
 *
 * The rule for earning the mark is strict: the block must be identical
 * on EVERY page it appears on. Anything that varies with the subject
 * stays in the comparison, because that is exactly what the guard is
 * for. `apps/web/tests/unit/boilerplate.spec.ts` enforces that rule by
 * rendering a component twice with different data.
 *
 * 🔴 WHY THIS COUNTS TAGS INSTEAD OF BEING ONE REGEX.
 *
 * It used to be `/<[a-z]+[^>]*\sdata-boilerplate=[^>]*>[\s\S]*?<\/[a-z]+>/gi`
 * — lazy, to "the next closing tag". That is not the block's own closing
 * tag, and the difference was not theoretical:
 *
 *   · `[a-z]+` does not match `h2` or `h3`. A marked heading therefore
 *     never found its own `</h2>`, ran past it, and swallowed everything
 *     up to the first all-letter closing tag that followed. On `main`
 *     today `air-quality.tsx` marks an `<h2>`, so the guard has been
 *     discarding the opening of the air-quality panel on every page it
 *     compares — the measured value and the station, which are precisely
 *     the per-page facts it exists to read.
 *
 *   · Any nested tag ends the match early. `<span data-boilerplate>
 *     <strong>a</strong> b</span>` left ` b` behind.
 *
 * A guard that looks away from more than it was told to does not fail
 * loudly; it goes green. So this walks the tags and closes the element
 * it actually opened. Void elements (`<img>`, `<br>`, `<input>`…) and
 * self-closing `<tag />` never open a level.
 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

export function stripBoilerplate(html) {
  return eachMarked(html).html;
}

/**
 * Every marked block's name and inner HTML, in document order.
 *
 * 🔴 The same walk as the stripping, so a test cannot be reading one set
 * of blocks while the guard discards another — which is exactly how a
 * mark that was never actually stripped would pass a test asserting it
 * was there.
 */
export function boilerplateBlocks(html) {
  return eachMarked(html).blocks;
}

function eachMarked(html) {
  const MARKED = /<([a-z][a-z0-9]*)(\s[^>]*?)?\sdata-boilerplate\s*=[^>]*?(\/?)>/i;
  const blocks = [];
  let out = html;
  for (;;) {
    const open = MARKED.exec(out);
    if (!open) return { html: out, blocks };
    const tag = open[1].toLowerCase();
    const start = open.index;
    let cursor = start + open[0].length;

    // Self-closing, or a void element: the mark covers the tag alone.
    const name = /data-boilerplate\s*=\s*"([^"]*)"/i.exec(open[0])?.[1] ?? '';

    if (open[3] === '/' || VOID_TAGS.has(tag)) {
      blocks.push({ name, text: '' });
      out = out.slice(0, start) + ' ' + out.slice(cursor);
      continue;
    }

    const TAG = new RegExp(`<(\\/?)(${tag})(\\s[^>]*?)?(\\/?)>`, 'gi');
    TAG.lastIndex = cursor;
    let depth = 1;
    let end = -1;
    for (let m = TAG.exec(out); m; m = TAG.exec(out)) {
      if (m[1] === '/') depth--;
      else if (m[4] !== '/') depth++;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }

    // 🔴 An unclosed marked block is a bug in the component, not a
    // licence to drop the rest of the page. Take the opening tag only
    // and carry on, so the text after it is still compared.
    if (end === -1) {
      blocks.push({ name, text: '' });
      out = out.slice(0, start) + ' ' + out.slice(cursor);
    } else {
      blocks.push({ name, text: out.slice(cursor, out.lastIndexOf('<', end - 1)) });
      out = out.slice(0, start) + ' ' + out.slice(end);
    }
  }
}

export function visibleHtmlText(rawHtml) {
  let html = rawHtml;
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html);
  html = main ? main[1] : html;
  // 🔴 Blocks that are identical on every page by construction come out
  // before anything is compared — see `stripBoilerplate` below.
  return stripBoilerplate(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export const shingles = (text, n = 5) => {
  const w = text.split(' ');
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
};

export const jaccard = (a, b) => {
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / (a.size + b.size - shared);
};


/**
 * 🔴 DRIVEN IN CI, because this file's whole job is to decide what the
 * duplicate-page guard is allowed to ignore — and the bug it replaced
 * was invisible: the guard went green while discarding real text.
 *
 * Every case below is a shape that actually appears in the components,
 * and the first two are the live defect this rewrite found on `main`.
 */
export function selfTest() {
  const flat = (h) => stripBoilerplate(h).replace(/\s+/g, ' ').trim();
  const cases = [
    ['a marked <h3> keeps the paragraph after it', '<h3 data-boilerplate="x">Head</h3><p>REAL</p>', '<p>REAL</p>'],
    ['a marked <h2> likewise', '<h2 data-boilerplate="x">Head</h2><p>REAL</p>', '<p>REAL</p>'],
    ['a nested tag does not end the block early', '<span data-boilerplate="x"><strong>a</strong> b</span><p>REAL</p>', '<p>REAL</p>'],
    ['same-name nesting closes at the right level', '<div data-boilerplate="x"><div>in</div>out</div><p>REAL</p>', '<p>REAL</p>'],
    ['a void child does not open a level', '<p data-boilerplate="x">cap<br>tion</p><p>REAL</p>', '<p>REAL</p>'],
    ['a marked void element takes only itself', '<img data-boilerplate="x" src="a"><p>REAL</p>', '<p>REAL</p>'],
    ['a marked self-closing tag takes only itself', '<img src="a" data-boilerplate="x"/><p>REAL</p>', '<p>REAL</p>'],
    ['two marked blocks, one kept paragraph', '<p data-boilerplate="a">A</p><p>REAL</p><p data-boilerplate="b">B</p>', '<p>REAL</p>'],
    ['unmarked html is untouched', '<p>REAL</p>', '<p>REAL</p>'],
    ['an unclosed marked block keeps the rest of the page', '<p data-boilerplate="x">A<p>REAL</p>', 'A<p>REAL</p>'],
    ['the attribute name must be exact', '<p data-boilerplate-ish="x">KEEP</p>', '<p data-boilerplate-ish="x">KEEP</p>'],
  ];

  let failures = 0;
  for (const [name, html, want] of cases) {
    const got = flat(html);
    if (got === want) {
      console.log(`✓ ${name}`);
    } else {
      failures++;
      console.log(`✗ ${name}\n   want ${JSON.stringify(want)}\n   got  ${JSON.stringify(got)}`);
    }
  }
  console.log(failures ? `\n✗ ${failures} self-test failure(s)` : `\n✓ ${cases.length} self-test cases passed`);
  return failures;
}
