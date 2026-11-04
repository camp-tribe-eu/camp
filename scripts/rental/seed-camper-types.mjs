#!/usr/bin/env node
// CAMP-371, пункт 3 — засіяти `camper_types` і проставити тип кожній машині.
//
//   node scripts/rental/seed-camper-types.mjs --dry-run    # нічого не пише
//   node scripts/rental/seed-camper-types.mjs              # пише в DATABASE_URL
//   node scripts/rental/seed-camper-types.mjs --self-test
//
// 🔴 ЧОМУ ЦЯ СІВАЛКА ОКРЕМА ВІД `seed-providers.mjs`. Та читає файл, зібраний
// одним заміром (02.11.2026), і пише провайдерів. Тип машини — ІНШИЙ замір,
// зроблений 03.11 по 70 сторінках, і він має власну дату зрізу в кожному
// записі (`camperTypeCheckedOn`). Злити їх в одну дату означало б сказати
// читачеві, що парк і тип прочитані одночасно. Вони не були.
//
// 🔴 І ГОЛОВНЕ, ЗАРАДИ ЧОГО ТУТ ВОРОТА. CAMP-260: жорсткий фільтр лише на
// поле, заповнене більш ніж наполовину. Інакше читач, що обрав «ван»,
// не побачить 85 машин, яким тип просто ніхто не проставив, — і це буде
// не фільтр за типом, а фільтр за нашою сліпотою.
//
// Замір 03.11.2026 був 35 зі 115 = 30,4 % — ворота ЗАЧИНЕНІ. CAMP-435
// (04.11.2026) дочитала ще 32 машини зі словами самих прокатників, і
// `--dry-run` того дня сказав **67 зі 115 = 58,3 %** — ворота ВІДЧИНЕНІ.
// Сівалка каже стан вголос на кожному прогоні, і правдиве саме те, що
// вона каже, а не цей рядок. Вмикання самого фільтра — окрема картка.
//
// 🔴 ТУТ СТОЯЛО «30 зі 115 = 26,1 %», І НЕПРАВДОЮ ЦЕ ЗРОБИВ САМЕ ЦЕЙ PR:
// він додає пʼять машин McRent із доказом, тобто число в шапці застаріло
// в тому ж коміті, де було написане. Рецензія його й упіймала. Число в
// коментарі не вміє старіти вголос — на кожному прогоні вголос говорить
// рядок нижче, і правдиве саме воно.

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RENTAL = join(ROOT, "apps", "api", "src", "rental");

export const TYPES = join(RENTAL, "camper-types.seed.json");
export const SEEDS = [
  join(RENTAL, "providers.seed.json"),
  join(RENTAL, "providers-local.seed.json"),
];

/** Значення enum `LicenceClass` із `rental.entity.ts`, слово в слово. */
export const LICENCE = new Set(["B", "C1", "B_or_C1", "trailer"]);

/**
 * 🔴 ПОЛЯ, ЯКИХ ТУТ БУТИ НЕ МАЄ, І ЦЕ НЕ ЗАБУТІСТЬ.
 *
 * Довжина, висота, маса й витрата пального в `camper_types` — це твердження
 * про КАТЕГОРІЮ. Порахувати їх із наших 30 класифікованих машин можна, але
 * вийде число про НАШ КАТАЛОГ: «ван 4,9–6,4 м» означає лише «такі вани ми
 * встигли внести». Читач прочитає його як факт про вани взагалі.
 *
 * Тому сівалка відмовляється класти їх доти, доки поруч не з'явиться
 * джерело про категорію. Список може лише коротшати — кожне викреслення
 * має принести посилання.
 */
export const UNSOURCED = [
  "lengthMinM",
  "lengthMaxM",
  "heightM",
  "massT",
  "sleepsMin",
  "sleepsMax",
  "fuelEstimateL100km",
];

/** Межа з CAMP-260: нижче неї жорсткий фільтр брехав би. */
export const FILTER_THRESHOLD = 0.5;

/** Чи можна вмикати жорсткий фільтр за типом. */
export function filterIsHonest(typed, total) {
  return total > 0 && typed / total > FILTER_THRESHOLD;
}

