#!/usr/bin/env node
// Every job that runs Node says which Node, and it is the one in `.nvmrc`.
//
//   node scripts/ci/check-node-versions.mjs
//   node scripts/ci/check-node-versions.mjs --self-test
//
// 🔴 WHY THIS EXISTS (CAMP-178). After CAMP-159 the `api` job moved to
// Node 24 — Nest 12 is ESM-only and Jest 30 can `require()` an ES module
// only on 24.9 — while `.nvmrc` and the other jobs stayed on 22. That
// divergence is fine. What is not fine is that it was SILENT: nothing
// could tell a reader whether a `node-version:` was a decision or a
// copy-paste. And it had already spread: `warning-geography.yml` ran on
// 24 for no reason anyone could point at, running two plain scripts that
// use nothing newer than Node 18.
//
// 🔴 AND WHY IT IS WRITTEN TWICE. The first version read the workflows
// with regular expressions. Adversarial review put fourteen mutations on
// the real files and NINE went green:
//
//   `  e2e:  # browser suite`   — a trailing comment after a job key made
//       the reader miss the job, so `node-version: 24` under it was
//       attributed to the PREVIOUS job and silently inherited that job's
//       exception. The run printed the Nest/Jest reason twice and exited 0.
//   `node-version: 25  # fine`  — a trailing comment after the value made
//       the line vanish from the scan entirely.
//   `${{ matrix.node }}`, `node-version-file:`, `lts/*` — all vanished.
//   A `setup-node` moved into `.github/actions/build-site/action.yml` —
//       never looked at; five jobs use it.
//   A job with NO `setup-node` at all — never noticed, and two such jobs
//       existed on the commit that added this guard, so its own summary
//       line was false the day it was written.
//
// The lesson is not "write a better regular expression". It is that a
// guard which has to understand a file format must use a parser for that
// format, and must REFUSE what it cannot understand rather than skip it.
// Anything unrecognised below is an error, never a silent pass.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { argv, exit } from 'node:process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const ACTIONS = join(ROOT, '.github/actions');

/**
 * Jobs allowed a Node other than `.nvmrc`, and why.
 *
 * The reason says what breaks without it, not what the version is.
 */
export const EXCEPTIONS = {
  'ci.yml:api': {
    version: '24',
    why:
      'Nest 12 is ESM-only and Jest 30 can require() an ES module only on ' +
      'Node >= 24.9 (CAMP-159). On 22 every spec importing @nestjs/* died ' +
      'with "Must use import to load ES Module". The API itself still runs ' +
      'on 22 in the jobs that start it.',
  },
};

/**
 * 🔴 The floor that catches a reader which quietly matches less.
 *
 * `found.length === 0` was the first version of this and it was useless:
 * the realistic failure is ten entries becoming nine, not ten becoming
 * zero, and nine printed the same cheerful summary. These numbers only
 * ever go up on purpose; lowering one is a deliberate edit that says in
 * its commit message which job went away.
 */
// 🔴 Піднято 11 → 12 разом із цією карткою: `osm-weekly.yml:extract`
// отримав свій `setup-node`, бо тепер запускає нормалізатор. Заміряно на
// дереві злиття: 18 джобів, 12 node-кроків. Не підняти означало б лишити
// підлогу на один крок нижче за дійсність — тобто мовчазне зникнення
// рівно цього кроку підлога б пропустила.
export const AT_LEAST = { jobs: 18, nodeSteps: 12, scripts: 50 };

