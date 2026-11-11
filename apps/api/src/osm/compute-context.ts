// CAMP-33: compute what is around each campsite, and store it.
//
//   cd apps/api
//   npx ts-node src/osm/compute-context.ts [--all] [--country SI]
//
// Default is incremental: a spot is recomputed only if it has no context
// yet or if it has moved since the last run. `--all` forces everything.
//
// 🔴 What this buys us. We have no photographs and, for most sites, no
// amenity tags. What we can have that nobody else publishes is the
// surroundings: a lake 98 m away, the town 2.6 km off, a railway station
// you could actually arrive at. Park4Night, Campercontact and ACSI give
// none of it. It is also the kind of specific, checkable fact an
// assistant repeats when someone asks for "a campsite by a lake near
// Bled" — which is the whole AEO argument for the project.
//
// Two sources, and the card was wrong about one of them. Distances come
// from OSM through PostGIS exactly as the card says. Elevation does not:
// OSM has no systematic heights — `ele` sits on summits, not on fields —
// so height and relief come from a DEM, via Open-Meteo's elevation
// endpoint (Copernicus, 90 m). See the note by ELEVATION_URL.

import 'dotenv/config';
import { Client } from 'pg';
import {
  classifyTerrain,
  NearestFeature,
  NearestWater,
  SpotContext,
  WaterKind,
} from './spot-context';
import { transliterate } from '../spots/transliterate';
import {
  assertCountryTagsReady,
  PARTIAL_ENV,
  CONTEXT_SQL,
  contextParams,
} from './context-sql';

const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/**
 * Open-Meteo's elevation endpoint, the same provider chosen in CAMP-91.
 *
 * Copernicus DEM at 90 m, up to 100 coordinates per request (measured —
 * 400 returns HTTP 400 with an explicit message). Elevation never
 * changes, so this runs once per campsite and the answer is stored; it is
 * not a runtime dependency and nothing on the site calls it.
 *
 * 🔴 The free tier is non-commercial (debt #14). Batch computation during
 * development is prototyping, which their terms permit in as many words;
 * the day affiliate links go live this must already be running against
 * customer-api with a key, like every other Open-Meteo call.
 */

const RELIEF_SAMPLES = 8;

const argv = process.argv.slice(2);
const FORCE_ALL = argv.includes('--all');
const COUNTRY = (() => {
  const i = argv.indexOf('--country');
  return i >= 0 && argv[i + 1] ? argv[i + 1].toUpperCase() : null;
})();

interface SpotRow {
  id: string;
  slug: string;
  lat: number;
  lon: number;
  context: SpotContext;
  water_m: number | null;
  water_kind: string | null;
  water_name: string | null;
  town_m: number | null;
  town_name: string | null;
  shop_m: number | null;
  shop_name: string | null;
  rail_m: number | null;
  rail_name: string | null;
}

/**
 * Does this context actually tell a reader anything?
 *
 * 🔴 The most dangerous line in this file, so it is a function with a
 * test rather than a condition inside a loop.
 *
 * CAMP-105 lifts `noindex` the moment `context` stops being empty — the
 * rule is literally `AND (context IS NULL OR context = '{}'::jsonb)` in
 * NOTHING_TO_SAY_SQL. `at` is not a fact about the campsite; it is a note
 * to ourselves about the coordinates we measured from, and it is written
 * on every context so the next run can tell whether the spot has moved.
 *
 * So a context of nothing but `at` is non-empty, lifts the noindex, and
 * publishes a page that still says nothing — which is exactly the
 * failure CAMP-108 exists to prevent, arriving from the other direction.
 * A campsite we could not measure stays unmeasured and stays out of the
 * index.
 */
export function saysSomething(context: SpotContext): boolean {
  return (
    context.water !== undefined ||
    context.town !== undefined ||
    context.supermarket !== undefined ||
    context.station !== undefined ||
    context.elevation !== undefined ||
    context.terrain !== undefined
  );
}

