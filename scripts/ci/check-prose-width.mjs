#!/usr/bin/env node
/**
 * ШИРИНА СТОРІНКИ НЕ ЗАДАЄТЬСЯ ЧИТАЛЬНОЮ КОЛОНКОЮ.
 *
 * 🔴 Замір 08.11.2026: `max-w-prose` (61ch ≈ 560px — колонка для ЧИТАННЯ)
 * ужито 149 разів у 54 файлах, тоді як контейнер сторінки `max-w-wrap` — лише
 * 40 разів. Тобто 79% усіх обмежень ширини в застосунку були читальною
 * колонкою. Це і є «текст не на всю ширину» з ревю власника CAMP-441…445
 * (знімки 441/42, 441/54, 441/62, 441/72).
 *
 * 🔴 Дефект ріс САМ, і це головне. У коментарі globals.css зафіксовано замір
 * 01.10.2026: 105 вживань. 08.11.2026 — 149 (замір сторожем; перші 153 були моїм grep, що рахував і коментарі в самому globals.css). Плюс 48 за пʼять тижнів, бо
 * `page-sections.tsx` роздавав `max-w-prose` кожній секції за замовчуванням.
 * Без лічильника міграція просто наздоганятиме приріст.
 *
 * Тому сторож не забороняє (заборона червоніла б 153 рази вже сьогодні), а
 * ТРИМАЄ СТЕЛЮ: число не має зростати, і кожна міграція її опускає.
 *
 * ЦІНА ХИБНОГО СПРАЦЮВАННЯ: збірка червоніє на PR, який додав ще одне
 * вживання. Виправлення — замінити на `<Block measure=…>`, і воно ж є метою.
 * Площа ураження дорівнює площі дефекту: рівно ті рядки, що його творять.
 *
 * МЕЖА, ЯКУ ТРЕБА ЗНАТИ: лічильник не бачить ширини, заданої інакше —
 * інлайновим стилем, `max-w-[61ch]`, чужим класом. Він тримає ОДИН шлях
 * приросту, найчастіший, а не всі. Нуль тут не доводить, що читальних
 * колонок не лишилось.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Сирий клас, яким задавали ширину сторінки. */
export const PROSE_CLASS = /\bmax-w-prose(?![\w-])/g;

/** Файли, де рахуємо: розмітка застосунку. */
const EXT = /\.(tsx|jsx)$/;

/**
 * 🔴 Коментарі ВИРІЗАЮТЬСЯ перед лічбою, і це не дрібниця.
 *
 * Перша редакція рахувала весь файл. Через це документування правила
 * збільшувало лічильник: я пояснив у коментарі `layout.tsx`, чому
 * `max-w-prose` більше не можна, і сторож почервонів — 150 при стелі 149.
 * Та сама помилка класу трапилась у цій картці тричі: мій перший `grep`
 * дав 153 замість 149, бо заглядав у `globals.css`, де клас оголошено.
 *
 * Інструмент, який карає за опис дефекту, підштовхує прибрати опис.
 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

export function countIn(text) {
  return (stripComments(text).match(PROSE_CLASS) ?? []).length;
}

export function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(name)) out.push(p);
  }
  return out;
}

export function budgetFrom(text) {
  const parsed = JSON.parse(text);
  const n = parsed?.maxProseWidths;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new Error(
      `бюджет не прочитано: maxProseWidths = ${JSON.stringify(n)}`,
    );
  }
  return n;
}

/**
 * 🔴 Набір доводить, що сторож ЧЕРВОНІЄ, а не просто існує. Рядок із власною
 * назвою друкується лише тоді, коли виконано рівно EXPECTED випадків і жоден
 * не впав — інакше крок CI, що його грепає, пройде на половині набору.
 */
function selfTest() {
  const EXPECTED = 6;
  const dir = mkdtempSync(join(tmpdir(), "prose-width-"));
  const write = (name, body) => writeFileSync(join(dir, name), body);
  let done = 0;
  const ok = (name, cond) => {
    if (!cond) {
      console.error(`  ✗ ${name}`);
      process.exit(1);
    }
    console.log(`  ✓ ${name}`);
    done += 1;
  };

  write("a.tsx", '<div className="max-w-prose" />');
  write("b.tsx", '<p className="mt-2 max-w-prose text-ink-2" />\n<p class="max-w-prose" />');
  write("c.tsx", '<div className="max-w-wrap" />');
  // Не .tsx — не рахується: ширину сторінки задає розмітка, не хелпери.
  write("d.ts", 'export const x = "max-w-prose";');
  // Інший клас із тим самим початком не має зараховуватись (межа слова).
  write("e.tsx", '<div className="max-w-prose-x max-w-proseish" />');

  const files = walk(dir);
  const total = files.reduce((n, f) => n + countIn(readFileSync(f, "utf8")), 0);

  ok("рахує лише розмітку: 3 вживання у .tsx, .ts не враховано", total === 3);
  ok("межа слова тримає: max-w-prose-x і max-w-proseish не зараховані",
     countIn(readFileSync(join(dir, "e.tsx"), "utf8")) === 0);
  ok("walk не бачить .ts", files.every((f) => f.endsWith(".tsx")));

  // 🔴 Через це сторож червонів на моєму ж коментарі (150 при стелі 149).
  ok(
    "коментар, що ПОЯСНЮЄ правило, не рахується як його порушення",
    countIn('// чому max-w-prose не можна\n/* і тут max-w-prose */\n<p/>') === 0,
  );

  let threw = false;
  try {
    budgetFrom('{"maxProseWidths": "сто"}');
  } catch {
    threw = true;
  }
  ok("нечислова стеля — збій, а не мовчазний нуль", threw);

  let threwMissing = false;
  try {
    budgetFrom("{}");
  } catch {
    threwMissing = true;
  }
  ok("відсутня стеля — теж збій (порожнє не читається як 0)", threwMissing);

  rmSync(dir, { recursive: true, force: true });
  if (done !== EXPECTED) {
    console.error(`::error::виконано ${done} випадків із ${EXPECTED}`);
    process.exit(1);
  }
  console.log(`check-prose-width self-test: усе гаразд (${done} випадків)`);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const root = process.argv[2] ?? "apps/web/src";
  const budgetFile = process.argv[3] ?? "scripts/ci/prose-width-budget.json";
  const budget = budgetFrom(readFileSync(budgetFile, "utf8"));

  const files = walk(root);
  const hits = [];
  let total = 0;
  for (const f of files) {
    const n = countIn(readFileSync(f, "utf8"));
    if (n > 0) {
      hits.push([relative(process.cwd(), f), n]);
      total += n;
    }
  }
  hits.sort((a, b) => b[1] - a[1]);

  const where = `${hits.length} файлів із ${files.length} переглянутих`;
  if (total > budget) {
    console.error(
      `::error::max-w-prose: ${total} вживань при стелі ${budget} (${where}). ` +
        `Ширина сторінки не задається читальною колонкою — беріть ` +
        `<Block measure="wide"|"read"|"narrow"> із components/layout.tsx. ` +
        `Якщо вживань стало менше — опустіть стелю в ${budgetFile}.`,
    );
    for (const [f, n] of hits.slice(0, 10)) console.error(`  ${n}\t${f}`);
    process.exit(1);
  }
  console.log(
    `✓ max-w-prose: ${total} вживань при стелі ${budget} (${where})`,
  );
  if (total < budget) {
    console.log(
      `  стеля відстала на ${budget - total} — опустіть її до ${total}`,
    );
  }
}

// Запускається як CLI, але функції експортує для власного набору перевірок.
// Порівняння через resolve(): argv[1] буває відносним шляхом.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