/** Усі претензії до таксономії, або порожній масив. */
export function typeFaults(doc) {
  const out = [];
  const list = doc?.types;
  if (!Array.isArray(list) || list.length === 0) {
    return ["файл таксономії не містить жодного типу"];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc?.sourceCheckedOn ?? "")) {
    out.push("таксономія без дати зрізу — читач не дізнається, коли це читали");
  }
  const seen = new Set();
  for (const t of list) {
    const at = t?.slug ?? "(без slug)";
    if (typeof t?.slug !== "string" || !/^[a-z0-9-]+$/.test(t.slug)) {
      out.push(`${at}: slug не схожий на slug`);
    } else if (seen.has(t.slug)) {
      out.push(`${at}: slug трапляється двічі`);
    } else {
      seen.add(t.slug);
    }
    if (!LICENCE.has(t?.licenceClass))
      out.push(`${at}: licenceClass поза переліком сутності`);
    if (!Array.isArray(t?.licenceEvidence) || t.licenceEvidence.length === 0) {
      out.push(`${at}: клас прав без доказу — це найдорожча помилка новачка`);
    }
    if (!/^https:\/\//.test(t?.sourceUrl ?? ""))
      out.push(`${at}: немає джерела таксономії`);
    const en = t?.translations?.en;
    if (typeof en?.name !== "string" || en.name.trim() === "")
      out.push(`${at}: немає англійської назви`);
    if (typeof en?.description !== "string" || en.description.length < 80)
      out.push(`${at}: опис коротший за рядок таблиці — це не сторінка`);
    for (const f of UNSOURCED) {
      if (t?.[f] !== undefined) {
        out.push(
          `${at}: поле ${f} — це твердження про категорію, а в нас лише вибірка; ` +
            "або принеси джерело про категорію, або не клади",
        );
      }
    }
  }
  return out;
}

/** Усі претензії до проставлених типів, або порожній масив. */
export function assignmentFaults(providers, slugs) {
  const out = [];
  for (const p of providers) {
    for (const v of p?.vehicles ?? []) {
      const at = `${p?.slug}/${v?.slug}`;
      if (v?.camperTypeSlug === undefined) continue;
      if (!slugs.has(v.camperTypeSlug))
        out.push(`${at}: тип «${v.camperTypeSlug}» не існує в таксономії`);
      // 🔴 Тип без дослівних слів прокатника — це НАШ висновок, виданий
      // за його. Саме так народжується «у них є Hymer B-Class», якого
      // ніхто не бачив.
      if (typeof v?.camperTypeSaid !== "string" || v.camperTypeSaid.trim() === "")
        out.push(`${at}: тип без слів самого прокатника`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v?.camperTypeCheckedOn ?? ""))
        out.push(`${at}: тип без власної дати зрізу`);
    }
  }
  return out;
}

export function coverage(providers) {
  let total = 0;
  let typed = 0;
  for (const p of providers) {
    for (const v of p?.vehicles ?? []) {
      total++;
      if (v?.camperTypeSlug !== undefined) typed++;
    }
  }
  return { typed, total };
}

