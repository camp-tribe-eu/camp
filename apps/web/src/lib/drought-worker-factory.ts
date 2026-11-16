// CAMP-530 — the one place that names the worker file.
//
// 🔴 Kept apart from `drought-offthread.ts` so that file stays free of
// `import.meta` and the unit tests can load it: the bundler needs the literal
// `new Worker(new URL(…, import.meta.url))` to emit the worker as its own
// same-origin chunk, which the site's CSP (`worker-src 'self' blob:`,
// `script-src 'self'`) allows.
export const makeDroughtWorker = (): Worker =>
  new Worker(new URL('./drought-worker.ts', import.meta.url), { type: 'module' });
