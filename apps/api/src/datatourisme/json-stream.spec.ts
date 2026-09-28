import { JsonValueSplitter } from './json-stream';

// CAMP-147. These are about the cases a splitter passes on a toy input
// and fails on a 5 GB one: chunk boundaries that land inside a string,
// inside an escape, or between two documents.

describe('JsonValueSplitter', () => {
  const feed = (chunks: string[]): string[] => {
    const s = new JsonValueSplitter();
    const out: string[] = [];
    for (const c of chunks) out.push(...s.push(c));
    s.end();
    return out;
  };

  it('splits documents that arrive back to back', () => {
    expect(feed(['{"a":1}\n{"b":2}\n'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('holds a document that straddles a chunk boundary', () => {
    // The real pipe hands over 64 KiB at a time and a DATAtourisme
    // object averages 38 KiB, so this is the ordinary case, not an edge.
    expect(feed(['{"a":', '1}{"b"', ':2}'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('survives being fed one character at a time', () => {
    const doc = '{"name":"Camping l\'Étoile","n":[1,2,{"x":"}"}]}';
    expect(feed(doc.split(''))).toEqual([doc]);
  });

  it('is not fooled by braces inside a string', () => {
    // 🔴 The defect this whole class exists for. A brace-counting
    // scanner with no string rule ends this document at the `}` inside
    // the name and emits half of it — which still parses.
    const doc = '{"name":"Aire {du} Var","price":"13.5"}';
    expect(feed([doc])).toEqual([doc]);
  });

  it('is not fooled by an escaped quote inside a string', () => {
    // 🔴 An ODD number of escaped quotes, and a brace after them, and
    // both details were found by mutation testing.
    //
    // The first version of this test used
    // `{"name":"Camping \"Les Pins\" {Var}","ok":true}` — two escaped
    // quotes, so a splitter that ignores escapes flips in and out of
    // "string" an even number of times and lands back in the right
    // state. The document still came out whole and the test stayed
    // green against an implementation with escape handling deleted.
    //
    // With one escaped quote the broken scanner is left inside-out for
    // the rest of the document, and the `{` below is then counted as a
    // real nesting level: the document never closes and the stream is
    // swallowed. Which is the actual failure, at 129 594 documents.
    const doc = '{"name":"Camping l\\"Étoile {Var}","ok":true}';
    expect(feed([doc])).toEqual([doc]);
  });

  it('handles an escaped backslash immediately before a quote', () => {
    // `"a\\"` is a complete string ending in one backslash. Treating the
    // final `\` as escaping the quote would swallow the rest of the feed.
    const doc = '{"path":"a\\\\","next":{"b":1}}';
    expect(feed([doc])).toEqual([doc]);
  });

  it('keeps escape state across a chunk boundary', () => {
    // 🔴 The backslash is the last byte of one chunk and the quote it
    // escapes is the first byte of the next. A splitter that resets its
    // escape flag per chunk reads that quote as the end of the string.
    //
    // One escaped quote and a brace after it, for the reason spelled out
    // above: with two, a broken scanner ends up in the right state by
    // accident and the test proves nothing.
    const doc = '{"q":"say \\"hi {then}","after":1}';
    const at = doc.indexOf('\\') + 1;
    expect(feed([doc.slice(0, at), doc.slice(at)])).toEqual([doc]);
  });

  it('throws when the stream ends mid-document', () => {
    // 🔴 A truncated download must not look like a short but successful
    // import. This is the failure that would otherwise be invisible.
    const s = new JsonValueSplitter();
    s.push('{"a":1}{"b":');
    expect(() => s.end()).toThrow(/ended inside a document/);
  });

  it('throws on a closing brace with nothing open', () => {
    const s = new JsonValueSplitter();
    expect(() => s.push('{"a":1}}')).toThrow(/unbalanced/);
  });

  it('accepts trailing whitespace after the last document', () => {
    expect(feed(['{"a":1}', '\n  \n'])).toEqual(['{"a":1}']);
  });

  it('does not grow its buffer across many documents', () => {
    // The `i = -1` reset after a cut is what keeps this from holding the
    // whole 5 GB stream in one string. Without it the splitter still
    // returns the right documents, so only a memory assertion catches it.
    const s = new JsonValueSplitter();
    for (let i = 0; i < 200; i++)
      s.push(`{"i":${i},"pad":"${'x'.repeat(500)}"}`);
    s.end();
    expect((s as unknown as { buffer: string }).buffer.length).toBeLessThan(16);
  });
});
