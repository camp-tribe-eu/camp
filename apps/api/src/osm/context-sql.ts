// CAMP-296: запит, що міряє довкілля кемпінгу, і перевірка, що він має чим
// відповідати на питання «чи це в ЄС-27».
//
// 🔴 ОКРЕМИЙ ФАЙЛ, бо compute-context.ts — це СКРИПТ: він підключається до
// бази й працює при імпорті, тож жоден рядок усередині не можна перевірити.
// Той самий висновок зробив route-poi-sql.ts для CAMP-113.

import { EU_MEMBER_STATES, normaliseCountry } from './eu';

/**
 * Умова «цей об'єкт у Союзі»: країна, що проставлена йому на завантаженні,
 * входить у список.
 *
 * 🔴 КОЛОНКА, А НЕ ПРОСТОРОВИЙ ЗВ'ЯЗОК У САМОМУ ЗАПИТІ. Перша редакція
 * перевіряла полігон прямо тут (`EXISTS … ST_Covers`), і планувальник
 * відповів тим, що попереджала картка: умова застосовується до сортування
 * за відстанню, тож замість обходу KNN-індексу він рахував зв'язок для всіх
 * 214 906 супермаркетів і сортував. Заміряно 14.10.2026 на 30 кемпінгах:
 *
 *   супермаркет без умови      6 мс
 *   супермаркет з EXISTS       55 980 мс   ← 1,1 с на кемпінг, 57 082 разів
 *   місто з EXISTS              2 625 мс
 *   станція з EXISTS            9 457 мс
 *
 * Країна вираховується один раз, під час завантаження
 * (tag-ctx-country.sql), і лежить колонкою — тоді умова дешева, а KNN
 * лишається KNN.
 *
 * 🔴 ПОЗИТИВНА ПЕРЕВІРКА: код у списку. Порожній рядок означає «перевірено,
 * в жодному полігоні», NULL — «ще не проставлено» (це ловить
 * assertCountryTagsReady). Обидва відпадають тим, що їх немає у списку, —
 * як і Росія, якої в таблиці полігонів взагалі немає.
 *
 * 🔴 Список приходить параметром, а не пишеться в SQL: друге визначення
 * області розійшлось би з першим (eu-member-states.json).
 */
export const UNION_PREDICATE = 'x.country = ANY($2::text[])';

