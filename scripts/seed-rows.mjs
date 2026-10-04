// CAMP-182 / CAMP-199 — the CI seed file, read as rows.
//
// 🔴 ITS OWN FILE SO A TEST CAN READ THE SAME ROWS CI DOES.
//
// `check-fixture-counts.mjs` counts them and `apps/web/tests/unit/
// setting.spec.ts` renders a paragraph from each one. Both have to see
// the same rows: a spec that carried its own `INSERT` parser would be a
// second corpus, and a corpus the author wrote agrees with the author —
// which is exactly how 34 of 70 rows came to share a paragraph with
// every test green.
//
// It is split out rather than imported from the guard because that file
// uses `import.meta`, which Playwright's transform cannot load.

export function splitTuple(s) {
  const out = [];
  let buf = '';
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === "'" && s[i + 1] === "'") {
        buf += "''";
        i++;
        continue;
      }
      if (c === "'") quoted = false;
      buf += c;
      continue;
    }
    if (c === "'") {
      quoted = true;
      buf += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  out.push(buf.trim());
  return out;
}

/** `'paid'::camping_spots_type_enum` → `paid`; `NULL` → null. */
export function literal(v) {
  const bare = v.replace(/::[A-Za-z_][\w.]*$/, '').trim();
  if (/^NULL$/i.test(bare)) return null;
  const m = /^'([\s\S]*)'$/.exec(bare);
  return m ? m[1].replace(/''/g, "'") : bare;
}

/** Every `INSERT INTO camping_spots` in the seed, as objects. */
export function readSpots(sql) {
  const rows = [];
  const unreadable = [];
  const re =
    /INSERT INTO camping_spots\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*?)\);\s*$/gm;
  for (const m of sql.matchAll(re)) {
    const cols = m[1].split(',').map((c) => c.trim());
    const vals = splitTuple(m[2]);
    if (cols.length !== vals.length) {
      // 🔴 Loud, not `continue`. This silently swallowed the DO block's
      // computed twin — the regex DOES match it (13 columns, 17 values
      // of `anchor.*`) — so `rows: 73` was right by accident while the
      // tally underneath was built from 72. A parser that drops what it
      // cannot read, quietly, is how a wrong number looks like a right
      // one. Everything reached through `anchor.` is the twin and is
      // counted separately below; anything else is a row we have
      // misread and has to say so.
      if (!/\banchor\./.test(m[2])) {
        unreadable.push(`${cols.length} columns, ${vals.length} values`);
      }
      continue;
    }
    const row = {};
    cols.forEach((c, i) => (row[c] = literal(vals[i])));
    rows.push(row);
  }
  rows.unreadable = unreadable;
  return rows;
}

/**
 * The one campsite the seed marks as gone, chosen the way the DO block
 * chooses it: region present, no explicit `toilets` answer, no computed
 * context, highest slug.
 *
 * 🔴 Re-implemented rather than ignored. If this picks a different row
 * than Postgres does, the count below is wrong and the comparison with
 * the page would say so — which is the point of having both.
 */
