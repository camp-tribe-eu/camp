#!/usr/bin/env node
// CAMP-172: refuse to replace the CI fixture with a smaller one.
//
//   node scripts/ci/check-fixture-not-shrunk.mjs <replaced.sql> <candidate.sql>
//   node scripts/ci/check-fixture-not-shrunk.mjs <replaced.sql> <candidate.sql> \
//        --allow-shrink=camping_spots,bathing_waters
//   node scripts/ci/check-fixture-not-shrunk.mjs <replaced.sql> <candidate.sql> --tables-only
//   node scripts/ci/check-fixture-not-shrunk.mjs --self-test
//
// regenerate.sh calls it before it overwrites ci-seed.sql. Exit 0: the
// candidate holds every table the old file seeds, each with at least as
// many rows. Exit 1: it does not. Exit 2: this could not read or count.
//
// 🔴 THE STANDARD WAY OF UPDATING A THING DESTROYS THE THING.
//
// regenerate.sh rebuilt ci-seed.sql from three files, and bathing_waters
// (43 rows, appended to ci-seed.sql by hand in CAMP-168) was in none of
// them. The next person to run the standard tool would have deleted the
// table, every campsite page would have rendered a correct "no bathing
// water nearby", and the three-state tests would still have passed —
// because the "none" state would genuinely have been drawn right.
//
// The same day, `check-dependencies.mjs --update` rewrote the advisory
// baseline from a local audit and deleted 123 lines of reasoning
// (CAMP-171). And before either, the dependency guard's hand-written
// workspace list stopped at two entries and reported "no new advisories"
// over 49 of them in a third (its header has that story).
//
// One shape three times: a tool that rebuilds a thing from a list kept
// by hand reproduces exactly what the list remembers, and says "done".
// Fixing the list fixes one table. The lasting fix is to make the tool
// compare what it is about to write with what it is about to replace,
// and to derive that scope from the file being replaced — the same
// move check-dependencies.mjs makes when it reads `workspaces` instead
// of naming them. There is no list of table names in this file.
//
// 🔴 WHAT "SHRUNK" MEANS, AND WHAT IT DOES NOT CATCH.
//
// Per table, counted from the INSERT statements themselves (see
// countRows): a table present before and absent now fails; a table with
// fewer rows now fails. Equal passes, and so does growth.
//
// It says nothing about WHICH rows, or whether the file loads. Measured
// 29.09.2026 on a scratch copy of the development database (61 558
// campsites, 22 010 bathing waters), regenerating gives
//
//     camping_spots 73 -> 90    bathing_waters 43 -> 62    osm_route_poi 6 -> 6
//
// — more rows in every table, and a fixture nobody could use: the 89
// campsites are in nine countries and none is Slovenian, one of the 72 it
// replaces survives, and loading it stops at the "gone" block ("expected to
// mark exactly one campsite gone, marked 0") because no campsite with an
// empty context is left for the selection to pick. The database now holds
// 27 countries and the selection rules take the largest regions. This
// guard passes that file. It counts; it does not judge whether the fixture
// still tests what it was built to test.
//
// 🔴 Why the escape hatch names a table. A blanket "yes, shrink" flag is
// `--update` again: one habit-typed argument and the guard is off for
// everything. `--allow-shrink=t` excuses table `t` and nothing else, and
// is printed in the output so it is visible in the log it was used in.
//
// 🔴 Why it counts by reading SQL rather than by loading the file into a
// database. It has to run where there is no database (the self-test, the
// `security` job) and on a candidate that has not been written anywhere
// yet. The price is that it understands one shape of INSERT and refuses
// the rest: anything it cannot count throws, because "cannot count" that
// reads as "zero" is how a guard becomes a no-op.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── reading SQL, just far enough to count what it inserts ──────────────

const IDENT_START = /[A-Za-z_\u0080-￿]/;
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-￿]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/;

/**
 * Tokens the counter needs: words, quoted identifiers and the five
 * punctuation marks that shape an INSERT. Comments and string literals
 * are consumed and never emitted — an INSERT inside either is not one.
 *
 * Dollar-quoted bodies are NOT dropped: ci-seed-gone.sql inserts a row
 * from inside a DO block, and a scanner that skipped every $$ would miss
 * a table that is seeded only there. Their tokens are emitted in line,
 * fenced by ';' so a statement cannot run across the boundary.
 */
