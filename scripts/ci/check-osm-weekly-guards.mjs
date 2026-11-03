#!/usr/bin/env node
// CAMP-330 / 02.11.2026 — дві властивості `osm-weekly.yml`, кожна з яких
// уже одного разу коштувала нам третини даних і цілковитої тиші.
//
// 🔴 ЧОМУ СТОРОЖ ТЕКСТОВИЙ. Поведінку GitHub Actions не відтворити на
// цьому раннері: ані `timeout-minutes`, ані `needs.*.result` тут не
// існує. Відтворюваного доказу не буде в принципі, і це стеля, а не
// лінощі. Але властивість, яку ніхто не стереже, повертається — саме так
// обидві й зʼявились.
//
// 1. КОЖЕН `curl`, ЩО ПИШЕ ФАЙЛ, МАЄ СТЕЛЮ ЧАСУ Й ВИЯВЛЕННЯ ЗУПИНКИ.
//    02.11 три найбільші країни висіли рівно 45:45 і були вбиті
//    `timeout-minutes`; останній рядок журналу — `Terminate orphan
//    process (curl)`. Завантаження `.md5` поруч мало `--max-time 60`,
//    завантаження на 4.76 ГБ — нічого.
//
// 2. `alert` МУСИТЬ БАЧИТИ `cancelled`. Завдання, вбите таймаутом, має
//    саме цей результат, а не `failure`. Умова без нього промовчала.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WORKFLOW = '.github/workflows/osm-weekly.yml';

/**
 * Рядки `curl`, що пишуть файл (`-o`), зібрані разом із продовженнями
 * через `\`: інакше прапорець на наступному рядку виглядав би відсутнім.
 */
export function downloadCommands(text) {
  const joined = text.replace(/\\\n\s*/g, ' ');
  return joined
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /\bcurl\b/.test(l) && /\s-o\s/.test(l));
}

