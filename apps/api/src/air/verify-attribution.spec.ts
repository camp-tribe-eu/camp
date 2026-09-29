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
  // comment. Text in the file is not text on the page.
  it('does not count text inside a comment, a script or a style', () => {
    for (const wrap of [
      '<!-- X -->',
      '<script>var s = "X";</script>',
      '<style>/* X */</style>',
    ]) {
      expect(
        sentenceIsOn(wrap.replace('X', AIR_ATTRIBUTION), AIR_ATTRIBUTION),
      ).toBe(false);
    }
  });
});

describe('pageText', () => {
  it('collapses tags and whitespace to single spaces', () => {
    expect(pageText('<p>a\n  <b>b</b>\t c</p>')).toBe('a b c');
  });
});