function lex(sql, out, startLine) {
  const n = sql.length;
  let i = 0;
  let line = startLine;

  while (i < n) {
    const c = sql[i];

    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') {
      i++;
      continue;
    }

    // -- line comment
    if (c === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }

    // /* block comment */ — PostgreSQL nests them.
    if (c === '/' && sql[i + 1] === '*') {
      const opened = line;
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          if (sql[i] === '\n') line++;
          i++;
        }
      }
      if (depth > 0) throw new Error(`unterminated /* comment opened at line ${opened}`);
      continue;
    }

    // "quoted identifier"
    if (c === '"') {
      const opened = line;
      let v = '';
      i++;
      for (;;) {
        if (i >= n) throw new Error(`unterminated quoted identifier at line ${opened}`);
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            v += '"';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (sql[i] === '\n') line++;
        v += sql[i++];
      }
      out.push({ t: 'qident', v, line: opened });
      continue;
    }

    // 'string', including E'..\'..' which takes backslash escapes.
    // Handled at the word below, which knows whether an E preceded it;
    // a bare quote arrives here.
    if (c === "'") {
      i = skipString(sql, i, false, line, (d) => (line += d));
      continue;
    }

    // $tag$ ... $tag$
    if (c === '$') {
      const m = DOLLAR_TAG.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) throw new Error(`unterminated ${tag} quote at line ${line}`);
        const body = sql.slice(i + tag.length, close);
        out.push({ t: 'p', v: ';', line });
        lex(body, out, line);
        out.push({ t: 'p', v: ';', line });
        for (const ch of body) if (ch === '\n') line++;
        i = close + tag.length;
        continue;
      }
      i++; // $1, or a lone $
      continue;
    }

    if (IDENT_START.test(c)) {
      const start = i;
      while (i < n && IDENT_CHAR.test(sql[i])) i++;
      const raw = sql.slice(start, i);
      // e'..' / b'..' / x'..' / n'..' are string literals, not a word
      // followed by one. Only E takes backslash escapes.
      if (sql[i] === "'" && /^[ebxnEBXN]$/.test(raw)) {
        i = skipString(sql, i, raw === 'e' || raw === 'E', line, (d) => (line += d));
        continue;
      }
      out.push({ t: 'word', v: raw.toLowerCase(), raw, line });
      continue;
    }

    if (c === '(' || c === ')' || c === ',' || c === ';' || c === '.') {
      out.push({ t: 'p', v: c, line });
    }
    i++; // digits, operators, casts: nothing an INSERT's shape depends on
  }
}

/** Index just past the string literal that opens at `i`. */
function skipString(sql, i, backslashEscapes, line, addLines) {
  const n = sql.length;
  const opened = line;
  i++; // the opening quote
  for (;;) {
    if (i >= n) throw new Error(`unterminated string literal opened at line ${opened}`);
    const d = sql[i];
    if (d === '\n') addLines(1);
    if (backslashEscapes && d === '\\') {
      if (sql[i + 1] === '\n') addLines(1);
      i += 2;
      continue;
    }
    // A doubled quote needs no case of its own: 'it''s' is 'it' followed by
    // 's', two literals with nothing between them, and nothing is emitted
    // for either. (Deleting the case that used to be here was the mutation
    // that no test could turn red — it is not a behaviour, it is a synonym.)
    if (d === "'") return i + 1;
    i++;
  }
}

const isP = (tok, v) => tok !== undefined && tok.t === 'p' && tok.v === v;

/** Index just past the ')' that closes the '(' at `j`. */
function skipGroup(tokens, j) {
  const opened = tokens[j].line;
  let depth = 0;
  for (let k = j; k < tokens.length; k++) {
    if (isP(tokens[k], '(')) depth++;
    else if (isP(tokens[k], ')') && --depth === 0) return k + 1;
  }
  throw new Error(`unbalanced parenthesis opened at line ${opened}`);
}