// 🔴 CAMP-295. ЄДИНЕ МІСЦЕ, ДЕ НАЗВА З OSM СТАЄ ТЕКСТОМ ДЛЯ ЧИТАЧА.
//
// Заміряно 12.10.2026 на 63 031 кемпінгу: **927 сторінок** показували
// назву найближчого міста не латиницею — 284 кирилицею (BG 270, PL 7,
// RO 5, GR 2) і 643 грецькою. На англійській сторінці польського
// кемпінгу стояло «the nearest town is Крылово».
//
// Транслітератор існував увесь цей час (`spots/transliterate.ts`:
// болгарський Закон 2009, грецький ELOT 743), але його імпортував лише
// `canonical.ts` — тобто він працював на слаги й не працював на те, що
// читає людина.
//
// 🔴 Це НЕ переклад: `Сапарева баня` → `Sapareva Banya` за законом, а
// не «Sapareva bath». Таблиці вже доведені самотестами, тут їх лише
// застосовано. Назви, що вже латиницею, `transliterate` не чіпає.
// 🔴 CAMP-295. `transliterate` ПИСАЛАСЬ ДЛЯ СЛАГІВ, НЕ ДЛЯ ТЕКСТУ.
//
// Заміряно 12.10.2026, перш ніж покластись на неї:
//
//     Сапарева баня → sapareva banya   ← усе малими
//     Крылово       → krыlovo          ← `ы` не в таблиці: вона болгарська
//     Αστερίας      → asterias         ← правильно, але теж малими
//
// Для слага це рівно те, що треба. Для речення «the nearest town is …»
// це зіпсована назва. Тому тут окрема функція, і вона робить дві речі,
// яких слагова не робить:
//
// 1. Повертає регістр: слово, що починалось з великої, лишається з
//    великої. Регістр решти літер слагова функція вже з'їла, і
//    відновити його нізвідки — але перша літера покриває всі назви
//    міст, які ми бачили.
//
// 2. 🔴 Якщо після транслітерації лишилась НЕ-латиниця — назву не
//    показуємо взагалі. Краще «the nearest town is 13 km away» без
//    назви, ніж `krыlovo` у тексті. Таке бувало на даних поза ЄС-27
//    (російські назви з прикордонного запасу екстрактів Geofabrik).
//    CAMP-296 прибрав причину для міста, магазину й станції: вони тепер
//    шукаються лише всередині ЄС-27 (context-sql.ts). Ця перевірка лишається
//    як страховка і тому, що ВОДУ за ЄС-27 ми не фільтруємо навмисно —
//    озеро за кордоном лишається найближчим озером.
// 🔴 «Чи лишилась НЕ-ЛАТИНСЬКА ЛІТЕРА», а не «чи всі символи в діапазоні».
//
// Перша редакція була `[^\u0000-ɏḀ-ỿ]`, і рецензія
// заміряла, що вона відкидає 250 бездоганних назв через звичайну
// типографіку: тире `–` (99 рядків), апостроф `’` (92), вузький
// нерозривний пробіл (28), лапки `„ “ ”`, три крапки. Гинули
// `Watten – Éperlecques`, `L’Oise`, `tegut…`, `Niardo ‐ Losine`.
// Тобто PR лагодив 1 038 сторінок і ламав 269 — з них 250 були справні.
//
// Подвійне заперечення читається так: символ, який НЕ латинського
// письма і НЕ «не-літера» — тобто літера іншого письма. Пунктуація,
// цифри й пробіли під нього не підпадають за побудовою.
const NON_LATIN_LETTER = /[^\p{Script=Latin}\P{L}]/u;

