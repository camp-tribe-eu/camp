#!/usr/bin/env node
// CAMP-330 — відхилене попередження CodeQL мусить лишатися відхиленим ЗА ТІЄЮ
// САМОЮ ПРИЧИНОЮ.
//
// 🔴 ЧОМУ ЦЬОГО НЕ ВИСТАЧАЄ В САМОМУ GITHUB. Відхилити алерт можна з
// коментарем, і коментар там лишається — але він лишається ПОРУЧ ІЗ КОДОМ,
// А НЕ В НЬОМУ. Причина кожного з шести відхилень 02.11.2026 — твердження
// про конкретний рядок: «шлях не приходить із мережі», «вміст уже
// розібрано», «origin — літерал». Рядок змінюють — твердження стає
// неправдою, а відхилення в GitHub лишається тихо чинним. Саме так дороге
// правило обходять: не відміняючи, а даючи його підставі померти.
//
// Тому кожен запис несе ЯКІР — текст, на якому тримається причина. Сторож
// вимагає, щоб якір був у файлі РІВНО ОДИН раз: нуль означає, що причину
// треба перечитати, два — що якір більше не вказує на одне місце.
//
// 🔴 ЧОГО ЦЕЙ СТОРОЖ НЕ РОБИТЬ. Він не ходить у GitHub і не звіряє, що
// алерт справді відхилений, — для цього потрібне право `security_events`,
// якого в CI немає. Він стереже ПІДСТАВУ, а не стан кнопки. Це названо, а
// не заховано.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const RECORD = join(HERE, "codeql-dismissals.json");

/** Причина, коротша за це, — не причина, а ярлик. */
const MIN_WORDS = 30;

/**
 * Кожна претензія до одного запису, або порожній масив.
 *
 * `read` передається окремо, щоб самоперевірка могла підсунути дерево, якого
 * немає на диску: сторож, який можна перевірити лише справжніми файлами,
 * перевіряється одним випадком — зеленим.
 */
export function faultsOf(d, read) {
  const faults = [];
  const at = `#${d.alert ?? "?"} ${d.path ?? "?"}:${d.line ?? "?"}`;
  if (!Number.isInteger(d.alert) || d.alert <= 0)
    faults.push(`${at}: немає номера алерта`);
  if (typeof d.rule !== "string" || !d.rule.includes("/"))
    faults.push(`${at}: немає правила CodeQL`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.measuredOn ?? ""))
    faults.push(`${at}: немає дати заміру`);

  const words =
    typeof d.why === "string" ? d.why.trim().split(/\s+/).length : 0;
  if (words < MIN_WORDS)
    faults.push(
      `${at}: причина з ${words} слів, треба щонайменше ${MIN_WORDS}`,
    );

  if (typeof d.anchor !== "string" || d.anchor.trim() === "") {
    faults.push(`${at}: немає якоря`);
    return faults;
  }

  let text;
  try {
    text = read(d.path);
  } catch {
    faults.push(`${at}: файла немає — причину треба перечитати`);
    return faults;
  }
  const hits = text.split(d.anchor).length - 1;
  if (hits === 0)
    faults.push(
      `${at}: якір зник із файлу — підстава відхилення померла, перечитай алерт`,
    );
  else if (hits > 1)
    faults.push(
      `${at}: якір трапляється ${hits} рази — він більше не вказує на одне місце`,
    );
  return faults;
}

export function check(record, read) {
  const list = record?.dismissals;
  if (!Array.isArray(list) || list.length === 0)
    return ["у записі немає жодного відхилення"];
  return list.flatMap((d) => faultsOf(d, read));
}

const readFromTree = (p) => readFileSync(join(ROOT, p), "utf8");

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const record = JSON.parse(readFileSync(RECORD, "utf8"));
  const faults = check(record, readFromTree);
  if (faults.length) {
    for (const f of faults) console.error(`✗ ${f}`);
    console.error(
      `\n✗ check-codeql-dismissals: ${faults.length} із ${record.dismissals.length} записів більше не тримаються`,
    );
    process.exit(1);
  }
  console.log(
    `✓ check-codeql-dismissals: ${record.dismissals.length} відхилень, кожне тримається на своєму рядку`,
  );
}

function selfTest() {
  const good = {
    alert: 1,
    rule: "js/example",
    path: "a.mjs",
    line: 1,
    measuredOn: "2026-11-02",
    anchor: "const safe = ONE;",
    why: "w ".repeat(MIN_WORDS).trim(),
  };
  const tree = {
    "a.mjs": "const safe = ONE;\n",
    "twice.mjs": "const safe = ONE;\nconst safe = ONE;\n",
  };
  const read = (p) => {
    if (!(p in tree)) throw new Error("ENOENT");
    return tree[p];
  };
  const cases = [
    ["цілий запис проходить", () => faultsOf(good, read).length === 0],
    [
      "якоря немає у файлі",
      () =>
        faultsOf({ ...good, anchor: "const other = TWO;" }, read).some((f) =>
          f.includes("якір зник"),
        ),
    ],
    [
      "якір трапляється двічі",
      () =>
        faultsOf({ ...good, path: "twice.mjs" }, read).some((f) =>
          f.includes("2 рази"),
        ),
    ],
    [
      "файла немає",
      () =>
        faultsOf({ ...good, path: "gone.mjs" }, read).some((f) =>
          f.includes("файла немає"),
        ),
    ],
    [
      "причина закоротка",
      () =>
        faultsOf({ ...good, why: "бо так" }, read).some((f) =>
          f.includes("слів"),
        ),
    ],
    [
      "немає якоря взагалі",
      () =>
        faultsOf({ ...good, anchor: "" }, read).some((f) =>
          f.includes("немає якоря"),
        ),
    ],
    [
      "немає номера алерта",
      () =>
        faultsOf({ ...good, alert: 0 }, read).some((f) => f.includes("номера")),
    ],
    [
      "немає правила",
      () =>
        faultsOf({ ...good, rule: "example" }, read).some((f) =>
          f.includes("правила"),
        ),
    ],
    [
      "немає дати заміру",
      () =>
        faultsOf({ ...good, measuredOn: "вчора" }, read).some((f) =>
          f.includes("дати"),
        ),
    ],
    [
      "порожній запис — падіння, а не тиша",
      () => check({ dismissals: [] }, read).length === 1,
    ],
    ["запис без масиву — падіння", () => check({}, read).length === 1],
  ];
  let bad = 0;
  for (const [name, run] of cases) {
    const ok = run();
    if (!ok) bad++;
    console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  }
  if (bad) {
    console.error(
      `\n✗ check-codeql-dismissals self-test: ${bad} із ${cases.length} випадків не спрацювали`,
    );
    process.exit(1);
  }
  console.log(`\n✓ check-codeql-dismissals self-test: ${cases.length} cases`);
}

main();
