#!/usr/bin/env node
// CAMP-289: старі адреси регіонів → нові, заморожені на час збірки.
//
// 🔴 Та сама причина, що і в `gen-gone.mjs`: middleware виконується на
// кожному запиті, і кликати звідти наш API означало б поставити бекенд
// у шлях запиту всього сайту.
//
// 🔴 І ЧОМУ ЦЕ НЕ СПИСОК СТОРІНОК. Картка рахувала 687 окремих пар
// «стара сторінка → нова», ~95 байт кожна: +65 КБ, тобто 92,7% стелі
// edge-бандла. Вісім правил на рівні регіону коштують 413 байт і
// покривають 721 сторінку — бо це перейменування регіону, а не 721
// окреме рішення.

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
export function verdict(renames) {
  if (!Array.isArray(renames)) {
    return { ok: false, reason: 'відповідь не масив' };
  }
  if (renames.length === 0) {
    return {
      ok: false,
      reason:
        'перейменувань нуль. 13.10.2026 їх було вісім на 721 сторінку; ' +
        'порожній файл означає 404 на кожній із них, а не «нічого не змінилось».',
    };
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

  const renames = await fetchIt();
  const say = verdict(renames);
  if (!say.ok) throw new Error(`region renames: ${say.reason}`);

  // Сторінки до файлу не їдуть: middleware рахує правила, не сторінки.
  const body = renames.map(({ country, from, to }) => ({ country, from, to }));
  const json = JSON.stringify(body, null, 2) + '\n';
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'region-renames.json'), json);

  const pages = renames.reduce((n, r) => n + (r.pages ?? 0), 0);
  console.log(`region renames: ${body.length} rules, ${pages} page(s), ${json.length} bytes`);
}

function selfTest() {
  let rc = 0;
  const cases = [];
  const check = (c, m) => { cases.push(m); if (!c) { console.error(`✗ REHEARSAL FAILED: ${m}`); rc = 1; } };
  const good = [{ country: 'dk', from: 'sja-lland', to: 'sjaelland' }];

  check(verdict(good).ok === true, 'звичайний перелік приймається');
  check(verdict([]).ok === false, '🔴 порожній перелік — це збій, а не «змін немає»');
  check(verdict([]).reason?.includes('721'), 'причина називає, скільки сторінок утратилось би');
  check(verdict(null).ok === false, 'не масив — збій');
  check(verdict([{ country: 'dk', from: 'x', to: 'x' }]).ok === false,
    '🔴 правило, що веде саме в себе, — збій: воно дало б вічний редирект');
  check(verdict([{ from: 'a', to: 'b' }]).ok === false, 'правило без країни — збій');
  check(verdict([{ country: 'dk', from: '', to: 'b' }]).ok === false, 'правило без старого боку — збій');

  const EXPECTED_CASES = 7;
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
