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

/**
 * 🔴 Директива `'use client'` — це ПРОЛОГ файла: після пробілів і коментарів
 * довільної довжини, до першого оператора. Раніше дивились на перші 400
 * знаків, і клієнтський файл із довшою шапкою проходив як серверний.
 */
export function isClientSource(src: string): boolean {
  let i = 0;
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl + 1;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = end + 2;
    } else break;
  }
  return /^(['"])use client\1/.test(src.slice(i));
}

/** Усі способи підтягнути модуль: import, export from, import(), require(). */
export function importSpecs(src: string): string[] {
  const re =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...src.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
}

const importsOf = (f: string): string[] =>
  importSpecs(read(f))
    .map((spec) => resolveImport(f, spec))
    .filter((x): x is string => x !== null);

const isClient = (f: string) => isClientSource(read(f));

test('🔴 сторож бачить клієнтський файл за будь-якої довжини шапки', () => {
  const long = `/* ${'x'.repeat(2000)} */\n// ще рядок\n`;
  expect(isClientSource(`'use client';\nimport a from 'b';`)).toBe(true);
  expect(isClientSource(`${long}"use client"\nimport a from 'b';`)).toBe(true);
  // Не клієнтські: директива не в прологу, або лише згадана.
  expect(isClientSource(`import a from 'b';\n'use client';`)).toBe(false);
  expect(isClientSource(`// 'use client'\nexport const x = 1;`)).toBe(false);
  expect(isClientSource(`export const x = 'use client';`)).toBe(false);
});

test('🔴 сторож бачить усі форми підключення модуля', () => {
  const src = [
    `import a from '@/lib/one';`,
    `import '@/lib/two';`,
    `export * from '@/lib/three';`,
    `export { x } from "@/lib/four";`,
    `const m = await import('@/lib/five');`,
    `const r = require("@/lib/six");`,
  ].join('\n');
  expect(importSpecs(src)).toEqual([
    '@/lib/one',
    '@/lib/two',
    '@/lib/three',
    '@/lib/four',
    '@/lib/five',
    '@/lib/six',
  ]);
});

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