function load(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(raw) ? raw : (raw?.providers ?? []);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();

  const doc = JSON.parse(readFileSync(TYPES, "utf8"));
  const providers = SEEDS.flatMap(load);
  const slugs = new Set((doc?.types ?? []).map((t) => t.slug));

  const bad = [...typeFaults(doc), ...assignmentFaults(providers, slugs)];
  if (bad.length) {
    for (const b of bad) console.error(`✗ ${b}`);
    console.error(
      `\n✗ seed-camper-types: ${bad.length} біди у файлах — не записано НІЧОГО`,
    );
    process.exit(1);
  }

  const { typed, total } = coverage(providers);
  const pct = ((typed / total) * 100).toFixed(1);
  console.log(`✓ таксономія чиста: ${doc.types.length} типів`);
  console.log(`✓ тип проставлено ${typed} машинам зі ${total} = ${pct}%`);
  console.log(
    filterIsHonest(typed, total)
      ? `✓ ворота CAMP-260 ВІДЧИНЕНІ: ${pct}% > ${FILTER_THRESHOLD * 100}% — жорсткий фільтр за типом чесний`
      : `⚠ ворота CAMP-260 ЗАЧИНЕНІ: ${pct}% ≤ ${FILTER_THRESHOLD * 100}% — ` +
          `жорсткий фільтр сховав би ${total - typed} машин, яким тип ніхто не читав`,
  );

  if (argv.includes("--dry-run")) {
    console.log("сухий прогін — нічого не записано");
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("✗ DATABASE_URL не заданий");
    process.exit(1);
  }
  const { Client } = await import("pg");
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("BEGIN");
    // Тип машини посилається на таксономію, тож спершу відв'язуємо.
    await db.query(
      `UPDATE rental_provider_vehicles
          SET camper_type_id = NULL,
              camper_type_said = NULL,
              camper_type_checked_on = NULL`,
    );
    await db.query("DELETE FROM camper_type_translations");
    await db.query("DELETE FROM camper_types");
    const idBySlug = new Map();
    for (const t of doc.types) {
      const { rows } = await db.query(
        `INSERT INTO camper_types (slug, position, licence_class, status)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [t.slug, t.position, t.licenceClass, t.status],
      );
      idBySlug.set(t.slug, rows[0].id);
      for (const [lang, tr] of Object.entries(t.translations)) {
        await db.query(
          `INSERT INTO camper_type_translations
             (camper_type_id, language_code, name, alt_names, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [rows[0].id, lang, tr.name, tr.altNames ?? null, tr.description ?? null],
        );
      }
    }
    let linked = 0;
    for (const p of providers) {
      for (const v of p.vehicles ?? []) {
        if (v.camperTypeSlug === undefined) continue;
        // 🔴 Тип і доказ лягають ОДНИМ записом. Обмеження
        // `rental_provider_vehicles_type_has_evidence` не дасть покласти
        // половину — але сівалка й не намагається: половина правди на
        // сторінці виглядає як ціла.
        const { rowCount } = await db.query(
          `UPDATE rental_provider_vehicles v
              SET camper_type_id = $1,
                  camper_type_said = $4,
                  camper_type_checked_on = $5
             FROM rental_providers p
            WHERE v.provider_id = p.id AND p.slug = $2 AND v.slug = $3`,
          [
            idBySlug.get(v.camperTypeSlug),
            p.slug,
            v.slug,
            v.camperTypeSaid,
            v.camperTypeCheckedOn,
          ],
        );
        linked += rowCount;
      }
    }
    // 🔴 Звіряємо з тим, що МАЛО лягти. Різниця означає, що провайдерів
    // ще не засіяли — і мовчазний нуль тут виглядав би як успіх.
    if (linked !== typed) {
      throw new Error(
        `привʼязано ${linked} машин, а тип мають ${typed} — ` +
          "схоже, rental_provider_vehicles ще не засіяні; відкочую",
      );
    }
    await db.query("COMMIT");
    console.log(`✓ записано: ${doc.types.length} типів, ${linked} привʼязок`);
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}