// Двомовні назви в прикордонних регіонах пишуть через скісну:
// `Riču ezers / возера Рычы` (LV), `Vištyčio ež. / Виштынецкое озеро`
// (LT). Відкидати їх цілком — втрачати готову латинську половину.
function latinParts(text: string): string | null {
  const parts = text
    .split('/')
    .map((x) => x.trim())
    .filter((x) => x && !NON_LATIN_LETTER.test(x));
  return parts.length ? parts.join(' / ') : null;
}

// Регістр повертається ПО РУНАХ ЛІТЕР, а не по словах.
//
// Перша редакція різала по пробілах і дефісах, і рецензія заміряла
// 176 рядків, де велика літера після крапки чи дужки гинула:
// `яз.Кърджали` → `yaz.kardzhali`, `Д'Артанян` → `D'artanyan`.
// Транслітерація не зливає й не розриває руни через не-літери, тож їх
// можна зіставити один в один.
function restoreCase(raw: string, lowered: string): string {
  const rawRuns = raw.match(/\p{L}+/gu) ?? [];
  let i = 0;
  return lowered.replace(/\p{L}+/gu, (run) => {
    const source = rawRuns[i++];
    return source && /^\p{Lu}/u.test(source)
      ? run[0].toUpperCase() + run.slice(1)
      : run;
  });
}

export function displayName(raw: string | null): string | null {
  if (!raw) return null;
  const out = restoreCase(raw, transliterate(raw));
  if (!NON_LATIN_LETTER.test(out)) return out;
  return latinParts(out);
}

