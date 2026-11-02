import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { resolveImport } from './import-graph';
import { seededHtml } from './legal-cms';
import { visibleText } from './rendered-text';

/**
 * Спільне для сторожів «правова сторінка каже те, що робить код»
 * (`legal-*-claims.spec.ts`, `legal-notice-pages.spec.ts`).
 *
 * 🔴 ЧОМУ ЦЕ СТОРОЖІ, А НЕ ТЕКСТОВІ ТЕСТИ. Кожна правка правових сторінок
 * 02.11.2026 була правдою в день написання й перестала б нею бути в день,
 * коли код поїде: новий ключ у сховищі, інший фільтр імпорту, нова сторінка
 * в реєстрі. Тест, що звіряє рядок сторінки з ЛІТЕРАЛОМ У САМОМУ ТЕСТІ,
 * сторожем не є: він червоніє, лише коли хтось змінив текст, а не коли
 * змінився код (так завалився PR #396). Тому кожне твердження тут береться
 * з двох боків — з ВІДРЕНДЕРЕНОЇ сторінки (`seededHtml` → `visibleText`, тим
 * самим `LegalProse`, що й справжня) і з КОДУ (файли, константи, виконання),
 * — і порівнюється. Літерал у тесті дозволений лише як ЯКІР, що доводить:
 * розбір побачив хоч щось (інакше порівняння двох порожніх множин зелене).
 *
 * 🔴 ЧОГО ЦЕ НЕ БАЧИТЬ. Текст — із міграцій (`legal-cms.ts`); правка, зроблена
 * потім у CMS, цим тестам невидима. Код — тільки репозиторій: що ставить
 * Cloudflare перед сервером, звідси не видно, і сторінка кукі каже
 * «наш код», а не «сайт».
 */

export const ROOT = resolve(__dirname, '..', '..', '..', '..');
export const WEB_SRC = join(ROOT, 'apps', 'web', 'src');
export const API_SRC = join(ROOT, 'apps', 'api', 'src');

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'migrations', 'generated']);

/** Усі `.ts`/`.tsx`, крім специфікацій і тестових тек. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.(spec|test)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Код без коментарів: рядки, шаблони й регулярки не чіпаються, `//` і
 * `/* *\/` усередині коментарів — зникають. Без цього сторож «у коді нуль
 * `document.cookie`» читав би коментарі, у яких саме про це й написано.
 *
 * Не парсер: регулярні літерали з лапкою всередині можуть збити розбір —
 * тому кожен виклик нижче має якір, який доводить, що розбір дійшов до
 * відомого місця.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      out += q;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export const readCode = (file: string): string => stripComments(readFileSync(file, 'utf8'));

/** Видимий текст документа — тим самим рендером, що й сторінка. */
export const pageText = (slug: string): string => visibleText(seededHtml(slug));

/** Абзаци `<p>` документа з видимим текстом і розміткою. */
export function paragraphs(slug: string): Array<{ html: string; text: string }> {
  return [...seededHtml(slug).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => ({
    html: m[1],
    text: visibleText(m[1]),
  }));
}

/** `<a href>` усередині шматка HTML. */
export const hrefsIn = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]);

/** Файли, до яких доходять імпорти з `entry`, враховуючи `import('…')`. */
export function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(file, 'utf8');
    // 🔴 `import('…')` теж: `map-embed.tsx` підключає мапу саме так, і
    // обходжувач `import-graph.ts` (`from|import <лапка>`) його не бачить.
    for (const m of code.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
      const next = resolveImport(WEB_SRC, file, m[1]);
      if (next) queue.push(next);
    }
  }
  return seen;
}

/** Усі `page.tsx` застосунку з маршрутом, яким їх бачить читач. */
export function pageRoutes(): Array<{ route: string; file: string }> {
  const appDir = join(WEB_SRC, 'app');
  const out: Array<{ route: string; file: string }> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name === 'page.tsx') {
        const rel = relative(appDir, dirname(p)).split('/').filter((s) => s !== '' && !/^\(.*\)$/.test(s));
        out.push({ route: '/' + rel.join('/'), file: p });
      }
    }
  };
  walk(appDir);
  return out;
}

export const exists = existsSync;
