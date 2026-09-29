// CAMP-162 — the words in a page of HTML, the way a person meets them.
//
// 🔴 A CHECK MUST NOT ASSERT A PROPERTY IT CANNOT SEE. Everything in
// `cems-panels.spec.ts` is an assertion about what a reader is told beside
// Copernicus data, so it reads the HTML the component renders and never a
// constant, a class name, a `data-testid` or an `sr-only` caption. This
// module is the reading.
//
// Three other specs carry their own private copy of a stripper
// (`route-fuel.spec.tsx`, `tariff-table.spec.tsx`,
// `route-neighbours.spec.tsx`). They work on a regex, and a regex cannot
// tell where a hidden element ENDS: `<div hidden><div>a</div><p>b</p></div>`
// lazily closes at the first `</div>` and leaves "b" looking visible. For
// a check whose whole job is "is this credit actually on screen" that is
// the wrong kind of wrong, so this one walks the tags with a stack instead.
// It is a module rather than another private copy so that the next spec
// that needs to read a page has somewhere to import from.
//
// It parses `renderToStaticMarkup` output, which is well-formed. It is not
// a general HTML parser and does not pretend to be one.

/** Elements with no closing tag. */
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'source', 'track', 'wbr',
]);

/**
 * Elements that flow inside a line of text. Their tags join what is either
 * side of them WITHOUT a space, because that is what a reader sees:
 * `Ris<span>k</span>` is "Risk", and so is `Dan<wbr>ger`. Every other tag
 * is a boundary and gets a space.
 */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em',
  'font', 'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

/**
 * One token: a comment, a tag with its attributes (quoted values may
 * contain `>`), a run of text, or a stray `<`.
 */
const TOKEN =
  /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|[^<]+|</g;

/**
 * 🔴 ONE pass over the string, not one pass per entity.
 *
 * The chained form — `.replace(/&#x27;/g, "'")` then
 * `.replace(/&amp;/g, '&')` — double-unescapes: `&amp;#x27;`, which is a
 * literal `&#x27;` a page wanted to SHOW, comes out as an apostrophe.
 */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  mdash: '—',
  ndash: '–',
  middot: '·',
  hellip: '…',
  copy: '©',
};

export const decodeEntities = (s: string): string =>
  s.replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });

/**
 * Elements whose content is not text a reader is given, whatever their
 * attributes say.
 */
const NOT_TEXT = new Set(['script', 'style', 'template']);

/**
 * The Tailwind utilities that take an element off the screen or make it
 * unreadable. Matched on the utility itself, so `md:hidden`, `max-md:hidden`
 * and `!hidden` count, and `overflow-hidden` and `text-hidden` do not.
 *
 * 🔴 Hidden at ANY breakpoint is hidden. `md:hidden` is visible on a phone
 * and gone on a laptop, and a credit that disappears at one width is not a
 * credit the licence can be said to have been given. Conservative on
 * purpose: it can refuse a panel that is visible on the screens that
 * matter, and a refusal is cheap to argue with.
 */
const HIDING_UTILITIES = new Set(['sr-only', 'hidden', 'invisible', 'collapse', 'opacity-0']);

/**
 * Is this element one a reader is not shown?
 *
 * The ways HTML keeps something in the page without showing it, as they are
 * actually written in this codebase: Tailwind classes (`sr-only` is in seven
 * components, `hidden` in more), the `hidden` attribute, and inline
 * `display:none`, `visibility:hidden`, `opacity:0` or `font-size:0`. A
 * credit that survives only in one of them is not a credit anyone was given.
 *
 * ⚠️ A list of idioms, not a renderer. CSS that lives in a stylesheet under
 * a name of its own cannot be judged from markup, and nothing here pretends
 * otherwise; the browser test for the popup reads what a browser really
 * shows.
 */