/**
 * Відстань до найближчого міста, супермаркета й станції — одним запитом.
 *
 * 🔴🔴 «НАЙБЛИЖЧИЙ» ТУТ — ЗА МЕТРАМИ НА СФЕРОЇДІ, А НЕ ЗА ГРАДУСАМИ (CAMP-323).
 * KNN-оператор `<->` на geometry міряє планарні градуси — їх тримає GiST-
 * індекс, — а градус довготи на 54° це 65 км, градус широти — 111 км. Тож
 * планарний порядок віддає перевагу сусідам по меридіану. Тут стояло
 * `ORDER BY s.location <-> x.geom LIMIT 1`, а число, що друкувалось, рахувалось
 * `ST_Distance(::geography)`: правдиве число біля хибно обраного об'єкта.
 *
 * Заміряно 15.10.2026 на 57 082 живих кемпінгах проти точного оракула (нижче),
 * обраний об'єкт не був найближчим у
 *
 *   місто      7 494 кемпінгів, у середньому на 3,2 км далі, найгірший +137 км
 *   магазин    9 390 кемпінгів, у середньому на 1,1 км далі, найгірший +88 км
 *   станція   12 977 кемпінгів, у середньому на 2,5 км далі, найгірший +84 км
 *
 * (Перша редакція цього коментаря давала 9 330 і 12 946. То були «найближчі 20
 * за `<->`, переранжовані» — нижня межа: вона не бачить об'єкта глибше двадцятого
 * місця в планарному порядку. Для міста цифра збіглась, бо глибше
 * одинадцятого там не буває.)
 *
 * КРОКИ (`nearestJoin`), обидва по GiST-індексу:
 *
 *   1. `<->` LIMIT 1 — найближчий планарно. Його відстань у метрах є ВЕРХНЬОЮ
 *      межею справжньої: справжній найближчий не може бути далі.
 *   2. Усе, що лежить у прямокутнику, який гарантовано містить кулю такого
 *      радіуса, — і з цього найближчий за `ST_Distance(::geography)`. Нічия
 *      вирішується `ogc_fid`: відповідь не мусить мінятись між прогонами.
 *
 * 🔴 ЦЕ ТОЙ САМИЙ ВІЗЕРУНОК, ЩО В route-poi-sql.ts (`countrySql`), routes.near()
 * і route-services: індекс дає кандидатів у планарному порядку, справжній
 * порядок накладається зверху. ВІДМІННІСТЬ ОДНА, І ЗАМІРЯНА: кандидатів
 * обмежено МЕТРАМИ, а не ЧИСЛОМ рядків (`LIMIT N`, `OVERFETCH`).
 *
 * Чому не `LIMIT N` — на тих самих 57 082 кемпінгах. Місце справжнього
 * найближчого в планарному порядку, тобто мінімальне N, яке його ще бере:
 *
 *               медіана   99,9-й перцентиль   найбільше
 *   місто           1             6               11
 *   магазин         2            30              105
 *   станція         1            31              132
 *
 * Хвіст тут — окремі кемпінги (глибше 50-го місця: 9 магазинів, 17 станцій), а
 * N мусить покрити хвіст. N=20 лишає хибними 0 / 104 / 110 кемпінгів (до +18 км
 * для магазина, +55 км для станції) і коштує 38,5 с проти 6,1 с у планарного
 * запиту. Нуль дає лише N близько 132 (там стоїть одна станція); N=135 — 211,7 с,
 * у 35 разів повільніше.
 * Прямокутник у метрах дає нуль за побудовою, а не за підібраним N, і коштує
 * 9,8 с (×1,6). Константи, що застаріє з наступним перезавантаженням шарів,
 * тут немає.
 *
 * 🔴 ЧОМУ ПРЯМОКУТНИК ГАРАНТОВАНИЙ. Нехай R — верхня межа, метри. Куля
 * радіуса R навколо кемпінга сягає на північ чи південь не далі за
 * R / 110 574 градуса (стільки метрів у градусі широти на екваторі — найменше
 * по Землі). Беремо `M_PER_DEGREE_LAT` = 110 000, менше, тож прямокутник
 * ширший за потрібний. По довготі — той самий кут, поділений на cos(широта
 * найпівнічнішої точки прямокутника), бо градус довготи найкоротший саме там.
 * Це оцінка зверху, не точна: на 70° N при R = 140 км вона дає 3,98°, точне —
 * 3,68°. Прямокутник ніколи не вужчий за кулю, тож усе ближче за R у ньому є.
 * Він не переходить через лінію зміни дат: найзахідніший живий кемпінг на
 * −31,3° (Азори), найсхідніший на 34,6°.
 *
 * Перевірено двома способами, що не діляться із запитом ні індексом, ні
 * прямокутником: повний перебір `ST_Distance` по шару (context-sql.spec.ts, на
 * випадковій хмарі) і `LIMIT 135` з переранжуванням на всіх 57 082 кемпінгах.
 *
 * 🔴 ВОДА ТУТ ЛИШАЄТЬСЯ ПЛАНАРНОЮ (`<->`, LIMIT 1): картка CAMP-323 — про
 * місто, магазин і станцію. Це не доказ, що в неї немає тієї самої вади, а
 * лише те, що її не заміряно. Спроба 15.10.2026 переранжувати 20 кандидатів
 * води геодезично на 60 кемпінгах не завершилась за 5 хв 22 с: щонайменше 5 с
 * на кемпінг, тобто понад три доби на 57 082: `ST_Distance(::geography)` до
 * велетенських берегових ліній (див. WATER_FID_SQL нижче) і є ціною.
 *
 * 🔴 Вода відфільтрована до озер, водойм, річок і берегової лінії. У
 * словенському екстракті 26 654 струмки проти 338 озер, тож «найближча вода»
 * без фільтра майже завжди була б дренажною канавою за кілька метрів —
 * формально правда, марна для того, хто їде відпочивати.
 *
 * 🔴🔴 МІСТО, МАГАЗИН І СТАНЦІЯ ФІЛЬТРУЮТЬСЯ ЗА ЄС-27, А ВОДА — НІ, І ЦЕ
 * НЕ НЕДОГЛЯД. Не плутати з непослідовністю й не «вирівнювати».
 *
 * Вісь не «чотири запити чи три», а «чи це твердження про ЛЮДСЬКЕ місце».
 * Озеро за 2 км у Калінінградській області — найближче озеро, фізичний
 * факт: кордон його не відсуває. А «найближче місто / супермаркет /
 * станція» — твердження, яким читач скористається: поїде туди, купить, сяде
 * на потяг. Поза Союзом вони хибні за нашою ж областю (рішення власника
 * 24.09.2026) — а для Калінінграда ще й недосяжні.
 *
 * Заміряно 15.10.2026 на 57 082 живих кемпінгах (audit-context-near.ts):
 * найближчий шматок води лежить поза полігонами ЄС-27 у 970 кемпінгів, але
 * 904 з них — у межах 10 м (берегова лінія й є краєм полігона), 37 — до
 * 100 м, 28 — до 1 км, і лише ОДИН — далі за кілометр (озеро в Латвії біля
 * білоруського кордону). Фільтр води виправив би один кемпінг із 57 082, а
 * решті підмінив би правду («за 2 км озеро») на хибу.
 *
 * Параметри: $1 — країна кемпінгу або NULL, $2 — EU_MEMBER_STATES.
 */