function selfTest() {
  const ok = {
    sourceCheckedOn: "2026-11-03",
    types: [
      {
        slug: "van",
        position: 10,
        licenceClass: "B",
        status: "published",
        sourceUrl: "https://a.invalid/van",
        licenceEvidence: ["https://b.invalid — Category B"],
        translations: {
          en: { name: "Campervan", description: "x".repeat(90) },
        },
      },
    ],
  };
  const slugs = new Set(["van"]);
  const veh = (extra) => [
    {
      slug: "p",
      vehicles: [
        {
          slug: "v",
          camperTypeSlug: "van",
          camperTypeSaid: "Camper van",
          camperTypeCheckedOn: "2026-11-03",
          ...extra,
        },
      ],
    },
  ];
  const cases = [
    ["чистий файл проходить", () => typeFaults(ok).length === 0],
    ["справжня таксономія чиста", () =>
      typeFaults(JSON.parse(readFileSync(TYPES, "utf8"))).length === 0],
    ["справжні призначення чисті", () => {
      const doc = JSON.parse(readFileSync(TYPES, "utf8"));
      const s = new Set(doc.types.map((t) => t.slug));
      return assignmentFaults(SEEDS.flatMap(load), s).length === 0;
    }],
    ["🔴 клас прав поза переліком — відмова", () =>
      typeFaults({ ...ok, types: [{ ...ok.types[0], licenceClass: "B2" }] })
        .some((f) => f.includes("licenceClass"))],
    ["🔴 клас прав без доказу — відмова", () =>
      typeFaults({ ...ok, types: [{ ...ok.types[0], licenceEvidence: [] }] })
        .some((f) => f.includes("без доказу"))],
    ["🔴 довжина категорії без джерела — відмова", () =>
      typeFaults({ ...ok, types: [{ ...ok.types[0], lengthMaxM: "6.0" }] })
        .some((f) => f.includes("lengthMaxM"))],
    ["🔴 і будь-яке інше незасвідчене поле теж", () =>
      UNSOURCED.every((f) =>
        typeFaults({ ...ok, types: [{ ...ok.types[0], [f]: 1 }] })
          .some((m) => m.includes(f)))],
    ["таксономія без дати зрізу — відмова", () =>
      typeFaults({ ...ok, sourceCheckedOn: "03.11.2026" })
        .some((f) => f.includes("дати зрізу"))],
    ["опис завкороткий — відмова", () =>
      typeFaults({ ...ok, types: [{ ...ok.types[0], translations: { en: { name: "V", description: "коротко" } } }] })
        .some((f) => f.includes("опис"))],
    ["два однакові slug — відмова", () =>
      typeFaults({ ...ok, types: [ok.types[0], ok.types[0]] })
        .some((f) => f.includes("двічі"))],
    ["🔴 неіснуючий тип у машини — відмова", () =>
      assignmentFaults(veh({ camperTypeSlug: "spaceship" }), slugs)
        .some((f) => f.includes("не існує"))],
    ["🔴 тип без слів прокатника — відмова", () =>
      assignmentFaults(veh({ camperTypeSaid: "" }), slugs)
        .some((f) => f.includes("без слів"))],
    ["🔴 тип без власної дати зрізу — відмова", () =>
      assignmentFaults(veh({ camperTypeCheckedOn: undefined }), slugs)
        .some((f) => f.includes("дати зрізу"))],
    ["машина без типу — не біда, а порожнє поле", () =>
      assignmentFaults([{ slug: "p", vehicles: [{ slug: "v" }] }], slugs).length === 0],
    ["знаменник рахує ВСІ машини, не лише типізовані", () =>
      coverage([{ slug: "p", vehicles: [{ slug: "a", camperTypeSlug: "van" }, { slug: "b" }] }])
        .total === 2],
    // 🔴 Ворота мусять і ВІДЧИНЯТИСЬ: перевірка, що вміє лише «ні»,
    // лишиться зеленою, коли покриття виросте, і фільтр не ввімкнуть ніколи.
    ["ворота зачинені на рівно половині", () => !filterIsHonest(50, 100)],
    ["ворота відчиняються за половиною", () => filterIsHonest(51, 100)],
    ["ворота зачинені на порожньому каталозі", () => !filterIsHonest(0, 0)],
    // 🔴 ЧИСЛО ТИПІЗОВАНИХ ТУТ НЕ ПРИБИТЕ, І ЦЕ ВИПРАВЛЕННЯ МОЄЇ Ж
    // ПОМИЛКИ. Перша редакція вимагала `typed === 30`, тобто падала від
    // КОЖНОЇ нової класифікації — від роботи, заради якої картка й
    // існує. Випадок ловив момент, коли ворота ВІДЧИНЯЮТЬСЯ, — і впіймав
    // його 04.11.2026 (CAMP-435, 67 зі 115). Відтоді він тримає інший
    // бік: ворота мають ЛИШАТИСЯ відчиненими. Якщо він почервонів —
    // хтось прибрав доказ типу (покриття впало під половину), і фільтр,
    // який на це покриття спирається, знову брехав би.
    //
    // Знаменник прибитий навмисно: 115 — це розмір каталогу, і якщо він
    // змінився мовчки, то змінився не від класифікації, а від того, що
    // хтось додав або прибрав машини, і покриття треба перечитати.
    ["🔴 сьогоднішнє покриття ворота ВІДЧИНЯЄ (CAMP-435, 04.11.2026)", () => {
      const { typed, total } = coverage(SEEDS.flatMap(load));
      return total === 115 && filterIsHonest(typed, total);
    }],
  ];
  let bad = 0;
  for (const [name, run] of cases) {
    const pass = run();
    if (!pass) bad++;
    console.log(`  ${pass ? "✓" : "✗"} ${name}`);
  }
  if (bad) {
    console.error(`\n✗ seed-camper-types self-test: ${bad} із ${cases.length} випадків не спрацювали`);
    process.exit(1);
  }
  console.log(`\n✓ seed-camper-types self-test: ${cases.length} cases`);
}

// 🔴 НІЧОГО НЕ РОБИТЬ ПРИ ІМПОРТІ — цей файл видаляє й пише рядки.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
