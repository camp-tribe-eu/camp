/**
 * CAMP-469: токен, яким сервер ходить у Directus, не потрапляє в клієнтський
 * бандл. Перевірка читає ГРАФ ІМПОРТІВ, а не ім'я змінної в одному файлі:
 * достатньо, щоб клієнтський компонент транзитивно дотягнувся до
 * `lib/cms-file.ts`, і Next покладе його (разом із читанням `process.env`)
 * в браузерний чанк.
 *
 * 🔴 МУТАЦІЇ (прогнано): 1) додати `import '@/lib/cms-file'` у файл із
 * `'use client'` → червоніє «граф»; 2) перейменувати змінну в
 * `NEXT_PUBLIC_CMS_ASSET_TOKEN` → червоніє «префікс»; 3) прочитати
 * `CMS_ASSET_TOKEN` у другому файлі → червоніє «єдине місце».
 */
import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', '..', 'src');
const NAME = 'CMS_ASSET_TOKEN';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js)$/.test(p) ? [p] : [];
  });
}

const FILES = walk(SRC);
const read = (f: string) => readFileSync(f, 'utf8');

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (FILES.includes(c)) return c;
  }
  return null;
}

const importsOf = (f: string): string[] =>
  [...read(f).matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => resolveImport(f, m[1] ?? m[2] ?? m[3]))
    .filter((x): x is string => x !== null);

const isClient = (f: string) => /^\s*(['"])use client\1/m.test(read(f).slice(0, 400));

test('🔴 єдине місце, де читається токен — lib/cms-file.ts', () => {
  const holders = FILES.filter((f) => read(f).includes(NAME)).map((f) => f.slice(SRC.length + 1));
  expect(holders.filter((h) => !h.endsWith('cms-file.ts') && !h.endsWith('.md'))).toEqual([]);
  expect(holders).toContain('lib/cms-file.ts');
});

test('🔴 префікс: змінна токена не починається з NEXT_PUBLIC_', () => {
  const offenders = FILES.filter((f) => /NEXT_PUBLIC_[A-Z_]*CMS[A-Z_]*TOKEN/.test(read(f)));
  expect(offenders.map((f) => f.slice(SRC.length + 1))).toEqual([]);
});

test('🔴 граф: жоден клієнтський файл не досягає lib/cms-file.ts', () => {
  const target = join(SRC, 'lib', 'cms-file.ts');
  const clients = FILES.filter(isClient);
  // Пара: клієнтські файли існують, інакше твердження порожнє.
  expect(clients.length).toBeGreaterThan(10);
  const reaching: string[] = [];
  for (const start of clients) {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      if (f === target) {
        reaching.push(start.slice(SRC.length + 1));
        break;
      }
      stack.push(...importsOf(f));
    }
  }
  expect(reaching).toEqual([]);
  // Пара до графа: серверний споживач ДОСЯГАЄ модуля, тож обхід не сліпий.
  const route = join(SRC, 'app', 'media', 'country-banner', '[code]', 'route.ts');
  expect(importsOf(route)).toContain(target);
});
