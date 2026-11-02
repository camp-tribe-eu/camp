import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { expect, test } from '@playwright/test';

import { MAP_SOURCES } from '@/lib/map-sources';
import { RETURN_TTL_MS } from '@/lib/return-path';
import {
  API_SRC,
  WEB_SRC,
  constString,
  escapeRegExp,
  storageWrites,
  hrefsIn,
  importGraph,
  pageRoutes,
  pageText,
  paragraphs,
  readCode,
  sourceFiles,
} from './legal-claims';

/**
 * Страница «Cookies» 1.1 каже, ЩО код пише у браузер читача і що на яких
 * мапах є. Тут кожне з цих тверджень звірено з кодом, а не з літералом.
 *
 * 🔴 СТОРІНКА КАЗАЛА «THAT IS CURRENTLY THE ONLY THING» — а ключів три.
 * Тепер перелік на сторінці дорівнює переліку в коді В ОБИДВА БОКИ:
 * ключ у коді, якого сторінка не називає, і ключ на сторінці, якого код не
 * пише, червоніють однаково. Перелік у коді береться з УСІХ `.setItem(` у
 * `apps/web/src`: ключ — або літерал, або ідентифікатор, що розкривається
 * в `const … = '…'` у тому самому файлі; нерозкритий — теж падіння, бо
 * запис, якого сторож не вміє назвати, і є «забутий ключ».
 */

const webFiles = sourceFiles(WEB_SRC);
const apiFiles = sourceFiles(API_SRC);

/** Усе інше, що могло б зберігати щось у браузері читача, окрім `.setItem(`. */
function otherStores(): string[] {
  const hits: string[] = [];
  const probes: Array<[string, RegExp]> = [
    ['document.cookie =', /\bdocument\.cookie\s*=(?!=)/],
    ['next/headers cookies()', /\bcookies\(\)/],
    ['Set-Cookie', /set-cookie/i],
    ['res.cookie(', /\b(?:res|response|reply)\.cookie\(/],
    ['indexedDB', /\bindexedDB\b/],
    ['Cache API', /\bcaches\.(?:open|put)\b/],
    ['service worker', /\bserviceWorker\.register\b/],
    ['storage property write', /\b(?:localStorage|sessionStorage)\s*(?:\.\s*[A-Za-z_]\w*|\[[^\]]+\])\s*=(?!=)/],
  ];
  for (const file of [...webFiles, ...apiFiles]) {
    const code = readCode(file);
    for (const [name, re] of probes) if (re.test(code)) hits.push(`${basename(file)}: ${name}`);
  }
  return hits;
}

/**
 * Ключі, названі на сторінці: «camptribe.xxx» у видимому тексті.
 *
 * 🔴 `camptribe.eu` — не ключ, а домен із поштової адреси (`hello@camptribe.eu`):
 * перша редакція цього розбору записала його в «названі, але не написані», і
 * тест позеленів лише після того, як це було виключено словом, а не вимкнено.
 */
const namedOnPage = (): string[] => [
  ...new Set(pageText('cookies').match(/\bcamptribe\.(?!eu\b)[a-z]+\b/g) ?? []),
];

test.describe('розкриття ключа в літерал (хелпер сторожа)', () => {
  // 🔴 Окремий тест на САМ хелпер: CodeQL (#42, js/incomplete-sanitization)
  // знайшов, що ідентифікатор з кількома `$` екранувався лише раз. Сторож, який
  // не вміє прочитати ключ, червоніє НЕ ЗА ТЕ — а мутація «ключ з двома $» нижче
  // тримає саме це.
  test('🔴 ідентифікатор із кількома `$` та метасимволами знаходить своє оголошення', () => {
    const code = "const A$B$ = 'camptribe.dollars';\nconst a_b = 'camptribe.plain';\nconst NOT_A$B$ = 'camptribe.other';";
    expect(constString(code, 'A$B$')).toBe('camptribe.dollars');
    expect(constString(code, 'a_b')).toBe('camptribe.plain');
    // Ціле слово, не підрядок: `B$` не вгадує `A$B$` чи `NOT_A$B$`.
    expect(constString(code, 'B$')).toBeNull();
    expect(constString(code, 'MISSING')).toBeNull();
  });

  test('🔴 escapeRegExp екранує кожен метасимвіл і зворотну косу, не лише перший', () => {
    const all = '.*+?^${}()|[]\\';
    expect(new RegExp(`^${escapeRegExp(all + all)}$`).test(all + all)).toBe(true);
    expect(escapeRegExp('$$')).toBe('\\$\\$');
  });
});