const WATER_FILTER = `x.water IN ('lake','reservoir','river')
          OR x.waterway = 'river'
          OR x."natural" = 'coastline'`;

const WATER_JOIN = `
    LEFT JOIN LATERAL (
      SELECT round(ST_Distance(s.location::geography, x.geom::geography)) AS m,
             CASE
               WHEN x."natural" = 'coastline' THEN 'sea'
               WHEN x.water IN ('lake','reservoir') THEN x.water
               ELSE 'river'
             END AS kind,
             x.name, x.ogc_fid AS fid
        FROM osm_ctx_water x
       WHERE ${WATER_FILTER}
       ORDER BY s.location <-> x.geom LIMIT 1
    ) w ON true`;

/**
 * Метрів у градусі широти — з ЗАПАСОМ. Справжній мінімум по Землі 110 574 м
 * (на екваторі); 110 000 менше, тож прямокутник виходить трохи ширшим, а не
 * вужчим за кулю. Див. «чому прямокутник гарантований» у коментарі до
 * `WATER_FILTER` вище.
 */
const M_PER_DEGREE_LAT = 110_000;

/**
 * Один join «найближчий за метрами»: два кроки з коментаря вище.
 *
 * 🔴 `pool` ПИШЕТЬСЯ РАЗ І ПІДСТАВЛЯЄТЬСЯ В ОБИДВА КРОКИ. Умова на країну й
 * умова на вид об'єкта в кроці 2 мусять бути тими самими, що в кроці 1: без
 * умови в кроці 1 верхня межа могла б бути відстанню до об'єкта поза Союзом, і
 * прямокутник виявився б замалим для найближчого всередині; без умови в кроці 2
 * крок 2 повернув би хибного. Перше правило в двох списках — половина
 * виправлення, тому воно записане один раз.
 *
 * `bound` — крок 1, метри до планарно найближчого. Нуль (кемпінг стоїть у
 * полігоні магазина) дає вироджений прямокутник — точку, і `&&` її знаходить.
 */