export function faults(text) {
  const out = [];
  const downloads = downloadCommands(text);
  if (downloads.length === 0) out.push('у workflow немає жодного curl, що пише файл — сторож втратив предмет');
  for (const cmd of downloads) {
    const short = cmd.slice(0, 80);
    if (!/--max-time\s+\d+/.test(cmd)) out.push(`curl без --max-time: ${short}`);
    if (!/--speed-time\s+\d+/.test(cmd) || !/--speed-limit\s+\d+/.test(cmd)) {
      out.push(`curl без виявлення зупинки (--speed-limit і --speed-time): ${short}`);
    }
  }
  // 🔴 ТАЙМАУТ РОБОТИ НЕ МОЖЕ БУТИ МЕНШИЙ ЗА БЮДЖЕТ CURL.
  //
  // Заміряно 03.11.2026: завантаження мало `--retry 3 --max-time 1200`.
  // `--retry 3` це ЧОТИРИ спроби (перша плюс три повтори), тобто
  // 4 × 20 = 80 хвилин стелі, а `timeout-minutes` стояв 45. Останні дві
  // спроби не могли завершитись у принципі — робота вмирала раніше, ніж
  // політика повтору дограла.
  //
  // 🔴 Саме тому тут рахується, а не звіряється з числом у голові: я
  // порахував 60 і помилився, а ця функція відповіла 4800 с.
  //
  // Два запобіжники суперечили один одному, і зовнішній МОВЧКИ скасовував
  // внутрішній: у журналі це виглядало як `cancelled`, тобто як наша
  // повільність, а не як обрізаний повтор.
  //
  // Тому перевіряється не число, а СПІВВІДНОШЕННЯ: будь-хто може
  // підняти чи опустити обидва, але не може лишити стелю повторів
  // більшою за вікно, у якому вона виконується.
  const timeout = text.match(/^\s*timeout-minutes:\s*(\d+)/m);
  if (!timeout) out.push('у роботі extract немає timeout-minutes — сторож втратив предмет');
  else {
    const windowSec = Number(timeout[1]) * 60;
    for (const cmd of downloads) {
      const maxTime = Number((cmd.match(/--max-time\s+(\d+)/) ?? [])[1] ?? 0);
      const retry = Number((cmd.match(/--retry\s+(\d+)/) ?? [])[1] ?? 0);
      const budget = maxTime * (retry + 1);
      if (budget > windowSec) {
        out.push(
          `бюджет curl ${budget} с (--max-time ${maxTime} × ${retry + 1} спроб) ` +
            `більший за timeout-minutes ${timeout[1]} (${windowSec} с) — ` +
            'остання спроба не може завершитись',
        );
      }
    }
  }

  const alertIf = text.match(/^\s*if:\s*always\(\)\s*&&\s*\(?contains\(needs\.\*\.result.*$/m);
  if (!alertIf) out.push('не знайдено умову роботи alert — сторож втратив предмет');
  else if (!alertIf[0].includes("'cancelled'")) {
    out.push("умова alert не бачить 'cancelled' — завдання, вбите таймаутом, промовчить");
  }
  return out;
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const text = readFileSync(join(ROOT, WORKFLOW), 'utf8');
  const bad = faults(text);
  if (bad.length) {
    for (const b of bad) console.error(`✗ ${b}`);
    console.error(`\n✗ check-osm-weekly-guards: ${bad.length} властивостей втрачено`);
    process.exit(1);
  }
  console.log(`✓ check-osm-weekly-guards: ${downloadCommands(text).length} завантажень зі стелею й виявленням зупинки, alert бачить cancelled`);
}

const COMMAND_FLAGS = '--speed-limit 102400 --speed-time 300 --max-time 1200';

function selfTest() {
  const good = readFileSync(join(ROOT, WORKFLOW), 'utf8');
  const cases = [
    ['справжній workflow проходить', () => faults(good).length === 0],
    // 🔴 МУТУВАТИ ТРЕБА САМУ КОМАНДУ, А НЕ ПЕРШЕ ВХОДЖЕННЯ РЯДКА.
    // Перша редакція робила `replace('--max-time 1200', '')` — і влучала
    // в КОМЕНТАР над командою, де той самий прапорець названо словами.
    // Сторож лишався зеленим, бо команду ніхто не чіпав, а випадок
    // виглядав як проведений. Тому мутується послідовність, яка існує
    // лише в команді, і це перевірено: `COMMAND_FLAGS` мусить
    // зустрітися в файлі рівно один раз.
    [
      'мутація влучає в команду, а не в коментар про неї',
      () => good.split(COMMAND_FLAGS).length - 1 === 1,
    ],
    [
      '🔴 curl без --max-time — падіння',
      () =>
        faults(good.replace(COMMAND_FLAGS, '--speed-limit 102400 --speed-time 300')).some((f) =>
          f.includes('--max-time'),
        ),
    ],
    // 🔴 ЦЕЙ ВИПАДОК ІСНУЄ ТОМУ, ЩО СУПЕРЕЧНІСТЬ УЖЕ БУЛА В ДЕРЕВІ.
    //
    // 03.11.2026 `timeout-minutes` стояв 45, а бюджет curl був 60 хвилин
    // (три спроби по 20). Франція гинула на 45-й хвилині й у журналі
    // виглядала як `cancelled` — тобто як наша повільність, а не як
    // обрізаний повтор. Перевіряється співвідношення, не число.
    // 🔴 І ТУТ Я НАСТУПИВ НА ПАСТКУ, ПРО ЯКУ ПОПЕРЕДЖАЄ АБЗАЦ ВИЩЕ.
    //
    // Перша редакція цих випадків мутувала `/timeout-minutes:\s*\d+/`
    // без прив'язки до початку рядка — і влучала в КОМЕНТАР, де те саме
    // число названо словами. Оголошення лишалось 90, випадок виглядав
    // проведеним і був зеленим ні про що.
    //
    // Тому мутація прив'язана до `^\s*` з прапорцем `m`, а окремий
    // випадок нижче доводить, що таке оголошення у файлі рівно одне.
    [
      'оголошення timeout-minutes у файлі рівно одне',
      () => (good.match(/^\s*timeout-minutes:\s*\d+/gm) ?? []).length === 1,
    ],
    [
      '🔴 таймаут роботи менший за бюджет curl — падіння',
      () =>
        faults(good.replace(/^(\s*)timeout-minutes:\s*\d+/m, '$1timeout-minutes: 30')).some((f) =>
          f.includes('бюджет curl'),
        ),
    ],
    [
      'а достатній таймаут не шумить',
      () =>
        !faults(good.replace(/^(\s*)timeout-minutes:\s*\d+/m, '$1timeout-minutes: 120')).some(
          (f) => f.includes('бюджет curl'),
        ),
    ],
    [
      '🔴 timeout-minutes зник зовсім — сторож каже, що втратив предмет',
      () =>
        faults(good.replace(/^\s*timeout-minutes:\s*\d+\n/m, '')).some((f) =>
          f.includes('timeout-minutes'),
        ),
    ],
    [
      '🔴 curl без виявлення зупинки — падіння',
      () => faults(good.replace(COMMAND_FLAGS, '--max-time 1200')).some((f) => f.includes('зупинки')),
    ],
    [
      "🔴 alert без 'cancelled' — падіння",
      () =>
        faults(good.replace(/\|\| contains\(needs\.\*\.result, 'cancelled'\)\)/, ')')).some((f) =>
          f.includes('cancelled'),
        ),
    ],
    [
      '🔴 прапорець на наступному рядку через \\ видно — інакше сторож ловив би власне форматування',
      () => downloadCommands('  curl -sSL \\\n    --max-time 5 \\\n    -o x "$U"').length === 1,
    ],
    [
      'curl без -o (перевірка .md5) під правило не підпадає',
      () => downloadCommands('  EXPECT=$(curl -fsSL --max-time 60 "$URL.md5")').length === 0,
    ],
    ['порожній текст — падіння, а не тиша', () => faults('').length >= 1],
  ];
  let bad = 0;
  for (const [name, run] of cases) {
    const ok = run();
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }
  if (bad) {
    console.error(`\n✗ check-osm-weekly-guards self-test: ${bad} із ${cases.length} випадків не спрацювали`);
    process.exit(1);
  }
  console.log(`\n✓ check-osm-weekly-guards self-test: ${cases.length} cases`);
}

main();
