// Which Playwright projects a command line selects.
//
// 🔴 Extracted so it can be tested, because the first version was wrong
// in the direction that fails silently.
//
// It read only `argv[i + 1]` after `--project`. But Playwright declares
// `--project <project-name...>` — variadic — so `--project unit tablet`
// selects BOTH, while the parser saw `['unit']`, concluded the run
// needed no web server, and let 177 browser tests run against nothing.
// A test that fails because there is no server is a confusing failure,
// not an obvious one.
//
// Living in a config file is what kept it untested. It does not any more.

/**
 * The project names an argv selects, in order.
 *
 * Handles `--project=a`, `--project a`, repeated flags, and the
 * variadic `--project a b c`. Consumes following arguments until the
 * next one starting with `-`, which is where Playwright's own parser
 * stops too.
 */
export function pickedProjects(argv: readonly string[]): string[] {
  const picked: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--project=')) {
      picked.push(arg.slice('--project='.length));
      continue;
    }
    if (arg !== '--project') continue;
    for (let j = i + 1; j < argv.length; j++) {
      if (argv[j].startsWith('-')) break;
      picked.push(argv[j]);
      i = j;
    }
  }
  return picked;
}

/**
 * True only when EVERY selected project is one that needs no server.
 *
 * 🔴 Deliberately conservative in one direction. Wrongly starting a
 * server costs 60 seconds; wrongly NOT starting one breaks every
 * browser test in the run for a reason that looks like a product bug.
 * So: no selection at all means "start it", and one non-serverless
 * project among ten means "start it".
 */
export function serverlessRun(
  argv: readonly string[],
  serverless: ReadonlySet<string>,
): boolean {
  const picked = pickedProjects(argv);
  return picked.length > 0 && picked.every((p) => serverless.has(p));
}