/** A table name as a comparison key: unquoted folds to lower case, quoted stays; `public.` is dropped. */
function tableKey(parts) {
  const name = parts.join('.');
  return name.startsWith('public.') ? name.slice('public.'.length) : name;
}

/**
 * How many rows each table receives from the INSERTs in `sql`.
 *
 * Understands `INSERT INTO t [(cols)] VALUES (..), (..)`, one statement
 * per table or several, at top level or inside a DO block, and counts the
 * tuples. A statement inside a DO block is counted as if it ran, which is
 * right for ci-seed-gone.sql (its one INSERT is guarded by a check that
 * raises if it did not happen) and would be wrong for a conditional one.
 *
 * 🔴 Anything else that puts rows in a table THROWS: INSERT ... SELECT,
 * DEFAULT VALUES, COPY. Skipping them would make the table look absent
 * or empty, and an absent table is the one thing this file exists to
 * report — so an unreadable shape must be a loud "teach the counter",
 * never a quiet zero.
 *
 * @returns Map<table, rows>
 */
export function countRows(sql) {
  const tokens = [];
  lex(sql, tokens, 1);
  const rows = new Map();

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t !== 'word') continue;

    if (tok.v === 'copy' && (i === 0 || isP(tokens[i - 1], ';'))) {
      throw new Error(
        `COPY at line ${tok.line}: the counter reads INSERT ... VALUES only — teach it COPY ` +
          'before using one, or the table it fills will read as absent',
      );
    }

    if (tok.v !== 'insert' || tokens[i + 1]?.t !== 'word' || tokens[i + 1].v !== 'into') continue;

    let j = i + 2;
    const parts = [];
    for (;;) {
      const t = tokens[j];
      if (!t || (t.t !== 'word' && t.t !== 'qident')) {
        throw new Error(`INSERT INTO with no table name at line ${tok.line}`);
      }
      parts.push(t.v);
      j++;
      if (isP(tokens[j], '.')) {
        j++;
        continue;
      }
      break;
    }
    const table = tableKey(parts);

    if (isP(tokens[j], '(')) j = skipGroup(tokens, j);

    if (tokens[j]?.t !== 'word' || tokens[j].v !== 'values') {
      throw new Error(
        `cannot count the rows of "INSERT INTO ${table}" at line ${tok.line}: only ` +
          'INSERT ... VALUES is understood, and a count that cannot be made must not read as zero',
      );
    }
    j++;

    let n = 0;
    for (;;) {
      if (!isP(tokens[j], '(')) {
        throw new Error(`INSERT INTO ${table} at line ${tok.line}: expected a row after VALUES`);
      }
      j = skipGroup(tokens, j);
      n++;
      if (isP(tokens[j], ',')) {
        j++;
        continue;
      }
      break;
    }

    rows.set(table, (rows.get(table) ?? 0) + n);
    i = j - 1;
  }

  return rows;
}

// ── the decision ───────────────────────────────────────────────────────

/**
 * The whole decision, with no filesystem in it, so the self-test can
 * drive it through every branch.
 *
 * @param replaced   Map<table, rows> of the file about to be overwritten
 * @param candidate  Map<table, rows> of what would overwrite it
 * @param opts.allow       Set<table> allowed to lose rows or vanish
 * @param opts.tablesOnly  compare which tables exist, not how many rows
 */
