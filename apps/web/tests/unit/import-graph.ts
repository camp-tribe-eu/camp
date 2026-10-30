import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// The import graph of a page, walked the way the static-page checks need it.
//
// 🔴 ONE WALKER, NOT ONE PER SPEC. `hub-screens.spec.tsx` (г) walks the hub
// pages and `report-problem.spec.tsx` walks the campsite page, both asking
// the same question: does anything this page imports read a request? Two
// private copies of the walk would drift — one would learn about `index.ts`
// files and the other would not — and a walk that silently reaches fewer
// files passes every "no offender" check over the files it never saw.
//
// `@/` and relative imports only; packages are not ours to check. Every
// caller asserts an anchor (a file it knows must be reached), because a walk
// that reached nothing proves nothing.

/** Resolve one import specifier to a `.ts`/`.tsx` file under `src`, or null. */
export function resolveImport(src: string, from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(src, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext;
    if (existsSync(p) && /\.tsx?$/.test(p)) return p;
  }
  return null;
}

/** Every `.ts`/`.tsx` file reachable from `entries` through our own imports, entries included. */
export function walkImportGraph(src: string, entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const next = resolveImport(src, file, m[1]);
      if (next) queue.push(next);
    }
  }
  return seen;
}

/**
 * The marks of a page rendered on request rather than at build time.
 *
 * `searchParams` is checked by the callers on the PAGE files only: a parser
 * that takes an object by that name is inert, and only a page reading the
 * prop makes the page dynamic (hub-screens.spec.tsx says why).
 */
export const REQUEST_READING = [/\bheaders\(\)/, /\bcookies\(\)/, /no-store/, /force-dynamic/];

/** `file: pattern` for every file in `files` that matches a REQUEST_READING mark. */
export function requestReaders(src: string, files: Iterable<string>): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const re of REQUEST_READING) {
      if (re.test(source)) offenders.push(`${file.slice(src.length + 1)}: ${re.source}`);
    }
  }
  return offenders;
}