const NODE_WORD = /(^|[\s;&|(])(node|npm|npx|yarn|pnpm)[\s]/;

/**
 * A shell line broken into the commands it actually runs.
 *
 * 🔴 WHY A SCANNER AND NOT A CLEVERER REGULAR EXPRESSION (CAMP-271).
 *
 * The first version of this matched a script path only in "command
 * position" — start of line or after a separator, optionally through an
 * interpreter. Review enumerated 27 real invocation forms and found 17
 * of them silent, including the most ordinary one there is:
 *
 *     "scripts/osm-pipeline/do.sh" "$SLUG"
 *
 * — a quoted path, which is the style of the rest of these workflows.
 * A guard written against a NEW job that fails on the most normal way
 * of writing that job is not a guard.
 *
 * So: split on separators, drop quoting, and look at every segment.
 * The only segments excluded are the ones that provably print rather
 * than run.
 */
const segments = (line) => {
  // 🔴 A CHARACTER SCANNER, BECAUSE SPLITTING ON `&&` IS WRONG INSIDE
  // QUOTES. The split version broke on the very line it was written to
  // excuse:
  //
  //     echo "    cd apps/api && npx ts-node src/x.ts"
  //
  // which became two segments, the second of them `npx ts-node …`, and
  // a printed usage note was read as a command. Quote state is the only
  // thing that tells a separator from a character inside a string, so
  // it has to be tracked rather than assumed away.
  const out = [];
  let buf = '';
  let quote = '';
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = '';
      else buf += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === ';' || c === '|' || c === '&') {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out.map((seg) => seg.trim()).filter(Boolean);
};

/**
 * Does this segment print instead of running?
 *
 * 🔴 The one exclusion, and it is narrow on purpose. It exists because
 * `osm-weekly.yml:publish` is two lines of
 *
 *     echo "node scripts/osm-pipeline/import-release.mjs --tag $TAG"
 *
 * — instructions for a human. Everything else counts: a mention we
 * cannot classify is treated as a call, because that error is loud and
 * the opposite one is silent.
 */
const isPrinting = (seg) => /^(echo|printf|cat)\b/.test(seg);

/** Strip comments, so a usage note is never read as an invocation. */
const uncomment = (text) =>
  String(text)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|\s)(#|\/\/).*$/, '$1'))
    .join('\n');

/**
 * Every command segment in a block of shell, comments and printed
 * instructions removed.
 */
const commands = (text) =>
  uncomment(text)
    .split('\n')
    .flatMap(segments)
    .filter((seg) => !isPrinting(seg));

/** Repo scripts a `run:` block invokes. */
const SCRIPT_PATH = /(?:\.\/)?scripts\/[A-Za-z0-9._\/-]+\.(?:sh|mjs|cjs|js)/g;
const scriptRefs = (run) =>
  commands(run).flatMap((seg) => seg.match(SCRIPT_PATH) ?? []);

/**
 * Does this text run Node, directly or through npm?
 *
 * The same rule is used on a `run:` block and on the body of a script
 * it calls, so "a mention is not a call" means the same thing in both
 * places. Review found it meant two different things: `run:` was
 * careful, and the script body matched a usage comment.
 */
const runsNodeText = (text) => commands(text).some((seg) => NODE_WORD.test(` ${seg} `));

/**
 * Does this step run Node — directly, through npm, or through a repo
 * script that does?
 *
 * 🔴 ONE LEVEL, AND THAT IS A LIMIT, NOT AN OVERSIGHT. A script that
 * calls another script which runs Node is NOT seen. Following further
 * needs a resolver for relative paths and `cd`, and a guard that half
 * resolves them would be the quiet kind of wrong. The limit is written
 * here so the next person reads it instead of discovering it.
 *
 * 🔴 A SCRIPT WE CANNOT READ COUNTS AS "YES". Guessing "no" is how a
 * guard goes quiet about the thing it guards; guessing "yes" at worst
 * demands a setup-node that was not strictly needed, and says so out
 * loud. Only one of those two failures is silent.
 */
function runsNode(step, scripts = {}) {
  const run = String(step?.run ?? '');
  if (runsNodeText(run)) return true;
  for (const ref of scriptRefs(run)) {
    const key = ref.replace(/^\.\//, '');
    const text = scripts[key];
    if (text === undefined) return true;
    if (runsNodeText(text)) return true;
  }
  return false;
}

function setupNodeOf(step) {
  const uses = String(step?.uses ?? '');
  if (!/^actions\/setup-node@/.test(uses)) return null;
  return step.with ?? {};
}

/**
 * Every job in every workflow, plus every composite action, flattened to
 * what this guard needs. Throws on a file it cannot parse — a workflow
 * that stops parsing must be loud.
 */
export function readJobs(files, actions = {}, scripts = {}) {
  const jobs = [];
  // A composite action can carry its own setup-node, and five of our jobs
  // reach Node through one. Reviewed mutation: moving a bad version into
  // `.github/actions/build-site/action.yml` was invisible before this.
  const actionNode = {};
  for (const [name, text] of Object.entries(actions)) {
    const doc = yaml.load(text) ?? {};
    const steps = doc?.runs?.steps ?? [];
    const found = steps.map(setupNodeOf).filter(Boolean);
    if (found.length) actionNode[name] = found;
  }

  for (const [file, text] of Object.entries(files)) {
    const doc = yaml.load(text) ?? {};
    const theJobs = doc.jobs ?? {};
    if (Object.keys(theJobs).length === 0) {
      jobs.push({ file, job: '(none)', empty: true });
      continue;
    }
    for (const [job, body] of Object.entries(theJobs)) {
      const steps = body?.steps ?? [];
      const direct = steps.map(setupNodeOf).filter(Boolean);
      const viaAction = steps.flatMap((s) => {
        const u = String(s?.uses ?? '');
        const local = u.startsWith('./.github/actions/') ? u.split('/').pop() : null;
        return local && actionNode[local] ? actionNode[local] : [];
      });
      jobs.push({
        file,
        job,
        setups: [...direct, ...viaAction],
        needsNode: steps.some((st) => runsNode(st, scripts)),
      });
    }
  }
  return jobs;
}

export function problems(nvmrc, jobs, exceptions = EXCEPTIONS, atLeast = AT_LEAST, scripts) {
  const out = [];
  // 🔴 The scripts map is EVIDENCE, and evidence that quietly becomes
  // empty is worse than no evidence: every `run:` that calls a script
  // would then be judged on the text of the call alone, which is the
  // blind spot this file was changed to close. Only checked when a map
  // is handed in, so the self-test can reason about jobs alone.
  if (scripts !== undefined && atLeast.scripts !== undefined) {
    const n = Object.keys(scripts).length;
    if (n < atLeast.scripts) {
      out.push(
        `only ${n} repo scripts were read, and at least ${atLeast.scripts} were expected — ` +
          'the reader cannot follow a `run:` into a script it never loaded, and would ' +
          'report every such job as fine',
      );
    }
  }
  const want = String(nvmrc).trim();
  if (!/^[0-9]+$/.test(want)) {
    out.push(`.nvmrc says "${nvmrc}", which is not a major version`);
    return out;
  }

  const real = jobs.filter((j) => !j.empty);
  const nodeSteps = real.reduce((n, j) => n + j.setups.length, 0);
  if (real.length < atLeast.jobs) {
    out.push(
      `only ${real.length} jobs parsed, and at least ${atLeast.jobs} were expected — ` +
        'the reader is matching less than it used to, which is the failure this ' +
        'floor exists for',
    );
  }
  if (nodeSteps < atLeast.nodeSteps) {
    out.push(
      `only ${nodeSteps} setup-node steps parsed, and at least ${atLeast.nodeSteps} ` +
        'were expected — same reason',
    );
  }
  for (const j of jobs.filter((x) => x.empty)) {
    out.push(`${j.file} parsed to no jobs at all — a workflow or a broken reader`);
  }

  const used = new Set();
  for (const j of real) {
    const key = `${j.file}:${j.job}`;

    // 🔴 A job that runs node with no setup-node takes whatever the
    // runner happens to ship. Two such jobs existed when this guard was
    // first written, and it said "every job runs Node 22" anyway.
    if (j.needsNode && j.setups.length === 0) {
      out.push(
        `${key} runs node/npm but never sets a version up — it takes whatever ` +
          "the runner ships, which nobody here chose and nobody is told when it changes",
      );
      continue;
    }

    for (const w of j.setups) {
      const file = w['node-version-file'];
      const version = w['node-version'];

      if (file !== undefined) {
        // The best form: it cannot drift from .nvmrc because it IS .nvmrc.
        if (String(file).trim() !== '.nvmrc') {
          out.push(`${key} reads its version from "${file}", not .nvmrc`);
        }
        continue;
      }
      if (version === undefined) {
        out.push(`${key} uses setup-node with neither node-version nor node-version-file`);
        continue;
      }
      const v = String(version).trim();
      // 🔴 REFUSE WHAT WE CANNOT RESOLVE. An expression or an alias is not
      // wrong — it is unreadable here, and the first version of this guard
      // skipped such lines silently, which is how `${{ matrix.node }}`
      // would have slipped a second version in unnoticed.
      if (!/^[0-9]+$/.test(v)) {
        out.push(
          `${key} asks for Node "${v}", which this guard cannot resolve to a ` +
            'major (an expression, an alias or a minor). Use a plain major or ' +
            'node-version-file: .nvmrc',
        );
        continue;
      }
      if (v === want) continue;

      const allowed = exceptions[key];
      if (!allowed) {
        out.push(
          `${key} runs Node ${v}, not ${want} from .nvmrc, and nothing says why — ` +
            'add it to EXCEPTIONS with a reason, or use node-version-file: .nvmrc',
        );
        continue;
      }
      if (allowed.version !== v) {
        out.push(`${key} is allowed Node ${allowed.version} but asks for ${v}`);
      }
      used.add(key);
    }
  }

  // 🔴 A reason that outlives its cause is worse than no reason.
  for (const key of Object.keys(exceptions)) {
    if (!used.has(key)) {
      out.push(
        `EXCEPTIONS has "${key}", but no job by that name asks for a non-default ` +
          'Node any more — delete it, or the next reader believes a stale reason',
      );
    }
  }
  return out;
}

const J = (file, job, extra = {}) => ({ file, job, setups: [], needsNode: false, ...extra });
const NV = (v) => ({ 'node-version': v });
/** Eighteen quiet jobs — the floor — so a case adds only the thing it is about. */
const filler = () => Array.from({ length: 18 }, (_, i) => J('f.yml', `j${i}`, { setups: [NV('22')] }));

const SELF_TEST = [
  ['a job on the default version passes', '22', filler(), {}, 0],
  [
    '🔴 an undeclared different version is refused',
    '22',
    [...filler(), J('a.yml', 'x', { setups: [NV('24')] })],
    {},
    1,
  ],
  [
    'a declared exception passes',
    '22',
    [...filler(), J('a.yml', 'x', { setups: [NV('24')] })],
    { 'a.yml:x': { version: '24', why: 'because' } },
    0,
  ],
  [
    '🔴 a stale exception is refused',
    '22',
    filler(),
    { 'a.yml:x': { version: '24', why: 'stale' } },
    1,
  ],
  [
    '🔴 MUTATION D2: an expression is refused, not skipped',
    '22',
    [...filler(), J('a.yml', 'x', { setups: [NV('${{ matrix.node }}')] })],
    {},
    1,
  ],
  [
    '🔴 MUTATION D2: an alias like lts/* is refused, not skipped',
    '22',
    [...filler(), J('a.yml', 'x', { setups: [NV('lts/*')] })],
    {},
    1,
  ],
  [
    '🔴 MUTATION D5: a job running node with no setup-node is refused',
    '22',
    [...filler(), J('a.yml', 'x', { needsNode: true })],
    {},
    1,
  ],
  [
    'a job that does NOT run node needs no setup-node',
    '22',
    [...filler(), J('a.yml', 'x')],
    {},
    0,
  ],
  ['node-version-file: .nvmrc passes', '22', [...filler(), J('a.yml', 'x', { setups: [{ 'node-version-file': '.nvmrc' }] })], {}, 0],
  [
    '🔴 node-version-file pointing elsewhere is refused',
    '22',
    [...filler(), J('a.yml', 'x', { setups: [{ 'node-version-file': '.other' }] })],
    {},
    1,
  ],
  [
    '🔴 MUTATION D3: losing jobs is refused, not just losing all of them',
    '22',
    filler().slice(0, 17),
    {},
    1,
  ],
  ['🔴 a file that parses to no jobs is refused', '22', [...filler(), { file: 'a.yml', job: '(none)', empty: true }], {}, 1],
];

if (argv.includes('--self-test')) {
  let failed = 0;
  for (const [what, nvmrc, jobs, exc, expected] of SELF_TEST) {
    const got = problems(nvmrc, jobs, exc, { jobs: 18, nodeSteps: 0 }).length;
    const ok = got === expected;
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} ${what} (expected ${expected}, got ${got})`);
  }

  // 🔴 And the reader, on the exact shapes that beat the regular
  // expression it replaced. Without these the cases above prove only
  // that the comparison works, on data this file invented.
  const parsed = readJobs(
    {
      'x.yml': [
        'jobs:',
        '  build:  # a trailing comment, which beat the old reader',
        '    steps:',
        '      - uses: actions/setup-node@v7',
        '        with:',
        '          node-version: 24  # and one here, which also beat it',
        '  "quoted":',
        '    steps:',
        '      - run: npm ci',
        '      - uses: ./.github/actions/build-site',
      ].join('\n'),
    },
    {
      'build-site': ['runs:', '  steps:', '    - uses: actions/setup-node@v7', '      with:', '        node-version: 22'].join('\n'),
    },
  );
  const checks = [
    [parsed.length === 2, 'two jobs found'],
    [parsed[0].job === 'build' && parsed[0].setups[0]?.['node-version'] === 24, 'a trailing comment after the job key does not hide the job'],
    [parsed[1].job === 'quoted', 'a quoted job name is read as its name'],
    [parsed[1].needsNode === true, 'a job running npm is seen to need Node'],
    [parsed[1].setups[0]?.['node-version'] === 22, 'a setup-node inside a composite action counts for the job that uses it'],
  ];
  // 🔴 CAMP-271: a job reaches Node through a shell script, and the
  // reader has to follow it. Each case below is the difference between
  // "we checked" and "we printed a ✓".
  // Блоковий скаляр, а не інлайн: інакше `run: "scripts/x.sh" "$S"` це
  // невалідний YAML, і стенд падав би на формі, яку сам перевіряє.
  const viaScript = (run, scripts) =>
    readJobs(
      {
        'w.yml': ['jobs:', '  j:', '    steps:', '      - run: |', ...String(run).split('\n').map((l) => `          ${l}`)].join(
          '\n',
        ),
      },
      {},
      scripts,
    )[0];

  const SH = 'scripts/x/do.sh';
  const MJS = 'scripts/x/tool.mjs';
  const shellRunsNode = ['#!/usr/bin/env bash', 'node "$HERE/thing.mjs" "$1"'].join('\n');
  const shellPure = ['#!/usr/bin/env bash', 'osmium cat "$1" | grep -c foo'].join('\n');
  // 🔴 A script whose only mention of node is a usage note. Review found
  // `load-context.sh` flagged for exactly this: a comment and an echo.
  const shellMentions = [
    '#!/usr/bin/env bash',
    '#   cd apps/api && npx ts-node src/x.ts   <- how a human runs it',
    'echo "    cd apps/api && npx ts-node src/x.ts"',
    'psql "$DB" -c "select 1"',
  ].join('\n');

  checks.push(
    [viaScript(`${SH} a b`, { [SH]: shellRunsNode }).needsNode === true,
      'a job calling a shell script that runs node is seen to need Node'],
    [viaScript(`${SH} a b`, { [SH]: shellPure }).needsNode === false,
      'a shell script that does NOT run node does not drag setup-node in'],
    [viaScript(`${SH} a b`, {}).needsNode === true,
      '🔴 a script we cannot read counts as Node — refusing beats guessing quietly'],
    [viaScript(`echo "node ${SH} --tag x"`, { [SH]: shellRunsNode }).needsNode === false,
      'a script MENTIONED inside an echo is printed instructions, not a call'],
    // 🔴 THE FORM REVIEW FOUND SILENT, and it is the ordinary one.
    [viaScript(`"${SH}" "$SLUG"`, { [SH]: shellRunsNode }).needsNode === true,
      'a QUOTED path is an invocation — the style the rest of these workflows use'],
    [viaScript(`bash -c '${SH} a'`, { [SH]: shellRunsNode }).needsNode === true,
      'bash -c hides nothing'],
    [viaScript(`env FOO=1 ${SH}`, { [SH]: shellRunsNode }).needsNode === true,
      'a command prefixed by env is still a call'],
    [viaScript(`xargs ${SH}`, { [SH]: shellRunsNode }).needsNode === true,
      'xargs is not a disguise'],
    // 🔴 NOT self-confirming: the script is present under the normalised
    // key and does NOT run node, so a broken `./` strip makes the lookup
    // miss, the unreadable rule fires, and this case goes red.
    [viaScript(`./${SH}`, { [SH]: shellPure }).needsNode === false,
      'a leading ./ resolves to the same key — and the lookup really happens'],
    [viaScript(`cd out && ${SH}`, { [SH]: shellRunsNode }).needsNode === true,
      'a script after && is still at command position'],
    // 🔴 .mjs/.cjs/.js were in the pattern and in nothing else: review
    // narrowed it to .sh and all cases stayed green.
    [viaScript(`node ${MJS}`, { [MJS]: 'console.log(1)' }).needsNode === true,
      'a .mjs invoked through node needs Node, obviously'],
    [viaScript(`${MJS} --flag`, { [MJS]: 'import x from "y";' }).needsNode === false,
      'a .mjs run by shebang that does not shell out to node does not need setup-node'],
    [viaScript(`${MJS} --flag`, {}).needsNode === true,
      'an unreadable .mjs counts as Node too — the extension list is live'],
    // 🔴 A mention inside the SCRIPT is not a call either. The rule has
    // to mean the same thing in both places, and review found it did not.
    [viaScript(`${SH} a`, { [SH]: shellMentions }).needsNode === false,
      'a usage comment and an echo inside a script are not invocations'],
    [viaScript(`yarn build`, {}).needsNode === true,
      'yarn still counts'],
    [viaScript(`pnpm run x`, {}).needsNode === true,
      'pnpm still counts'],
  );

  for (const [ok, what] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? '✓' : '✗'} reader: ${what}`);
  }

  console.log(
    failed
      ? `\n::error::self-test failed on ${failed} cases`
      : `\n✓ self-test passed: ${SELF_TEST.length + checks.length} cases`,
  );
  exit(failed ? 1 : 0);
}