const isHidden = (name: string, attributes: string): boolean => {
  if (NOT_TEXT.has(name)) return true;
  // The bare `hidden` attribute is looked for with every quoted value
  // blanked first, or `title="a hidden thing"` would hide its element.
  const names = attributes.replace(/"[^"]*"|'[^']*'/g, '""');
  if (/(?:^|\s)hidden(?:=""|=hidden|\s|\/|$)/.test(names)) return true;
  const cls = /(?:^|\s)class="([^"]*)"/.exec(attributes)?.[1] ?? '';
  const classHides = cls
    .split(/\s+/)
    .some((token) => HIDING_UTILITIES.has(token.replace(/^.*:/, '').replace(/^!/, '')));
  if (classHides) return true;
  const style = /(?:^|\s)style="([^"]*)"/.exec(attributes)?.[1] ?? '';
  return /display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*0(?![.\d])/i.test(
    style,
  );
};

interface Reading {
  /** Text nodes, tags replaced by a space and comments by nothing. */
  text: string;
  /** What attributes say: aria-label, aria-description, title, alt. */
  attributes: string[];
}

const SPOKEN_ATTRIBUTES =
  /(?:^|\s)(?:aria-label|aria-description|aria-roledescription|title|alt)="([^"]*)"/g;

function read(html: string, dropHidden: boolean, glueInline: boolean): Reading {
  const open: { name: string; hidden: boolean }[] = [];
  let hiddenDepth = 0;
  const text: string[] = [];
  const attributes: string[] = [];

  for (const match of html.matchAll(TOKEN)) {
    const [whole, slash, rawName, attrs = ''] = match;
    if (whole.startsWith('<!--')) continue;

    if (rawName === undefined) {
      if (!(dropHidden && hiddenDepth > 0)) text.push(decodeEntities(whole));
      continue;
    }

    const name = rawName.toLowerCase();
    if (slash === '/') {
      // Close the nearest open element of that name, and anything left
      // open inside it.
      let i = open.length - 1;
      while (i >= 0 && open[i].name !== name) i--;
      if (i >= 0) {
        while (open.length > i) if (open.pop()!.hidden) hiddenDepth--;
      }
      text.push(glueInline && INLINE.has(name) ? '' : ' ');
      continue;
    }

    const hidden = isHidden(name, attrs);
    const suppressed = dropHidden && (hiddenDepth > 0 || hidden);
    if (!suppressed) {
      for (const a of attrs.matchAll(SPOKEN_ATTRIBUTES)) attributes.push(decodeEntities(a[1]));
    }
    text.push(glueInline && INLINE.has(name) ? '' : ' ');
    const selfClosing = VOID.has(name) || /\/\s*$/.test(attrs);
    if (!selfClosing) {
      open.push({ name, hidden });
      if (hidden) hiddenDepth++;
    }
  }
  return { text: text.join('').replace(/\s+/g, ' ').trim(), attributes };
}

/**
 * Everything a sighted reader is shown, as one line.
 *
 * 🔴 Hidden elements are removed FIRST and deliberately. This is what the
 * "carries the credit" side reads: an assertion that a hidden caption
 * could satisfy would be an assertion about a property the page does not
 * visibly have.
 */
export const visibleText = (html: string): string => read(html, true, true).text;

/**
 * Everything a reader OR a screen reader is told, as separate strings:
 * the whole text, hidden parts included, and each attribute that gets
 * spoken or shown as a tooltip.
 *
 * 🔴 This is what the "uses no reserved word" side reads, and it is
 * deliberately the wider view. The asymmetry is the point: a credit that
 * is only in a hidden element is not a credit, but a warning that is only
 * in a hidden element is still a warning — it is spoken, beside the data,
 * to whoever is listening. The two questions are answered by different
 * readings for that reason.
 *
 * What it does NOT read: class names, `data-*` attributes, `href`s. A
 * Tailwind `border-danger` or a URL ending `?alert=1` is not a sentence,
 * and a check that fired on either would be the false alarm that teaches
 * people to switch it off.
 */
export const everythingSaid = (html: string): string[] => {
  // Two readings of the same text: tags of inline elements joined without a
  // space (what a reader sees: `Ris<span>k</span>` is "Risk") and every tag
  // as a space (what two adjacent elements say: `<b>Fire</b><i>risk</i>`).
  // A word has to escape both to escape.
  const joined = read(html, false, true);
  const spaced = read(html, false, false);
  return [joined.text, spaced.text, ...joined.attributes];
};