function nearestJoin(alias: string, table: string, kind: string): string {
  const pool = `FROM ${table} x
               WHERE ${kind}
                 AND ${UNION_PREDICATE}`;
  return `
    LEFT JOIN LATERAL (
      SELECT round(g.m) AS m, g.name, g.fid
        FROM (SELECT ST_Distance(s.location::geography, x.geom::geography) AS bound
                ${pool}
               ORDER BY s.location <-> x.geom LIMIT 1) k
        CROSS JOIN LATERAL (SELECT k.bound / ${M_PER_DEGREE_LAT} AS dy) y
        CROSS JOIN LATERAL (
          -- 🔴 least(89, ...) — СТЕЛЯ, І ВОНА Ж ЄДИНА ДІРКА В ГАРАНТІЇ.
          -- Поки куля не накриває полюс, прямокутник її містить: перевірено
          -- незалежним оракулом на ST_Project — 1 065 пар, широта 0-70
          -- градусів, R від 1 м до 2 100 км, мінімальний запас 1,0052 по
          -- широті та 1,0120 по довготі.
          -- Коли накриває — стеля 89 обрізає потрібну довготу: на 88 пн. ш.
          -- із R = 313 км треба 197,1 градуса, а дається 163,1.
          -- Недосяжно на наших даних: максимум abs(lat) + dy = 72,75 при
          -- стелі 89, тобто запас 16,25 градуса. Але якщо хтось підніме межу
          -- широт — ЄС-27 закінчується на 71 — цей рядок треба читати першим.
          SELECT y.dy / cos(radians(least(89, abs(ST_Y(s.location)) + y.dy))) AS dx) z
        CROSS JOIN LATERAL (
          SELECT ST_Distance(s.location::geography, x.geom::geography) AS m,
                 x.name, x.ogc_fid AS fid
            ${pool}
             AND x.geom && ST_MakeEnvelope(ST_X(s.location) - z.dx, ST_Y(s.location) - y.dy,
                                           ST_X(s.location) + z.dx, ST_Y(s.location) + y.dy, 4326)
           ORDER BY m, x.ogc_fid LIMIT 1) g
    ) ${alias} ON true`;
}

/**
 * Три join-и «про людське місце». Окремою константою, щоб і повний запит, і
 * `NEAR_SQL` (без води) складалися з одного й того самого тексту: фільтр не
 * може бути в одному, а в другому ні.
 */
const NEAR_JOINS = [
  nearestJoin('t', 'osm_ctx_place', `x.place IN ('city','town')`),
  nearestJoin('p', 'osm_ctx_poi', `x.shop = 'supermarket'`),
  nearestJoin('r', 'osm_ctx_poi', `x.railway IN ('station','halt')`),
].join('');

/** Скільки разів умова на країну стоїть у NEAR_JOINS: два кроки × три join-и. */
export const UNION_PREDICATE_COUNT = 6;

const SPOT_FILTER = `
   WHERE s.missing_since IS NULL
     AND ($1::text IS NULL OR upper(s.country) = $1)`;

export const CONTEXT_SQL = `
  SELECT s.id, s.slug,
         ST_Y(s.location::geometry) AS lat,
         ST_X(s.location::geometry) AS lon,
         s.context,
         w.m AS water_m, w.kind AS water_kind, w.name AS water_name, w.fid AS water_fid,
         t.m AS town_m,  t.name AS town_name,  t.fid AS town_fid,
         p.m AS shop_m,  p.name AS shop_name,  p.fid AS shop_fid,
         r.m AS rail_m,  r.name AS rail_name,  r.fid AS rail_fid
    FROM camping_spots s${WATER_JOIN}${NEAR_JOINS}${SPOT_FILTER}`;

/**
 * Те саме без води — для refresh-context-near.ts, якому вода не потрібна.
 *
 * 🔴 Вода — найдорожчий join: `osm_ctx_water` важить 4 ГБ, і повний запит на
 * 57 082 кемпінгах іде хвилинами (заміряно нижче в PR). Скрипт, що міняє
 * три числа, не мусить платити за четверте.
 */
export const NEAR_SQL = `
  SELECT s.id, s.slug, s.context,
         t.m AS town_m,  t.name AS town_name,  t.fid AS town_fid,
         p.m AS shop_m,  p.name AS shop_name,  p.fid AS shop_fid,
         r.m AS rail_m,  r.name AS rail_name,  r.fid AS rail_fid
    FROM camping_spots s${NEAR_JOINS}${SPOT_FILTER}`;

/**
 * Лише id найближчої води, без `ST_Distance` на geography.
 *
 * Для аудиту: порядок той самий (`<->` по тому ж фільтру), тож id збігається
 * з `water_fid` повного запиту, але не платить за геодезичну відстань до
 * велетенських берегових ліній. Повний запит на 57 082 кемпінгах хвилини
 * тримається на воді й лише на ній.
 */