export function compare(replaced, candidate, { allow = new Set(), tablesOnly = false } = {}) {
  const problems = [];
  const notes = [];
  const lines = [];

  // 🔴 A baseline that counts to nothing would pass everything: every
  // candidate holds "at least" zero rows of zero tables. That is not a
  // clean comparison, it is a counter that cannot see the file — so it
  // fails, exactly as check-dependencies.mjs refuses to compare two
  // empty workspace lists.
  if (replaced.size === 0) {
    problems.push({
      table: null,
      kind: 'blind-baseline',
      text:
        'the file being replaced contains no INSERT this counter can read, so there is ' +
        'nothing to protect and any candidate would pass — refusing to call that a pass',
    });
    return { problems, notes, lines };
  }

  const tables = [...new Set([...replaced.keys(), ...candidate.keys()])].sort();
  const usedAllowances = new Set();

  for (const t of tables) {
    const before = replaced.get(t) ?? 0;
    const after = candidate.get(t) ?? 0;
    lines.push({ table: t, before, after });

    if (before === 0) {
      notes.push(`new table ${t}: ${after} rows`);
      continue;
    }

    if (after === 0) {
      if (allow.has(t)) {
        usedAllowances.add(t);
        notes.push(`ALLOWED: ${t} is gone (${before} rows in the file being replaced, none now)`);
      } else {
        problems.push({
          table: t,
          kind: 'table-missing',
          text:
            `TABLE MISSING ${t}: the file being replaced seeds ${before} rows into it and ` +
            'the new one seeds none — nothing in the sources produces it. Add a statement ' +
            'for it to _select.sql, or put its rows in a ci-seed-<name>.sql beside it ' +
            '(regenerate.sh appends every one).',
        });
      }
      continue;
    }

    if (!tablesOnly && after < before) {
      if (allow.has(t)) {
        usedAllowances.add(t);
        notes.push(`ALLOWED: ${t} shrinks ${before} -> ${after}`);
      } else {
        problems.push({
          table: t,
          kind: 'fewer-rows',
          text: `FEWER ROWS in ${t}: ${before} in the file being replaced, ${after} in the new one.`,
        });
      }
    }
  }

  for (const t of allow) {
    if (!usedAllowances.has(t)) {
      notes.push(`--allow-shrink=${t} was not needed: ${t} did not lose anything`);
    }
  }

  return { problems, notes, lines };
}

export function parseAllow(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function render(lines) {
  const width = Math.max(0, ...lines.map((l) => l.table.length));
  const num = Math.max(0, ...lines.map((l) => String(Math.max(l.before, l.after)).length));
  return lines
    .map(
      (l) =>
        `  ${l.table.padEnd(width)}  ${String(l.before).padStart(num)} -> ${String(l.after).padStart(num)}`,
    )
    .join('\n');
}

// ── command line ───────────────────────────────────────────────────────

/**
 * One read, and a missing file answered by its own error rather than a
 * check-then-read pair (CodeQL js/file-system-race). Only the caller
 * decides what "missing" means; here it is fatal.
 */
function readSql(file, what) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`cannot read ${what} (${file}): ${err.code ?? err.message}`);
  }
}

function run(argv) {
  const flags = argv.filter((a) => a.startsWith('--'));
  const files = argv.filter((a) => !a.startsWith('--'));
  const tablesOnly = flags.includes('--tables-only');
  const allowFlag = flags.find((f) => f.startsWith('--allow-shrink='));
  const unknown = flags.filter((f) => f !== '--tables-only' && !f.startsWith('--allow-shrink='));

  if (files.length !== 2 || unknown.length > 0) {
    console.error(
      'usage: check-fixture-not-shrunk.mjs <replaced.sql> <candidate.sql> ' +
        '[--tables-only] [--allow-shrink=table,table]' +
        (unknown.length ? `\n  unknown option: ${unknown.join(' ')}` : ''),
    );
    return 2;
  }

  let replaced;
  let candidate;
  try {
    replaced = countRows(readSql(files[0], 'the file being replaced'));
    candidate = countRows(readSql(files[1], 'the candidate'));
  } catch (err) {
    console.error(`fixture guard: ${err.message}`);
    return 2;
  }

  const allow = parseAllow(allowFlag?.slice('--allow-shrink='.length));
  const result = compare(replaced, candidate, { allow, tablesOnly });
  const table = render(result.lines);

  console.log(
    `fixture guard: rows per table, the file being replaced -> the candidate` +
      (tablesOnly ? ' (tables only: row counts not compared)' : ''),
  );
  if (table) console.log(table);
  for (const note of result.notes) console.log(`  note: ${note}`);

  if (result.problems.length === 0) {
    console.log('fixture guard: ok — no table lost, none smaller');
    return 0;
  }

  console.error('');
  for (const p of result.problems) console.error(`✗ ${p.text}`);
  console.error(
    '\nNothing was written. If the loss is intended, name the table:\n' +
      `  regenerate.sh --allow-shrink=${
        [...new Set(result.problems.map((p) => p.table).filter(Boolean))].join(',') || '<table>'
      }`,
  );
  return 1;
}