export const feature = (
  m: number | null,
  name: string | null,
): NearestFeature | undefined =>
  m === null
    ? undefined
    : {
        m: Number(m),
        ...(displayName(name) ? { name: displayName(name) } : {}),
      };

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  for (const table of ['osm_ctx_water', 'osm_ctx_place', 'osm_ctx_poi']) {
    const { rows } = await db.query(
      `SELECT to_regclass($1) IS NOT NULL AS ok`,
      [`public.${table}`],
    );
    if (!rows[0]?.ok) {
      throw new Error(
        `Table ${table} is missing.\n` +
          'Run: ./scripts/osm-pipeline/load-context.sh <region>',
      );
    }
  }

  // CAMP-296: без проставленої країни фільтр ЄС-27 не помиляється — він
  // прибирає все, тож шари без неї (або з неповною) зупиняємо тут.
  await assertCountryTagsReady(db, {
    // Прапорець ставить людина, що запустила часткове завантаження;
    // з даних його не вгадати. Див. PARTIAL_ENV у context-sql.ts.
    partial: process.env[PARTIAL_ENV] === '1',
  });

  const { rows } = await db.query<SpotRow>(
    CONTEXT_SQL,
    contextParams(COUNTRY) as unknown[],
  );

  // A spot is skipped when its stored context was computed at the same
  // coordinates. Recomputing 300 unchanged rows would be free locally and
  // 50,000 API calls across Europe.
  const todo = rows.filter((r) => {
    if (FORCE_ALL) return true;
    const at = r.context?.at;
    if (!at) return true;
    // Anything the DEM owes us and did not deliver is retried next run.
    // Checking only `elevation` was not enough: a failed ring batch left
    // the height in place and quietly dropped the terrain, and the spot
    // then looked complete for ever.
    if (
      r.context?.elevation === undefined ||
      r.context?.terrain === undefined
    ) {
      return true;
    }
    return (
      Math.abs(at.lat - Number(r.lat)) > 1e-5 ||
      Math.abs(at.lon - Number(r.lon)) > 1e-5
    );
  });

  console.log(
    `\nCAMP-33 context — ${rows.length} spots, ${todo.length} to compute\n`,
  );
  if (todo.length === 0) {
    console.log('  nothing moved since the last run\n');
    await db.end();
    return;
  }

  // 🔴 THE WORK IS SLICED, AND EACH SLICE IS WRITTEN BEFORE THE NEXT ONE
  // IS FETCHED. This is the difference between a job that finishes and a
  // job that can never finish.
  //
  // The first version fetched every elevation and every ring point for
  // the whole country, and only then opened a transaction and wrote. On
  // a small country that is fine. On a large one it cannot work at all:
  // Open-Meteo's free tier counts each COORDINATE, 10 000 a day, and a
  // campsite costs nine of them (one centre plus eight ring samples). So
  //
  //   France      8 752 spots × 9 = 78 768 coordinates ≈ 8 days of quota
  //
  // and DailyLimitReached was thrown out of the fetch phase — before the
  // write phase existed — so the run wrote NOTHING and the next run
  // started from exactly the same place. Not slow: stuck, for ever.
  //
  // Measured 24.09.2026, and it was already biting a country whose
  // layers are loaded: Slovenia 282 of 282 computed, Croatia 6 of 777,
  // France 0 of 8 752. Croatia is not a layer problem — it is this.
  //
  // A slice is 200 spots = 1 800 coordinates, comfortably inside a day's
  // quota, and every slice that succeeds is committed and never fetched
  // again.
  const SLICE = 200;

  let written = 0;
  let noWater = 0;
  let noStation = 0;
  /** Rows that would have been written with nothing but their own coordinates. */
  let nothingToSay = 0;
  /** Heights kept from the previous run because the DEM had nothing new. */
  let carriedForward = 0;
  const reliefs: number[] = [];

  for (let start = 0; start < todo.length; start += SLICE) {
    const slice = todo.slice(start, start + SLICE);

    // Висота й рельєф тут навмисно порожні — див. нижче.
    const centreEle: (number | null)[] = slice.map(() => null);
    const ringEle: (number | null)[] = slice.flatMap(() =>
      Array(RELIEF_SAMPLES).fill(null),
    );
    // 🔴 CAMP-484: ВИСОТУ ТУТ БІЛЬШЕ НЕ РАХУЮТЬ, І ЦЕ НЕ ВТРАТА.
    //
    // Тут стояли два запити до `api.open-meteo.com/v1/elevation` — по
    // одному на центр і на кільце рельєфу. Дві причини прибрати:
    //
    // 1. ПРАВО. Безкоштовний тариф Open-Meteo некомерційний дослівно:
    //    «You may only use the free API services for non-commercial
    //    purposes». Обовʼязок вмикається першим афіліатним посиланням,
    //    а не датою, — тобто код мусив змінитись ДО монетизації, не
    //    після.
    //
    // 2. ЧИСЛА. Квота давала ~1 100 висот на добу. Заміряно 10.11.2026:
    //    висоту мали 1 289 кемпінгів із 63 307 — два відсотки. Решту
    //    цей шлях заповнював би 56 днів.
    //
    // Ті самі дані — Copernicus GLO-90 — лежать у відрі `openmeteo` під
    // CC-BY-4.0 і читаються локально. `scripts/elevation/` рахує всі
    // 62 018 за чверть години; 10.11.2026 покриття стало 63 307 зі
    // 63 307, мінімум −6 м (польдери), максимум 3 384 м (Альпи).
    //
    // Тому цей скрипт лишає за собою те, що бере з PostGIS і що коштує
    // нуль: вода, місто, крамниця, станція. Висота й рельєф приходять
    // окремим кроком і не залежать від чужої квоти.

    await writeSlice(slice, centreEle, ringEle);
  }

  async function writeSlice(
    part: SpotRow[],
    centreEle: (number | null)[],
    ringEle: (number | null)[],
  ): Promise<void> {
    await db.query('BEGIN');
    try {
      for (let i = 0; i < part.length; i++) {
        const r = part[i];
        const elevation = centreEle[i];
        const ringHeights = ringEle
          .slice(i * RELIEF_SAMPLES, (i + 1) * RELIEF_SAMPLES)
          .filter((v): v is number => v !== null);

        const context: SpotContext = {
          at: { lat: Number(r.lat), lon: Number(r.lon) },
        };

        if (r.water_m !== null) {
          context.water = {
            m: Number(r.water_m),
            kind: (r.water_kind ?? 'river') as WaterKind,
            // та сама транслітерація, що й у `feature` — CAMP-295
            ...(displayName(r.water_name)
              ? { name: displayName(r.water_name) }
              : {}),
          } as NearestWater;
        } else noWater++;

        const town = feature(r.town_m, r.town_name);
        if (town) context.town = town;
        const shop = feature(r.shop_m, r.shop_name);
        if (shop) context.supermarket = shop;
        const rail = feature(r.rail_m, r.rail_name);
        if (rail) context.station = rail;
        else noStation++;

        if (elevation !== null) context.elevation = Math.round(elevation);
        if (elevation !== null && ringHeights.length >= RELIEF_SAMPLES / 2) {
          const all = [elevation, ...ringHeights];
          const relief = Math.round(Math.max(...all) - Math.min(...all));
          reliefs.push(relief);
          context.terrain = { relief, type: classifyTerrain(relief) };
        }

        // 🔴 THE DEM SAYING NOTHING IS NOT THE DEM SAYING "NO HEIGHT".
        //
        // This write replaces the whole context (`SET context = $2`), so
        // a field left out is a field deleted. On the quota path every
        // elevation is null — and the first version of the slicing change
        // therefore ERASED heights that had already been computed and
        // paid for, on the current slice and on every remaining spot.
        //
        // Measured by review, on real data: a run with the day's quota
        // already spent took 536 Croatian spots from 536 elevations and
        // 536 terrains to ZERO, in one pass, exiting 0. The change
        // written to conserve Open-Meteo quota was destroying what the
        // quota had bought, and tomorrow's run would buy it again.
        //
        // Elevation does not move. If the stored context was measured at
        // the same coordinates we are looking at now, it is still true,
        // and silence from the DEM is no reason to throw it away. The
        // retry filter above keeps asking for the spots that genuinely
        // have none, because `elevation === undefined` is still the test.
        const previous = r.context;
        const sameSpot =
          previous?.at !== undefined &&
          Math.abs(previous.at.lat - Number(r.lat)) <= 1e-5 &&
          Math.abs(previous.at.lon - Number(r.lon)) <= 1e-5;
        if (sameSpot) {
          if (
            context.elevation === undefined &&
            previous.elevation !== undefined
          ) {
            context.elevation = previous.elevation;
            carriedForward++;
          }
          if (context.terrain === undefined && previous.terrain !== undefined) {
            context.terrain = previous.terrain;
          }
        }

        if (!saysSomething(context)) {
          nothingToSay++;
          continue;
        }

        await db.query(
          `UPDATE camping_spots
            SET context = $2, context_computed_at = now()
          WHERE id = $1`,
          [r.id, JSON.stringify(context)],
        );
        written++;
      }
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }

  // 🔴 Counted over the SAME set the run was asked about.
  //
  // This query had no country filter while `total` below is the count for
  // `--country`, so a country run divided every country's rows by one
  // country's total. Observed on the Croatian run: "station 1060 / 777
  // 136.4%" — a percentage over one hundred, printed without complaint,
  // on a report whose job is to decide whether coverage is good enough.
  // The 90% gate was reading the same broken ratio, so it would have
  // passed a country with almost nothing computed as long as its
  // neighbours were full.
  const filled = await db.query<{ field: string; n: string }>(
    `SELECT f.field, count(*) AS n
       FROM camping_spots s,
            LATERAL (VALUES ('water'),('town'),('supermarket'),
                            ('station'),('elevation'),('terrain')) AS f(field)
      WHERE s.missing_since IS NULL
        AND ($1::text IS NULL OR upper(s.country) = $1)
        AND s.context ? f.field
      GROUP BY 1 ORDER BY 1`,
    [COUNTRY],
  );
  const total = rows.length;

  // 🔴 A fixed list of fields, not whatever the query returned.
  //
  // `GROUP BY` omits a field with zero rows entirely, and both the table
  // below and the 90% gate used to iterate `filled.rows`. So a country
  // where the DEM produced nothing for anybody had no `elevation` row at
  // all — and a missing row cannot be below 90%, so the gate passed and
  // the field was not even printed.
  //
  // Measured by review: on the same database, with the DEM answering
  // only nulls, this branch printed four fields at 100% and a ✓, while
  // the version on main — the one with the >100% bug this change is
  // fixing — still failed with "elevation 6.5%, terrain 6.5%". The
  // country filter was right; iterating the result rows was the
  // regression that came with it.
  const FIELDS = [
    'water',
    'town',
    'supermarket',
    'station',
    'elevation',
    'terrain',
  ] as const;
  const counts = new Map<string, number>(
    filled.rows.map((f) => [f.field, Number(f.n)] as [string, number]),
  );
  const coverage = FIELDS.map((field) => ({
    field,
    n: counts.get(field) ?? 0,
  }));

  console.log(`  written            ${written}`);
  console.log(`  ─────────────────────────`);
  for (const f of coverage) {
    const pct = total > 0 ? (f.n / total) * 100 : 0;
    const flag = pct >= 90 ? ' ' : '🔴';
    console.log(
      `  ${flag} ${f.field.padEnd(12)} ${String(f.n).padStart(4)} / ${total}  ${pct.toFixed(1)}%`,
    );
  }
  if (reliefs.length) {
    reliefs.sort((a, b) => a - b);
    const q = (p: number) => reliefs[Math.floor(reliefs.length * p)];
    console.log(
      `\n  relief quartiles   ${q(0.25)} / ${q(0.5)} / ${q(0.75)} m  (min ${reliefs[0]}, max ${reliefs[reliefs.length - 1]})`,
    );
  }
  if (noWater) console.log(`  without water      ${noWater}`);
  if (noStation) console.log(`  without station    ${noStation}`);
  if (nothingToSay) {
    console.log(
      `  nothing to say     ${nothingToSay}  (left noindex — see CAMP-105)`,
    );
  }
  if (carriedForward) {
    console.log(
      `  height kept        ${carriedForward}  (DEM silent, coordinates unchanged)`,
    );
  }

  // The card's own bar: "fields filled for >90% of a country's records".
  // Exiting non-zero makes that a gate rather than a number somebody
  // reads once — a partial DEM run is exactly the failure that otherwise
  // ships looking fine.
  const worst = coverage.reduce(
    (min, f) => Math.min(min, total > 0 ? f.n / total : 0),
    1,
  );
  if (worst < 0.9) {
    const weakest = coverage.filter((f) => (total > 0 ? f.n / total : 0) < 0.9);
    console.error(
      `\n✗ below the 90% bar: ` +
        weakest
          .map((f) => `${f.field} ${((f.n / total) * 100).toFixed(1)}%`)
          .join(', ') +
        '\n',
    );
    await db.end();
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n✓ every field above 90% (worst ${(worst * 100).toFixed(1)}%)\n`,
  );
  await db.end();
}

if (require.main === module) {
  main().catch((err) => {
    // 🔴 CAMP-484: гілки про вичерпану квоту тут більше немає, бо немає
    // квоти. Висоту рахує `scripts/elevation/` з локального дзеркала
    // Copernicus; чужого ліміту, який треба «перечекати», не існує.
    console.error(err);
    // 🔴 Exit, rather than only setting exitCode.
    //
    // On this path the Postgres client is still open, its socket keeps
    // the event loop alive, and the process hangs for ever having
    // already printed the failure. For a weekly unattended job that is
    // the worst shape of failure: the reason is reported and the run
    // never ends, so what the workflow eventually shows is a timeout
    // instead. Found by watching a run sit for ten minutes after it had
    // already decided to give up.
    process.exit(1);
  });
}