test.describe('кукі: перелік на сторінці = перелік у коді', () => {
  test('🔴 ключ у коді, якого сторінка не називає, і ключ на сторінці, якого код не пише — обидва червоніють', () => {
    const writes = storageWrites();
    // Якір: розбір дійшов до відомих місць. Інакше дві порожні множини дорівнюють.
    expect(writes.length, 'жодного .setItem( у apps/web/src — розбір сліпий').toBeGreaterThan(0);
    const inCode = [...new Set(writes.map((w) => w.key))].sort();
    const onPage = namedOnPage().sort();
    expect(onPage.length, 'на сторінці кукі жодного ключа — розбір сліпий').toBeGreaterThan(0);

    const forgotten = inCode.filter((k) => !onPage.includes(k));
    const invented = onPage.filter((k) => !inCode.includes(k));
    expect(
      { forgottenOnPage: forgotten, namedButNotWritten: invented },
      'сторінка кукі і код розійшлись у переліку того, що лежить у браузері',
    ).toEqual({ forgottenOnPage: [], namedButNotWritten: [] });
  });

  test('🔴 кожен ключ названо в тому сховищі, куди його пише код', () => {
    const writes = storageWrites();
    expect(writes.length).toBeGreaterThan(0);
    const paras = paragraphs('cookies');
    for (const w of writes) {
      // Абзац, що ВІДКРИВАЄТЬСЯ ключем: «**Назва** — camptribe.xxx, in local storage.»
      const para = paras.find((p) => p.text.includes(w.key));
      expect(para, `сторінка не має абзацу про ${w.key}`).toBeTruthy();
      const says = (p: string) => ({
        local: /\bin local storage\b/.test(p),
        session: /\bin session storage\b/.test(p),
      });
      const claimed = says(para!.text);
      expect(
        { storage: w.storage, local: claimed.local, session: claimed.session },
        `${w.key}: код пише в ${w.storage}Storage (${w.file}), сторінка каже інакше`,
      ).toEqual({
        storage: w.storage,
        local: w.storage === 'local',
        session: w.storage === 'session',
      });
    }
  });

  test('🔴 «sets no cookies» і «nothing else»: код не ставить кукі й не користується іншими сховищами', () => {
    // Знаменник: скільки файлів прочитано. Нуль знахідок на нуль файлів — не відповідь.
    expect(webFiles.length).toBeGreaterThan(100);
    expect(apiFiles.length).toBeGreaterThan(50);
    const text = pageText('cookies');
    expect(text).toContain('the code of this site sets no cookies');
    expect(text).toContain('three entries');
    expect(text).toContain('and nothing else');
    expect(otherStores(), 'код ставить кукі чи користується сховищем, про яке сторінка мовчить').toEqual([]);
  });

  test('🔴 кількість записів, названа словом «three», дорівнює кількості ключів у коді', () => {
    const n = new Set(storageWrites().map((w) => w.key)).size;
    const WORDS: Record<number, string> = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five' };
    expect(WORDS[n], `у коді ${n} ключів; додай слово в WORDS і поправ сторінку`).toBeTruthy();
    expect(pageText('cookies')).toContain(`${WORDS[n]} entries`);
  });

  test('🔴 «fifteen minutes» — це RETURN_TTL_MS із коду', () => {
    const minutes = RETURN_TTL_MS / 60_000;
    const WORDS: Record<number, string> = { 5: 'five', 10: 'ten', 15: 'fifteen', 20: 'twenty', 30: 'thirty' };
    expect(WORDS[minutes], `RETURN_TTL_MS = ${minutes} хв; сторінка про це мовчить`).toBeTruthy();
    const para = paragraphs('cookies').find((p) => p.text.includes('camptribe.return'));
    expect(para, 'немає абзацу про camptribe.return').toBeTruthy();
    expect(para!.text).toContain(`ignored after ${WORDS[minutes]} minutes`);
  });
});