// ── self-test ──────────────────────────────────────────────────────────

function selfTest() {
  let failures = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) {
      console.error(
        `  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`,
      );
      failures++;
    } else {
      console.log(`  ✓ ${name}`);
    }
  };
  const throws = (name, fn, pattern) => {
    let message = null;
    try {
      fn();
    } catch (err) {
      message = err.message;
    }
    check(name, message !== null && pattern.test(message), true);
  };
  const counts = (sql) => Object.fromEntries([...countRows(sql)].sort());
  const map = (o) => new Map(Object.entries(o));
  const kinds = (r) => r.problems.map((p) => `${p.table}:${p.kind}`);

  // — counting ————————————————————————————————————————————————
  check(
    'one INSERT ... VALUES is one row',
    counts(`INSERT INTO t (a, b) VALUES (1, 'x');`),
    { t: 1 },
  );
  check(
    'a multi-row INSERT counts its tuples, not its statements',
    counts(`INSERT INTO bathing_waters (a, b) VALUES (1, f(2, 3)), (4, 'y'), (5, 'z');`),
    { bathing_waters: 3 },
  );
  check(
    'several statements add up',
    counts(`INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2), (3);\nINSERT INTO u VALUES (4);`),
    { t: 3, u: 1 },
  );
  check(
    'a string holding ), ( and INSERT INTO is only a string',
    counts(`INSERT INTO t VALUES ('a), (b', 1), ('INSERT INTO ghost VALUES (1)', 2);`),
    { t: 2 },
  );
  check(
    "a doubled quote inside a string does not hide the rest of the statement",
    counts(`INSERT INTO t VALUES ('it''s), (not a row', 1);`),
    { t: 1 },
  );
  check(
    "an E'' string takes a backslash-escaped quote (quote_literal emits these)",
    counts(String.raw`INSERT INTO t VALUES (E'a\'b), (c', 1), (E'd', 2);`),
    { t: 2 },
  );
  check(
    'an ordinary string keeps its backslash as a backslash',
    counts(String.raw`INSERT INTO t VALUES ('a\', 1), ('b', 2);`),
    { t: 2 },
  );
  check(
    'comments hide nothing and invent nothing',
    counts(`-- INSERT INTO ghost VALUES (1);\n/* INSERT INTO ghost2 VALUES (1) /* nested */ still comment */\nINSERT INTO real VALUES (1);`),
    { real: 1 },
  );
  check(
    'a table seeded only inside a DO block is still seen',
    counts(`DO $$ BEGIN\n  INSERT INTO camping_spots (name) VALUES ('x');\nEND $$;`),
    { camping_spots: 1 },
  );
  check(
    'a tagged dollar quote is read the same way',
    counts(`DO $fix$ BEGIN INSERT INTO only_here VALUES (1), (2); END $fix$;`),
    { only_here: 2 },
  );
  check(
    'quoted and schema-qualified names fold to one key',
    counts(`INSERT INTO "public"."t" VALUES (1);\nINSERT INTO public.T VALUES (2);\nINSERT INTO t VALUES (3);`),
    { t: 3 },
  );
  check(
    'UPDATE and DELETE add no rows',
    counts(`UPDATE t SET a = 1;\nDELETE FROM t;\nINSERT INTO t VALUES (1);`),
    { t: 1 },
  );
  check('a file with no INSERT counts to nothing', counts(`SELECT 1;`), {});
  throws(
    'INSERT ... SELECT throws instead of reading as zero',
    () => countRows(`INSERT INTO t (a) SELECT 1;`),
    /cannot count.*INSERT INTO t/,
  );
  throws(
    'DEFAULT VALUES throws',
    () => countRows(`INSERT INTO t DEFAULT VALUES;`),
    /cannot count/,
  );
  throws('COPY throws', () => countRows(`COPY t (a) FROM stdin;\n1\n\\.\n`), /COPY at line 1/);
  throws('an unterminated string throws', () => countRows(`INSERT INTO t VALUES ('a);`), /unterminated string/);
  throws('unbalanced parentheses throw', () => countRows(`INSERT INTO t VALUES (1, (2);`), /unbalanced/);

  // — the decision ————————————————————————————————————————————
  const old = map({ camping_spots: 72, osm_route_poi: 6, bathing_waters: 43 });
  const none = new Set();

  check('the same fixture passes', kinds(compare(old, old)), []);
  check(
    'more rows and a new table pass',
    kinds(compare(old, map({ camping_spots: 89, osm_route_poi: 6, bathing_waters: 62, extra: 3 }))),
    [],
  );
  check(
    '🔴 a table that fell out of the sources fails — the CAMP-172 case, bathing_waters gone',
    kinds(compare(old, map({ camping_spots: 72, osm_route_poi: 6 }))),
    ['bathing_waters:table-missing'],
  );
  check(
    'a table with fewer rows fails',
    kinds(compare(old, map({ camping_spots: 72, osm_route_poi: 6, bathing_waters: 42 }))),
    ['bathing_waters:fewer-rows'],
  );
  check(
    'ONE row fewer is enough; equal is not fewer',
    [
      kinds(compare(map({ t: 5 }), map({ t: 4 }))),
      kinds(compare(map({ t: 5 }), map({ t: 5 }))),
    ],
    [['t:fewer-rows'], []],
  );
  check(
    'every loss is reported, not just the first',
    kinds(compare(old, map({ camping_spots: 10 }))).sort(),
    ['bathing_waters:table-missing', 'camping_spots:fewer-rows', 'osm_route_poi:table-missing'],
  );
  check(
    'an empty candidate loses every table',
    kinds(compare(old, new Map())).length,
    3,
  );
  check(
    'a baseline the counter cannot read is a failure, not a pass',
    kinds(compare(new Map(), map({ t: 1 }))),
    ['null:blind-baseline'],
  );
  check(
    'an empty baseline and an empty candidate are still a failure',
    kinds(compare(new Map(), new Map())),
    ['null:blind-baseline'],
  );

  // — the escape hatch is per table ————————————————————————
  const lostBathing = map({ camping_spots: 72, osm_route_poi: 6 });
  check(
    '--allow-shrink=<table> excuses that table',
    kinds(compare(old, lostBathing, { allow: new Set(['bathing_waters']) })),
    [],
  );
  check(
    'and only that table: another one shrinking in the same run still fails',
    kinds(compare(old, map({ camping_spots: 10, osm_route_poi: 6 }), { allow: new Set(['bathing_waters']) })),
    ['camping_spots:fewer-rows'],
  );
  check(
    'an allowance that was used is printed, so it is in the log',
    compare(old, lostBathing, { allow: new Set(['bathing_waters']) }).notes,
    ['ALLOWED: bathing_waters is gone (43 rows in the file being replaced, none now)'],
  );
  check(
    'an allowance nothing needed is said out loud',
    compare(old, old, { allow: new Set(['camping_spots']) }).notes,
    ['--allow-shrink=camping_spots was not needed: camping_spots did not lose anything'],
  );
  check('parseAllow splits, trims and drops blanks', [...parseAllow(' a, b ,,c')], ['a', 'b', 'c']);
  check('no flag allows nothing', [...parseAllow(undefined)], []);

  // — --tables-only: for a database that IS the fixture ———————————————
  check(
    'tables-only ignores a smaller row count',
    kinds(compare(old, map({ camping_spots: 5, osm_route_poi: 1, bathing_waters: 1 }), { tablesOnly: true })),
    [],
  );
  check(
    'but tables-only still fails on a missing table',
    kinds(compare(old, map({ camping_spots: 5, osm_route_poi: 1 }), { tablesOnly: true })),
    ['bathing_waters:table-missing'],
  );

  // — against the repository, not against a description of it ————————————
  //
  // 🔴 The table set of the REAL fixture, found a second way. A regex over
  // `INSERT INTO <name>` shares nothing with the tokenizer above, so if
  // the tokenizer stopped seeing a table (a new quoting form, a DO block
  // it fenced wrongly) the two would disagree. There is no list of names
  // here to go stale: the answer comes from the file on disk.
  const fixtureUrl = new URL('../../apps/api/test/fixtures/ci-seed.sql', import.meta.url);
  const fixture = readSql(fixtureUrl, 'the committed fixture');
  const viaRegex = [
    ...new Set([...fixture.matchAll(/INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase())),
  ].sort();
  const viaCounter = countRows(fixture);
  check('the real fixture: the counter sees every table a regex finds', [...viaCounter.keys()].sort(), viaRegex);
  check('and there is more than one, so the comparison is not two empty lists', viaRegex.length > 1, true);
  check(
    'and every one of them has rows',
    [...viaCounter.values()].every((n) => n > 0),
    true,
  );
  check('the real fixture compared with itself passes', kinds(compare(viaCounter, viaCounter)), []);

  // — the command line, end to end ——————————————————————————————
  //
  // 🔴 mkdtemp, not a predictable name in tmpdir: CodeQL failed the sibling
  // guard on js/insecure-temporary-file for exactly that (see the same box
  // in check-dependencies.mjs).
  const box = mkdtempSync(path.join(tmpdir(), 'camptribe-fixture-guard-'));
  try {
    const here = fileURLToPath(import.meta.url);
    const write = (name, text) => {
      const file = path.join(box, name);
      writeFileSync(file, text);
      return file;
    };
    const cli = (...args) => {
      const r = spawnSync(process.execPath, [here, ...args], { encoding: 'utf8' });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };

    const before = write(
      'before.sql',
      `INSERT INTO a VALUES (1), (2);\nINSERT INTO b VALUES (1);\n`,
    );
    const same = write('same.sql', `INSERT INTO a VALUES (1);\nINSERT INTO a VALUES (2);\nINSERT INTO b VALUES (9);\n`);
    const lost = write('lost.sql', `INSERT INTO a VALUES (1), (2);\n`);
    const fewer = write('fewer.sql', `INSERT INTO a VALUES (1);\nINSERT INTO b VALUES (1);\n`);
    const empty = write('empty.sql', `-- nothing\n`);

    check('cli: an equal candidate exits 0', cli(before, same).code, 0);
    const missing = cli(before, lost);
    check('cli: a lost table exits 1', missing.code, 1);
    check('cli: and names the table', /TABLE MISSING b/.test(missing.err), true);
    check('cli: and says nothing was written', /Nothing was written/.test(missing.err), true);
    check('cli: fewer rows exits 1', cli(before, fewer).code, 1);
    check('cli: --allow-shrink=b excuses the lost table', cli(before, lost, '--allow-shrink=b').code, 0);
    check('cli: --allow-shrink=a does not', cli(before, lost, '--allow-shrink=a').code, 1);
    check('cli: --tables-only lets fewer rows through', cli(before, fewer, '--tables-only').code, 0);
    check('cli: a baseline it can see nothing in exits 1, never 0', cli(empty, same).code, 1);
    check('cli: a missing file exits 2', cli(path.join(box, 'nope.sql'), same).code, 2);
    check('cli: a missing candidate exits 2', cli(before, path.join(box, 'nope.sql')).code, 2);
    check('cli: no arguments exits 2', cli().code, 2);
    check('cli: an unknown option exits 2', cli(before, same, '--force').code, 2);
    const unreadable = write('select.sql', `INSERT INTO a SELECT 1;\n`);
    check('cli: a shape it cannot count exits 2', cli(before, unreadable).code, 2);
  } finally {
    rmSync(box, { recursive: true, force: true });
  }

  console.log(failures ? `\n✗ ${failures} self-test failure(s)` : '\n✓ self-test passed');
  return failures === 0;
}

// 🔴 No "am I the main module?" test around this. The sibling guards have
// one so other files can import from them, and here it did exactly the
// wrong thing: `import.meta.url` is a real path and `process.argv[1]` is
// not, so under a symlinked directory (macOS /tmp is one) the two differ,
// the check reads "imported", and the guard exits 0 having compared
// nothing. Found by regenerate.selftest.sh, whose stdout assertion saw a
// pass with no output. Nothing imports this file; it always runs.
const argv = process.argv.slice(2);
process.exit(argv.includes('--self-test') ? (selfTest() ? 0 : 1) : run(argv));
