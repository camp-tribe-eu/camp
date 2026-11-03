#!/usr/bin/env node
// CAMP-427 — засіяти каталог прокатних компаній із `providers.seed.json`.
//
//   node scripts/rental/seed-providers.mjs --dry-run   # нічого не пише
//   node scripts/rental/seed-providers.mjs             # пише в DATABASE_URL
//   node scripts/rental/seed-providers.mjs --self-test
//
// 🔴 ПЕРЕВІРКА ПЕРЕД ЗАПИСОМ, А НЕ ПІСЛЯ. Сівалка, яка пише все, що їй
// дали, перетворює помилку збирача на рядок у проді — і далі цей рядок
// порівнює чужі компанії між собою на сторінці. Тому файл спершу
// перевіряється цілком, і при першій же біді НІЧОГО не пишеться:
// половина засіяного каталогу гірша за незасіяний, бо виглядає повною.
//
// 🔴 І ОКРЕМО — ЦИФРИ РЕЙТИНГУ. Дозволу від Trustpilot немає (лист
// надіслано 02.11.2026), Places API ми не купуємо. Якщо у файлі
// трапиться `rating` чи `reviewCount` — це відмова з назвою компанії, а
// не тихе ігнорування поля. База теж не дасть їх покласти, але сівалка
// мусить сказати ЧОМУ, а не впасти на обмеженні.

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SEED = join(
  ROOT,
  "apps",
  "api",
  "src",
  "rental",
  "providers.seed.json",
);

const AVAILABILITY = new Set(["included", "extra", "unavailable"]);
const SOURCES = new Set(["trustpilot", "google"]);

