import { pageText, sentenceIsOn } from './verify-attribution';
import { AIR_ATTRIBUTION } from './source';

// CAMP-164: the reader in verify-attribution.ts is what decides whether a
// retyped credit passes, so it is tested against the shapes of the EEA's
// own markup: a sentence broken across links and lines, an entity, and
// text that is in the file but not on the page.

const VIEWER_PARAGRAPH = `
  <p>
    The European Air Quality Index was developed jointly by the
    <a href="http://ec.europa.eu/environment/air/index_en.htm" target="_blank"
      >European Commission’s Directorate General for Environment</a
    >
    and the
    <a href="https://www.eea.europa.eu/" target="_blank">European Environment Agency</a>
    to inform citizens and public authorities about the recent air quality status across Europe.
  </p>`;

describe('sentenceIsOn', () => {
  // The real markup: the sentence is split over two links and four lines.
  it('finds the sentence across links and line breaks', () => {
    expect(sentenceIsOn(VIEWER_PARAGRAPH, AIR_ATTRIBUTION)).toBe(true);
  });

  it('decodes entities the way a reader sees them', () => {
    const html = VIEWER_PARAGRAPH.replace('Commission’s', 'Commission&rsquo;s');
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(true);
    const numeric = VIEWER_PARAGRAPH.replace(
      'Commission’s',
      'Commission&#8217;s',
    );
    expect(sentenceIsOn(numeric, AIR_ATTRIBUTION)).toBe(true);
  });

  // 🔴 THE POINT OF THE SCRIPT: a retyped credit does not pass.
  it('refuses the straight-apostrophe retyping', () => {
    expect(
      sentenceIsOn(VIEWER_PARAGRAPH, AIR_ATTRIBUTION.replace('’', "'")),
    ).toBe(false);
  });

  it('refuses a paraphrase', () => {
    expect(
      sentenceIsOn(
        VIEWER_PARAGRAPH,
        AIR_ATTRIBUTION.replace('developed jointly by', 'created by'),
      ),
    ).toBe(false);
  });

  it('refuses a page that no longer says it', () => {
    expect(
      sentenceIsOn('<p>Something else entirely.</p>', AIR_ATTRIBUTION),
    ).toBe(false);
  });

  // The EEA's own page keeps a sentence about running means in an HTML
  // comment. Text in the file is not text on the page. Each wrapper has a
  // `>` INSIDE it, before the sentence: without one, the generic tag
  // stripper would swallow a whole comment as if it were a single tag and
  // the special-casing of comments, scripts and styles would go untested.
  it('does not count text inside a comment', () => {
    const html = `<!-- see a > b: ${AIR_ATTRIBUTION} -->`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  it('does not count text inside a script', () => {
    const html = `<script>if (a > b) { var s = "${AIR_ATTRIBUTION}"; }</script>`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  // 🔴 CodeQL js/bad-tag-filter, high, raised on PR #85: the closing tag was
  // written `</script>` with no room for whitespace, and a browser closes the
  // element on `</script >` just the same. On such a page the script body
  // stayed in the text we search, and the test above would have passed for a
  // reason that has nothing to do with the filter. Mutate the `\s*` back out
  // of pageText and this goes red; the test above does not.
  it('does not count text inside a script closed as </script >', () => {
    const html = `<script>if (a > b) { var s = "${AIR_ATTRIBUTION}"; }</script >`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  it('does not count text inside a style', () => {
    const html = `<style>a > b { content: "${AIR_ATTRIBUTION}"; }</style>`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  // 🔴 CodeQL came back a second time with `</script\t\n bar>`: an HTML
  // parser closes the element on `</script` followed by anything up to the
  // `>`, not only whitespace. This is that shape.
  it('does not count text inside a script closed as </script\\t\\n bar>', () => {
    const html = `<script>var s = "${AIR_ATTRIBUTION}";</script\t\n bar>`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  // And the other direction. `</scriptfoo>` is NOT a close tag, so it does
  // not end the element: everything up to the real `</script>` is script
  // body, both copies of the sentence included.
  //
  // 🔴 This fixture is the entire reason `\b` is in the regex, and until
  // CAMP-194 the test carrying this name used `<p>${AIR_ATTRIBUTION}</p>` —
  // no `</scriptfoo>` anywhere in it. All 14 cases here stayed green with
  // `\b` deleted from both regexes, so the guard was untested. Delete `\b`
  // now and this case must go red: the mutant stops at `</script`, leaves
  // `foo>` plus the second sentence as page text, and answers true.
  it('treats </scriptfoo> as script body, not as a close tag', () => {
    const html = `<script>var s = "${AIR_ATTRIBUTION}";</scriptfoo>${AIR_ATTRIBUTION}</script>`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  // 🔴 CAMP-194, and the worst direction a safeguard can fail in. Both
  // earlier patches demanded a closing tag, so a script that never closes
  // kept its body in the searched text: the checker answered "attribution
  // present" for a page on which a reader sees nothing at all.
  it('does not count text inside a script that is never closed', () => {
    const html = `<script>var s = "${AIR_ATTRIBUTION}";`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  it('does not count text inside a script whose </script is cut off at EOF', () => {
    const html = `<script>var s = "${AIR_ATTRIBUTION}";</script`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  it('does not count text inside a style that is never closed', () => {
    const html = `<style>a { content: "${AIR_ATTRIBUTION}"; }`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  it('does not count text inside a style closed as </style >', () => {
    const html = `<style>a > b { content: "${AIR_ATTRIBUTION}"; }</style >`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(false);
  });

  it('still counts the sentence when a comment sits beside it', () => {
    const html = `<!-- a > b --><p>${AIR_ATTRIBUTION}</p>`;
    expect(sentenceIsOn(html, AIR_ATTRIBUTION)).toBe(true);
  });
});

describe('pageText', () => {
  it('collapses tags and whitespace to single spaces', () => {
    expect(pageText('<p>a\n  <b>b</b>\t c</p>')).toBe('a b c');
  });
});