export const WATER_FID_SQL = `
  SELECT s.id,
         (SELECT x.ogc_fid FROM osm_ctx_water x
           WHERE ${WATER_FILTER}
           ORDER BY s.location <-> x.geom LIMIT 1) AS water_fid
    FROM camping_spots s${SPOT_FILTER}`;

/**
 * Той самий запит, у якого прибрано умову на країну — тобто такий, яким
 * він був би без CAMP-296. Для ВИМІРУ «до й після» (audit-context-near.ts), а
 * не для роботи.
 *
 * 🔴 ПОРЯДОК У НЬОМУ ВЖЕ ГЕОДЕЗИЧНИЙ (CAMP-323), а не планарний, яким були
 * збережені значення до обох карток. Тож «до/після» тут — різниця САМЕ умови на
 * країну, а не умови плюс порядку; і refresh-context-near.ts, що порівнює ці
 * два запити, бачить лише те, що змінила умова (див. його коментар про
 * `--with-drift`).
 *
 * 🔴 ВИВЕДЕНО З ЗАПИТУ-ПІСЛЯ, А НЕ ПЕРЕПИСАНО. Окрема копія старого запиту
 * розійшлась би з новим у чомусь, крім фільтра, і різниця «до/після» вже не
 * була б різницею фільтра. Тут єдина відмінність — рівно шість підстановок
 * `true` на місці `UNION_PREDICATE` (два кроки в кожному з трьох join-ів), і
 * якщо їх не шість, функція кидає: запит змінився так, що «до» більше нічого не
 * означає.
 */
export function withoutUnionFilter(sql: string = CONTEXT_SQL): string {
  const parts = sql.split(UNION_PREDICATE);
  if (parts.length !== UNION_PREDICATE_COUNT + 1) {
    throw new Error(
      `expected the EU filter in exactly ${UNION_PREDICATE_COUNT} places ` +
        `(both steps of 3 joins), found ${parts.length - 1}`,
    );
  }
  return parts.join('true');
}

/**
 * 🔴 Список країн — `EU_MEMBER_STATES`, а не `EU_MEMBER_STATES_AND_SUBDIVISIONS`
 * і не `isEuMemberState`.
 *
 * Колонка `country` береться з `osm_country_area`, а та будується з OSM, де код країни — ISO 3166-1 alpha-2
 * ДЕРЖАВИ: `fi`, `gr`. Аландів як окремої країни там немає — вони всередині
 * полігона Фінляндії (заміряно: усі 19 кемпінгів `AX` лежать у `fi`). Тому
 * `ax` у списку нічого б не зіставило, а лише розширило б фільтр на код,
 * який жодному полігону не належить. Список підрозділів (`ax`) потрібен
 * джерелам, що кодують підрозділами — Natural Earth для route-poi, — і саме
 * там він і вжитий.
 *
 * `isEuMemberState` — функція над одним кодом; SQL її викликати не може.
 *
 * Перевірка `assertCountryTagsReady` гарантує другий бік: що джерело й
 * справді не заговорило підрозділами.
 */
export const contextParams = (
  country: string | null,
): [string | null, readonly string[]] => [country, EU_MEMBER_STATES];

export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/**
 * 🔴 БЕЗ ПРОСТАВЛЕНОЇ КРАЇНИ ФІЛЬТР НЕ ПОМИЛЯЄТЬСЯ — ВІН ВИДАЛЯЄ ВСЕ.
 *
 * Три способи, як колонка `country` може бути не такою, як треба, і в усіх
 * трьох скрипт завершився б з кодом 0, а сторінки просто сказали б менше:
 *
 *  1. Колонки немає. load-context.sh робить `ogr2ogr -overwrite`, тож кожне
 *     перезавантаження шарів стирає колонку — разом з усім, що в ній було.
 *  2. Колонка є, а частина рядків NULL: нові рядки після часткового
 *     завантаження.
 *  3. Країни проставлено проти неповної таблиці полігонів: у якоїсь
 *     держави-члена немає жодного міста з її кодом, і кожен її кемпінг
 *     втрачає місто, магазин і станцію.
 *
 * Перелік кодів береться з даних, а не з того, що ми очікуємо: перевіряти
 * власні коди означає перевіряти список проти самого себе. `ax` і `el` — це
 * члени Союзу під чужою назвою; код, який normaliseCountry кудись перекладає,
 * не збігається зі списком і не знайдеться в ньому.
 */