/** Усі претензії до файлу, або порожній масив. */
export function faults(list) {
  const out = [];
  if (!Array.isArray(list) || list.length === 0) {
    return ["файл не містить масиву провайдерів"];
  }
  const slugs = new Set();
  for (const p of list) {
    const at = p?.slug ?? "(без slug)";
    if (typeof p?.slug !== "string" || !/^[a-z0-9-]+$/.test(p.slug)) {
      out.push(`${at}: slug не схожий на slug`);
    } else if (slugs.has(p.slug)) {
      out.push(`${at}: slug трапляється двічі`);
    } else {
      slugs.add(p.slug);
    }
    if (typeof p?.name !== "string" || p.name.trim() === "")
      out.push(`${at}: немає назви`);
    if (!/^[A-Z]{2}$/.test(p?.homeCountry ?? ""))
      out.push(`${at}: homeCountry не ISO-3166-1 alpha-2`);
    // Ворота публікації з сутності, повторені тут: сівалка не має права
    // покласти те, чого сторінка не зможе показати чесно.
    if (!/^https:\/\//.test(p?.website ?? ""))
      out.push(`${at}: website не https`);
    if (!/^https:\/\//.test(p?.sourceUrl ?? ""))
      out.push(`${at}: немає джерела фактів`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p?.sourceCheckedOn ?? ""))
      out.push(`${at}: немає дати перевірки джерела`);
    // 🔴 Сторінка без жодного абзацу — це рядок таблиці, а не сторінка:
    // читач не дізнається, ЧИМ ця компанія відрізняється від сусідньої,
    // а саме заради цього каталог і існує.
    if (
      typeof p?.intro !== "string" ||
      p.intro.trim().split(/\s+/).length < 10
    ) {
      out.push(`${at}: немає вступного абзацу (щонайменше 10 слів)`);
    }

    for (const s of p?.services ?? []) {
      if (!/^[a-z0-9_]+$/.test(s?.code ?? ""))
        out.push(`${at}: код сервісу «${s?.code}» не з словника`);
      if (!AVAILABILITY.has(s?.availability))
        out.push(`${at}/${s?.code}: availability «${s?.availability}»`);
    }
    for (const v of p?.vehicles ?? []) {
      if (!/^[a-z0-9-]+$/.test(v?.slug ?? ""))
        out.push(`${at}: slug моделі «${v?.slug}» не схожий на slug`);
      if (v?.berths != null && !(v.berths >= 1 && v.berths <= 12))
        out.push(`${at}/${v.slug}: berths поза 1–12`);
    }
    for (const r of p?.reviewProfiles ?? []) {
      if (!SOURCES.has(r?.source))
        out.push(`${at}: невідоме джерело відгуків «${r?.source}»`);
      if (!/^https:\/\//.test(r?.profileUrl ?? ""))
        out.push(`${at}: профіль відгуків не https`);
      // 🔴 Ось це — головна перевірка цього файлу.
      if (r?.rating != null || r?.reviewCount != null) {
        out.push(
          `${at}: у профілі «${r?.source}» є цифра рейтингу, а письмового дозволу показувати її немає — ` +
            "прибери поле або спершу отримай дозвіл",
        );
      }
    }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) return selfTest();

  // Файл може бути масивом або `{ _meta, providers }` — збирач віддає друге.
  const raw = JSON.parse(readFileSync(SEED, "utf8"));
  const list = Array.isArray(raw) ? raw : raw?.providers;
  const bad = faults(list);
  if (bad.length) {
    for (const b of bad) console.error(`✗ ${b}`);
    console.error(
      `\n✗ seed-providers: ${bad.length} біди у файлі — не записано НІЧОГО`,
    );
    process.exit(1);
  }
  const counts = {
    providers: list.length,
    services: list.reduce((n, p) => n + (p.services?.length ?? 0), 0),
    vehicles: list.reduce((n, p) => n + (p.vehicles?.length ?? 0), 0),
    reviewProfiles: list.reduce(
      (n, p) => n + (p.reviewProfiles?.length ?? 0),
      0,
    ),
    translations: list.length,
  };
  if (argv.includes("--dry-run")) {
    console.log(
      `✓ файл чистий: ${JSON.stringify(counts)} — сухий прогін, нічого не записано`,
    );
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("немає DATABASE_URL");
  const { Client } = await import("pg");
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("BEGIN");
    for (const p of list) {
      const r = await db.query(
        `INSERT INTO rental_providers
           (slug, name, legal_name, registration_number, home_country, website, email, phone,
            declared_depot_count, declared_fleet_size, founded_year, source_url, source_checked_on, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'published')
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, legal_name = EXCLUDED.legal_name,
           registration_number = EXCLUDED.registration_number,
           home_country = EXCLUDED.home_country, website = EXCLUDED.website,
           email = EXCLUDED.email, phone = EXCLUDED.phone,
           declared_depot_count = EXCLUDED.declared_depot_count,
           declared_fleet_size = EXCLUDED.declared_fleet_size,
           founded_year = EXCLUDED.founded_year, source_url = EXCLUDED.source_url,
           source_checked_on = EXCLUDED.source_checked_on, status = 'published'
         RETURNING id`,
        [
          p.slug,
          p.name,
          p.legalName ?? null,
          p.registrationNumber ?? null,
          p.homeCountry,
          p.website,
          p.email ?? null,
          p.phone ?? null,
          p.declaredDepotCount ?? null,
          p.declaredFleetSize ?? null,
          p.foundedYear ?? null,
          p.sourceUrl,
          p.sourceCheckedOn,
        ],
      );
      const id = r.rows[0].id;
      // Повний перезапис дочірніх рядків: інакше сервіс, який компанія
      // ПРИБРАЛА, лишався б на сторінці назавжди.
      for (const t of [
        "rental_provider_services",
        "rental_provider_vehicles",
        "rental_provider_review_profiles",
        "rental_provider_translations",
      ]) {
        await db.query(`DELETE FROM ${t} WHERE provider_id = $1`, [id]);
      }
      await db.query(
        `INSERT INTO rental_provider_translations (provider_id, language_code, intro, what_to_know)
         VALUES ($1, 'uk', $2, $3)`,
        [id, p.intro, p.whatToKnow ?? null],
      );
      for (const s of p.services ?? []) {
        await db.query(
          `INSERT INTO rental_provider_services (provider_id, code, availability, note, source_url, source_checked_on)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            s.code,
            s.availability,
            s.note ?? null,
            s.sourceUrl ?? null,
            s.sourceCheckedOn ?? null,
          ],
        );
      }
      for (const v of p.vehicles ?? []) {
        await db.query(
          `INSERT INTO rental_provider_vehicles (provider_id, name, slug, berths, belted_seats, length_cm, source_url, source_checked_on)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            v.name,
            v.slug,
            v.berths ?? null,
            v.beltedSeats ?? null,
            v.lengthCm ?? null,
            v.sourceUrl ?? null,
            v.sourceCheckedOn ?? null,
          ],
        );
      }
      for (const rp of p.reviewProfiles ?? []) {
        await db.query(
          `INSERT INTO rental_provider_review_profiles (provider_id, source, profile_url)
           VALUES ($1,$2,$3)`,
          [id, rp.source, rp.profileUrl],
        );
      }
    }
    await db.query("COMMIT");
    console.log(`✓ seed-providers: ${JSON.stringify(counts)}`);
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    await db.end();
  }
}

function selfTest() {
  const ok = {
    slug: "a-co",
    name: "A",
    homeCountry: "DE",
    website: "https://a.invalid",
    intro:
      "Компанія, про яку тут написано рівно стільки слів, скільки вимагає сторож публікації.",
    sourceUrl: "https://a.invalid/about",
    sourceCheckedOn: "2026-11-02",
    services: [{ code: "one_way", availability: "extra" }],
    vehicles: [{ name: "M", slug: "m", berths: 4 }],
    reviewProfiles: [
      { source: "trustpilot", profileUrl: "https://t.invalid/a" },
    ],
  };
  const cases = [
    ["цілий запис проходить", () => faults([ok]).length === 0],
    ["порожній файл — біда, а не тиша", () => faults([]).length === 1],
    [
      "🔴 сторінка без абзацу — відмова: це рядок таблиці, а не сторінка",
      () =>
        faults([{ ...ok, intro: "надто коротко" }]).some((f) =>
          f.includes("вступного абзацу"),
        ),
    ],
    [
      "🔴 цифра рейтингу у файлі — відмова з назвою компанії",
      () =>
        faults([
          {
            ...ok,
            reviewProfiles: [
              {
                source: "trustpilot",
                profileUrl: "https://t.invalid/a",
                rating: 4.6,
              },
            ],
          },
        ]).some((f) => f.includes("дозволу показувати")),
    ],
    [
      "🔴 кількість відгуків — так само",
      () =>
        faults([
          {
            ...ok,
            reviewProfiles: [
              {
                source: "google",
                profileUrl: "https://g.invalid/a",
                reviewCount: 10,
              },
            ],
          },
        ]).some((f) => f.includes("дозволу показувати")),
    ],
    [
      "без джерела фактів — відмова",
      () =>
        faults([{ ...ok, sourceUrl: undefined }]).some((f) =>
          f.includes("джерела"),
        ),
    ],
    [
      "без дати перевірки — відмова",
      () =>
        faults([{ ...ok, sourceCheckedOn: "02.11.2026" }]).some((f) =>
          f.includes("дати"),
        ),
    ],
    [
      "країна не alpha-2 — відмова",
      () =>
        faults([{ ...ok, homeCountry: "DEU" }]).some((f) =>
          f.includes("alpha-2"),
        ),
    ],
    [
      "сайт не https — відмова",
      () =>
        faults([{ ...ok, website: "http://a.invalid" }]).some((f) =>
          f.includes("https"),
        ),
    ],
    [
      "два однакові slug — відмова",
      () => faults([ok, ok]).some((f) => f.includes("двічі")),
    ],
    [
      "код сервісу поза словником — відмова",
      () =>
        faults([
          { ...ok, services: [{ code: "One Way", availability: "extra" }] },
        ]).some((f) => f.includes("словника")),
    ],
    [
      "невідома availability — відмова",
      () =>
        faults([
          { ...ok, services: [{ code: "one_way", availability: "maybe" }] },
        ]).some((f) => f.includes("availability")),
    ],
    [
      "berths поза 1–12 — відмова",
      () =>
        faults([
          { ...ok, vehicles: [{ name: "M", slug: "m", berths: 40 }] },
        ]).some((f) => f.includes("berths")),
    ],
  ];
  let bad = 0;
  for (const [name, run] of cases) {
    const pass = run();
    if (!pass) bad++;
    console.log(`  ${pass ? "✓" : "✗"} ${name}`);
  }
  if (bad) {
    console.error(
      `\n✗ seed-providers self-test: ${bad} із ${cases.length} випадків не спрацювали`,
    );
    process.exit(1);
  }
  console.log(`\n✓ seed-providers self-test: ${cases.length} cases`);
}

// 🔴 НІЧОГО НЕ РОБИТЬ ПРИ ІМПОРТІ. Цей файл видаляє й пише рядки; якби
// `main()` стояв на рівні модуля, тест, який імпортує `faults`, сіяв би
// базу. Сторож `check-script-entrypoints.mjs` спіймав це на мені:
// «A file that deletes rows does not get to rely on nobody importing it».
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
