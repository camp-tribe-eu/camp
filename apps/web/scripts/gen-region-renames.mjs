#!/usr/bin/env node
// CAMP-289: старі адреси регіонів → нові, заморожені на час збірки.
//
// 🔴 Та сама причина, що і в `gen-gone.mjs`: middleware виконується на
// кожному запиті, і кликати звідти наш API означало б поставити бекенд
// у шлях запиту всього сайту.
//
// 🔴 І ЧОМУ ЦЕ НЕ СПИСОК СТОРІНОК. Картка рахувала 687 окремих пар
// «стара сторінка → нова», ~95 байт кожна: +65 КБ, тобто 92,7% стелі
// edge-бандла. Вісім правил на рівні регіону коштують 607 байт
// (записаних; 413 — мініфікованих) і покривають 668 побудованих
// сторінок — бо це перейменування регіону, а не 668 окремих рішень.
//
// 🔴 ЧИСЛА, ЯКІ Я СПЕРШУ ПЛУТАВ (рецензія заміряла): 762 рядки лежать
// у цих регіонах узагалі, 721 із них живі, і лише 668 мають власну
// сторінку — решта вторинні, їхня адреса веде на первинну.

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API = process.env.API_BASE_URL ?? 'http://localhost:3001';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'src', 'generated');

/**
 * 🔴 Порожньо — це збій, а не «перейменувань немає».
 *
 * Заміряно 13.10.2026: вісім пар на 721 живу сторінку. Нуль означав би,
 * що запит зламався або база порожня, а записаний порожній файл тихо
 * перетворив би 721 опубліковану адресу на 404 — рівно те, від чого ця
 * картка й існує.
 */
export function verdict(payload) {
  if (!payload || !Array.isArray(payload.renames) || !Number.isFinite(payload.regionsInUse)) {
    return { ok: false, reason: 'відповідь не тієї форми: бракує renames або regionsInUse' };
  }
  const { renames, regionsInUse } = payload;
  // 🔴 ПОРОЖНЬО БУВАЄ ЗАКОННО, і перший варіант цієї перевірки цього не
  // знав: він завалив збірку в CI, де фікстурна база не має жодного
  // регіону з помилкою. Та сама пастка, що в CAMP-301 — відрізнити «ще
  // нема чого» від «запит зламався» можна лише причиною.
  if (regionsInUse === 0) {
    return {
      ok: false,
      reason:
        'жодного регіону в ужитку. Це не «перейменувань немає» — це база, ' +
        'з якої нічого не прочиталось, і записаний із неї порожній файл ' +
        'залишив би кожну стару адресу без 301.',
    };
  }
  if (renames.length === 0) {
    return { ok: true, empty: true, regionsInUse };
  }
  const bad = renames.filter(
    (r) => !r || typeof r.country !== 'string' || !r.from || !r.to || r.from === r.to,
  );
  if (bad.length > 0) {
    return { ok: false, reason: `${bad.length} пар(и) без країни, без боку або ведуть самі в себе` };
  }
  return { ok: true };
}

async function main({ get, outDir = out } = {}) {
  const fetchIt =
    get ??
    (async () => {
      const res = await fetch(`${API}/spots/region-renames`).catch((e) => {
        throw new Error(`Could not reach the API at ${API}: ${e.message}`);
      });
      if (!res.ok) throw new Error(`GET ${API}/spots/region-renames returned ${res.status}`);
      return res.json();
    });

  const payload = await fetchIt();
  const say = verdict(payload);
  if (!say.ok) throw new Error(`region renames: ${say.reason}`);
  const { renames, regionsInUse } = payload;

  // Сторінки до файлу не їдуть: middleware рахує правила, не сторінки.
  const body = renames.map(({ country, from, to }) => ({ country, from, to }));
  const json = JSON.stringify(body, null, 2) + '\n';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'region-renames.json'), json);

  const pages = renames.reduce((n, r) => n + (r.pages ?? 0), 0);
  console.log(
    `region renames: ${body.length} rules, ${pages} page(s), ${json.length} bytes` +
      ` (${regionsInUse} regions in use)`,
  );
}

function selfTest() {
  let rc = 0;
  const cases = [];
  const check = (c, m) => { cases.push(m); if (!c) { console.error(`✗ REHEARSAL FAILED: ${m}`); rc = 1; } };
  const one = [{ country: 'dk', from: 'sja-lland', to: 'sjaelland' }];
  const at = (renames, regionsInUse = 807) => ({ renames, regionsInUse });

  check(verdict(at(one)).ok === true, 'звичайний перелік приймається');
  // 🔴 Порожньо при живій базі — законно: так виглядає фікстура CI.
  check(verdict(at([])).ok === true, '🔴 нуль правил при живих регіонах — законно');
  check(verdict(at([])).empty === true, 'і це позначено окремо, а не змовчано');
  // 🔴 А порожньо без жодного регіону — збій.
  check(verdict(at([], 0)).ok === false, '🔴 нуль регіонів у базі — збій');
  check(verdict(at(one, 0)).ok === false, 'нуль регіонів — збій навіть із правилами');
  check(verdict(null).ok === false, 'порожня відповідь — збій');
  check(verdict({ renames: one }).ok === false, 'без regionsInUse — збій: нема чим розсудити порожнечу');
  check(verdict(at([{ country: 'dk', from: 'x', to: 'x' }])).ok === false,
    '🔴 правило, що веде саме в себе, — збій: воно дало б вічний редирект');
  check(verdict(at([{ from: 'a', to: 'b' }])).ok === false, 'правило без країни — збій');
  check(verdict(at([{ country: 'dk', from: '', to: 'b' }])).ok === false, 'правило без старого боку — збій');

  const EXPECTED_CASES = 10;
  if (cases.length !== EXPECTED_CASES) { console.error(`✗ ${cases.length} cases, expected ${EXPECTED_CASES}`); rc = 1; }
  if (rc === 0) console.log(`✓ gen-region-renames self-test: ${cases.length} cases`);
  return rc;
}

const invokedDirectly = (() => {
  if (process.argv[1] === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  await main();
}
