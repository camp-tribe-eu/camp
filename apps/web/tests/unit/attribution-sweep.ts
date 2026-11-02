import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Суцільний обхід виробничого коду за зовнішніми хостами — другий сторож
 * сторінки атрибуції, незалежний від `SOURCE_FILES` у `attribution-sources.spec.ts`.
 *
 * 🔴 ЧОМУ ДРУГИЙ. `SOURCE_FILES` — список, написаний руками: людина читає
 * його й розуміє, звідки береться джерело (на кожен файл є «why»). Але список
 * бачить лише те, що в ньому записано. Новий файл із новим зовнішнім хостом
 * проходив зеленим — і це вже було дійсністю: `api.datatourisme.fr`,
 * `www.data.gouv.fr` стояли в коді, а сторінка їх не називала. Тут немає
 * переліку файлів: обхід іде всією текою, і те, що додали завтра, потрапляє
 * в корпус саме тому, що лежить у теці.
 *
 * Корпус — це файли на диску. Нічого з цього модуля не ділить поле з тим,
 * що він міряє: ані сторінка, ані реєстр, ані перелік винятків.
 */

/**
 * Де лежить виробничий код і дані, що з нього постачаються. Теки, не файли.
 * `apps/web/scripts` — там `security-headers.mjs`, перелік хостів, до яких
 * дозволено ходити браузеру читача (CSP). `infra` і `.github` — вузли, що
 * тягнуть дані (`osm-weekly.yml`) і ходять назовні.
 */
export const SWEEP_ROOTS: readonly string[] = [
  'apps/web/src',
  'apps/web/scripts',
  'apps/web/next.config.mjs',
  'apps/api/src',
  'apps/cms',
  'scripts',
  'infra',
  '.github',
];

/**
 * Що обхід не читає, і чому.
 *
 *  · `migrations` — там ЛЕЖИТЬ ТЕКСТ правових сторінок (його тест читає
 *    окремо, як відданий HTML). Читати його тут означало б вважати хост,
 *    названий на сторінці, «знайденим у коді» через саму сторінку.
 *  · `package-lock.json` — граф залежностей, не звернення сайту.
 *  · решта — залежності, збірка, знімки.
 */
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'migrations', '__screenshots__', 'coverage']);
const SKIP_FILES = new Set(['package-lock.json']);

/** Тести не постачають нічого читачеві: `*.spec.*`, `*.test.*`, самоперевірки скриптів. */
export const isTestFile = (name: string) => /\.(spec|test|selftest|probe)\.[a-z0-9]+$/i.test(name);

/**
 * `https://host`, `http://host` — хост закінчується там, де закінчується
 * ряд літер, цифр, крапок і дефісів; кінцева крапка речення в нього не
 * входить, порт і шлях — теж.
 *
 * 🔴 МЕЖА: лише літерали. `https://${host}`, `'https://' + sub + '.x.eu'`
 * і хост без схеми цим виразом не видно. Це названо, а не заховано.
 */
export const HOST = /https?:\/\/([a-z0-9][a-z0-9.-]*[a-z0-9])/gi;

export const normalise = (h: string) => h.toLowerCase().replace(/^www\./, '');

/**
 * Хости, яких за побудовою немає в мережі або які наші: loopback, зарезервовані
 * RFC 2606/6761 імена для прикладів і тестів, власний домен.
 */
export const isLocalOrFixture = (h: string) =>
  /^(localhost|127\.0\.0\.1)$/.test(h) ||
  /\.(example|test|invalid|localhost)$/.test(h) ||
  /(^|\.)example\.(com|org|net)$/.test(h) ||
  /(^|\.)camptribe\.eu$/.test(h);

export interface Sweep {
  /** Хост → файли (відносно кореня), де він стоїть. */
  hosts: Map<string, Set<string>>;
  /** Усі прочитані файли — знаменник обходу. */
  files: Set<string>;
}

/** Обходить `roots` відносно `root`; відсутня тека пропускається, а не падає. */
export function sweepHosts(root: string, roots: readonly string[] = SWEEP_ROOTS): Sweep {
  const hosts = new Map<string, Set<string>>();
  const files = new Set<string>();

  const scan = (abs: string) => {
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return; // двійковий файл
    const rel = relative(root, abs);
    files.add(rel);
    for (const m of buf.toString('utf8').matchAll(HOST)) {
      const host = normalise(m[1]);
      if (isLocalOrFixture(host)) continue;
      const where = hosts.get(host) ?? new Set<string>();
      where.add(rel);
      hosts.set(host, where);
    }
  };

  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
      } else if (e.isFile() && !SKIP_FILES.has(e.name) && !isTestFile(e.name)) {
        scan(join(dir, e.name));
      }
    }
  };

  for (const r of roots) {
    const abs = join(root, r);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(abs);
    else if (!isTestFile(r)) scan(abs);
  }
  return { hosts, files };
}