const RUN_DIRECTLY = argv[1] && fileURLToPath(import.meta.url) === resolve(argv[1]);
if (RUN_DIRECTLY) {
  const nvmrc = readFileSync(join(ROOT, '.nvmrc'), 'utf8');
  const files = {};
  for (const name of readdirSync(WORKFLOWS)) {
    if (/\.ya?ml$/.test(name)) files[name] = readFileSync(join(WORKFLOWS, name), 'utf8');
  }
  const actions = {};
  if (existsSync(ACTIONS)) {
    for (const dir of readdirSync(ACTIONS)) {
      for (const n of ['action.yml', 'action.yaml']) {
        const p = join(ACTIONS, dir, n);
        if (existsSync(p)) actions[dir] = readFileSync(p, 'utf8');
      }
    }
  }

  // 🔴 Every repo script, so a `run:` that calls one can be followed
  // (CAMP-271). Read here and passed in, because readJobs stays a pure
  // function of its inputs — the self-test hands it invented scripts
  // rather than needing files on disk.
  // 🔴 From ROOT, not from the working directory. Review ran this from
  // `scripts/ci` and the map came back EMPTY — fifty-seven scripts
  // unread — and the guard still printed ✓, because `problems()` with
  // no scripts simply has less to object to. A source of evidence that
  // can silently become empty is the failure this whole file is about.
  const SCRIPTS = join(ROOT, 'scripts');
  const scripts = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(sh|mjs|cjs|js)$/.test(e.name)) {
        scripts[relative(ROOT, full)] = readFileSync(full, 'utf8');
      }
    }
  };
  if (existsSync(SCRIPTS)) walk(SCRIPTS);

  const jobs = readJobs(files, actions, scripts);
  const found = problems(nvmrc, jobs, EXCEPTIONS, AT_LEAST, scripts);

  const want = nvmrc.trim();
  const real = jobs.filter((j) => !j.empty);
  console.log(`  .nvmrc says Node ${want}`);
  console.log(
    `  ${real.length} jobs across ${Object.keys(files).length} workflows and ` +
      `${Object.keys(actions).length} composite action(s)`,
  );
  for (const j of real) {
    for (const w of j.setups) {
      const v = w['node-version-file'] ? `file ${w['node-version-file']}` : String(w['node-version']);
      if (v === want || w['node-version-file']) continue;
      const why = EXCEPTIONS[`${j.file}:${j.job}`]?.why;
      console.log(`  ${j.file} job "${j.job}" → Node ${v}${why ? ` — ${why.slice(0, 70)}…` : ''}`);
    }
  }

  if (found.length) {
    console.error('\n✗ Node versions are not accounted for:\n  ' + found.join('\n  '));
    exit(1);
  }
  console.log(
    `\n✓ every job that runs Node asks for ${want}, or is one of the ` +
      `${Object.keys(EXCEPTIONS).length} exception(s) listed here with a reason`,
  );
}
