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

  it('does not count text inside a style', () => {
    const html = `<style>a > b { content: "${AIR_ATTRIBUTION}"; }</style>`;
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