test.describe('кукі: мапа — де є кнопки стилів і хто названий провайдером', () => {
  /** Маршрути сторінок, чий граф імпортів доходить до файлу, що відповідає `pick`. */
  function routesReaching(pick: (code: string) => boolean): string[] {
    const files = new Set(webFiles.filter((f) => pick(readFileSync(f, 'utf8'))));
    return pageRoutes()
      .filter(({ file }) => [...importGraph(file)].some((f) => files.has(f)))
      .map((r) => r.route)
      .sort();
  }

  const switcher = () => routesReaching((c) => /aria-label="Map style"/.test(c));
  const anyMap = () => routesReaching((c) => /from\s+['"]maplibre-gl['"]/.test(c));

  test('🔴 сторінки з кнопками стилів — рівно ті, на які веде абзац «Only the map page»', () => {
    const withSwitcher = switcher();
    // Якорі: розбір бачить мапи й бачить хоча б один перемикач.
    expect(anyMap().length, 'жодної сторінки з мапою — розбір сліпий').toBeGreaterThan(1);
    expect(withSwitcher.length, 'жодної сторінки з перемикачем — розбір сліпий').toBeGreaterThan(0);

    const para = paragraphs('cookies').find((p) => p.text.startsWith('Only the map page has buttons'));
    expect(para, 'немає абзацу про те, де кнопки стилів').toBeTruthy();
    const linked = hrefsIn(para!.html).filter((h) => h.startsWith('/') && !h.startsWith('/legal')).sort();
    expect(linked, 'абзац веде не на ті сторінки, де код має перемикач').toEqual(withSwitcher);
  });

  test('🔴 мапи без кнопок — це сторінки кемпінгу й маршруту, і сторінка так і каже', () => {
    const without = anyMap().filter((r) => !switcher().includes(r));
    // Перший сегмент маршруту → слово, яким сторінка його називає.
    const NAME: Record<string, string> = { camping: 'campsite', routes: 'route' };
    const first = [...new Set(without.map((r) => r.split('/')[1]))].sort();
    expect(
      first.filter((s) => !NAME[s]),
      'зʼявилась сторінка з мапою без кнопок, про яку сторінка кукі не знає',
    ).toEqual([]);
    const para = paragraphs('cookies').find((p) => p.text.includes('have no such buttons'));
    expect(para, 'немає речення «have no such buttons»').toBeTruthy();
    for (const s of first) expect(para!.text, `сторінка не називає ${NAME[s]}`).toContain(NAME[s]);
  });

  test('🔴 «three styles, all from that same provider» — це MAP_SOURCES', () => {
    const providers = [...new Set(MAP_SOURCES.map((s) => s.provider))];
    expect(providers, 'провайдерів не один — «same provider» неправда').toHaveLength(1);
    const WORDS: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four' };
    expect(WORDS[MAP_SOURCES.length], `стилів ${MAP_SOURCES.length}; поправ сторінку`).toBeTruthy();
    const text = pageText('cookies');
    expect(text).toContain(`${WORDS[MAP_SOURCES.length]} styles`);
    expect(text, 'провайдер названий не так, як у MAP_SOURCES').toContain(providers[0]);
  });
});
