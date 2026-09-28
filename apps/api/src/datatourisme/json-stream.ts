// CAMP-147: split a stream of back-to-back JSON documents.
//
// 🔴 Why this exists at all.
//
// The DATAtourisme feed is a ZIP of 129 594 separate JSON files, 5.0 GB
// unpacked from an 810 MB archive. Three ways to read it and two of them
// are wrong:
//
//   unzip -o to disk, then read      5.0 GB written and re-read, and
//                                    129 594 file creations, to look at
//                                    each object once.
//   unzip -p per entry               129 594 process spawns.
//   unzip -p 'objects/*'             one process, one pass, nothing on
//                                    disk — but the object boundaries
//                                    arrive only as the documents
//                                    themselves.
//
// The third is what this file makes usable. The repository already
// shells out to osmium, ogr2ogr and psql for the same reason: the tool
// that does this well is not a library.
//
// 🔴 Brace counting, WITH the string rules, not a line-based split.
//
// The tempting shortcut is that these files are pretty-printed, so every
// document ends with a `}` in column 0. That is a fact about today's
// formatter, not about JSON, and the failure mode when it changes is
// silent: a truncated document parses, or two documents merge, and the
// importer writes prices that belong to the wrong campsite. So the
// scanner tracks strings and escapes, which is the actual grammar.

/**
 * A `"…"` inside JSON can contain braces, and `\\"` ends nothing.
 *
 * The three-state walk below is the whole reason this is a class and not
 * a regex: `{"name": "Camping l'Étoile \"Les Pins\" {Var}"}` contains
 * two braces and two quotes that mean nothing structurally, and any
 * scanner that does not know it is inside a string gets it wrong.
 */
export class JsonValueSplitter {
  private buffer = '';
  private depth = 0;
  private inString = false;
  private escaped = false;
  /** Index in `buffer` where the current document starts, or -1. */
  private start = -1;

  /**
   * Feed a chunk; get back every document that CLOSED in it.
   *
   * A document straddling two chunks is held until it is complete, which
   * is the case a naive implementation gets right on small inputs and
   * wrong at 64 KiB pipe boundaries.
   */
  push(chunk: string): string[] {
    const out: string[] = [];
    // Anything already buffered is a partial document; scanning restarts
    // at the join so a `\` at the very end of the previous chunk still
    // escapes the first character of this one.
    const scanFrom = this.buffer.length;
    this.buffer += chunk;

    for (let i = scanFrom; i < this.buffer.length; i++) {
      const ch = this.buffer[i];

      if (this.inString) {
        if (this.escaped) {
          this.escaped = false;
        } else if (ch === '\\') {
          this.escaped = true;
        } else if (ch === '"') {
          this.inString = false;
        }
        continue;
      }

      if (ch === '"') {
        this.inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') {
        if (this.depth === 0) this.start = i;
        this.depth++;
        continue;
      }
      if (ch === '}' || ch === ']') {
        this.depth--;
        // 🔴 A closing brace with nothing open means the stream is not
        // what we think it is. Throwing beats returning a document that
        // begins halfway through another one.
        if (this.depth < 0) {
          throw new Error(
            `JsonValueSplitter: unbalanced "${ch}" with no open document`,
          );
        }
        if (this.depth === 0 && this.start >= 0) {
          out.push(this.buffer.slice(this.start, i + 1));
          this.buffer = this.buffer.slice(i + 1);
          // Everything before the cut is gone, so the cursor restarts.
          // Without this the buffer grows to the whole 5 GB stream.
          i = -1;
          this.start = -1;
        }
        continue;
      }
      // Whitespace and anything else between documents is ignored. There
      // is deliberately no handling for a bare top-level scalar: this
      // stream is documents, and a stray `null` between them is a
      // corrupt archive, not something to swallow.
    }

    return out;
  }

  /**
   * Assert the stream ended cleanly.
   *
   * 🔴 Called, and its failure is fatal. A truncated download that ends
   * mid-document otherwise produces a slightly short import that looks
   * exactly like a successful one — the single most expensive shape of
   * bug in a pipeline whose output is a number on a public page.
   */
  end(): void {
    if (this.depth !== 0 || this.buffer.trim() !== '') {
      throw new Error(
        `JsonValueSplitter: stream ended inside a document ` +
          `(depth ${this.depth}, ${this.buffer.trim().length} bytes pending)`,
      );
    }
  }
}