export const PARTIAL_ENV = 'CAMPTRIBE_PARTIAL_CONTEXT';

/**
 * 🔴 ТРЕТЯ ПЕРЕВІРКА ВБИВАЛА ВЛАСНИЙ РОБОЧИЙ ПРОЦЕС, І ЦЕ ЗНАЙШЛА РЕЦЕНЗІЯ.
 *
 * `load-context.sh europe/slovenia` — задокументований спосіб працювати з
 * однією країною (рядки 4-5 того скрипта). Після нього в шарах є міста
 * Словенії і сусідів, а решти двадцяти з гаком держав немає — і перевірка
 * «кожна держава-член десь трапляється» валила `compute-context` із
 * порадою `--tag-only`, якої **неможливо виконати**: лікує вона інше, а
 * єдиний справжній спосіб — завантажити всі 27 екстрактів.
 *
 * Тому перевірка лишається за замовчуванням (на проді неповна таблиця
 * полігонів = країна мовчки втрачає все), але часткове завантаження її
 * **свідомо послаблює**: `partial: true` друкує, чого бракує, замість
 * падати. Прапорець не вгадується з даних — його ставить той, хто
 * запустив часткове завантаження, через `CAMPTRIBE_PARTIAL_CONTEXT=1`.
 *
 * 🔴 Послаблення **гучне**: воно перелічує коди поіменно. Тихий пропуск і
 * виконана перевірка виглядають однаково через тиждень.
 */
export async function assertCountryTagsReady(
  db: Queryable,
  {
    partial = false,
    log = console,
  }: Readonly<{
    partial?: boolean;
    log?: Pick<Console, 'warn'>;
  }> = {},
): Promise<void> {
  const fix =
    'Run: ./scripts/osm-pipeline/load-country-boundaries.sh --tag-only';

  const cols = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'country'
        AND table_name IN ('osm_ctx_place', 'osm_ctx_poi')`,
  );
  const have = new Set(cols.rows.map((r) => r.table_name));
  const lacking = ['osm_ctx_place', 'osm_ctx_poi'].filter((t) => !have.has(t));
  if (lacking.length > 0) {
    throw new Error(
      `${lacking.join(' and ')} has no country column — load-context.sh re-creates the layers and drops it.\n${fix}`,
    );
  }

  const untagged = await db.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM osm_ctx_place WHERE country IS NULL)
          + (SELECT count(*) FROM osm_ctx_poi   WHERE country IS NULL) AS n`,
  );
  if (Number(untagged.rows[0]?.n) > 0) {
    throw new Error(
      `${untagged.rows[0].n} towns, shops or stations have no country yet.\n${fix}`,
    );
  }

  const codes = await db.query<{ country: string }>(
    `SELECT country FROM (SELECT DISTINCT country FROM osm_ctx_place) a
     UNION
     SELECT country FROM (SELECT DISTINCT country FROM osm_ctx_poi) b`,
  );
  const seen = new Set(
    codes.rows.map((r) => r.country).filter((c) => c !== ''),
  );

  const missing = EU_MEMBER_STATES.filter((c) => !seen.has(c));
  if (missing.length > 0) {
    const what =
      `no town, shop or station is tagged with: ${missing.join(', ')}.\n` +
      'Every campsite there would lose its town, shop and station.';
    if (!partial) throw new Error(`${what}\n${fix}`);
    log.warn(
      `🔴 ${PARTIAL_ENV}=1 — ${what}\n` +
        'That is expected after a partial load-context.sh; it is NOT safe in production.',
    );
  }

  const foreign = [...seen].filter((c) => normaliseCountry(c) !== c);
  if (foreign.length > 0) {
    throw new Error(
      `country codes the member list does not spell: ${foreign.join(', ')}.\n` +
        'They would never match, and their countries would lose everything.',
    );
  }
}
