# Замір: які твердження про регіон можна вивести з наших даних

Дата заміру: 2026-10-27. Гілка `main` на `4a55f0c`. Нічого не змінено й не закомічено, крім цього файлу.

## 0. Знаменник — локальна база, НЕ прод

Прод не чіпався. Усі числа — з локальної `camptribe_dev` (та, на яку вказує `DATABASE_URL`
в `apps/api/.env`: `host=localhost db=camptribe_dev`; виведено лише host/db).

```
psql -h localhost -U george -d camptribe_dev -Atc "select count(*) total, count(*) filter (where missing_since is null) alive, count(distinct country) countries from camping_spots"
63159|57128|28
```

- Знаменник тут **63 159** (живих 57 128), а не 48 944 з картотеки (`Facts/eu-campsite-inventory.md:20`, прод після CAMP-253). Різниця не відтворена: у локальній базі 844 пари `w<id>`/`a<2·id>` (старий дубль) і 19 657 `n`-рефів проти 14 394 точок у зрізі Geofabrik.
  `select count(*) from camping_spots a join camping_spots w on w.osm_ref = 'w' || (substring(a.osm_ref from 2)::bigint / 2)::text where a.osm_ref ~ '^a' and substring(a.osm_ref from 2)::bigint % 2 = 0` → 844.
- Останній імпорт у локальній базі: `max(last_seen_at)` = 2026-10-20; останній `context_computed_at` = 2026-09-25.
- Країн 28 (ЄС-27 + `AX` 19 рядків).
- Фікстура CI (`apps/api/test/fixtures/ci-seed.sql`): 72 рядки `INSERT INTO camping_spots`, 35 із `"elevation"` — не використана як знаменник, бо жива база є.

## 1. Заповненість полів (із 63 159)

Команда для amenities:
`select k, v, count(*) from camping_spots, jsonb_each_text(amenities) e(k,v) group by 1,2`
Команда для context:
`select k, count(*) from camping_spots, jsonb_object_keys(context) k group by 1`
Решта: `count(col)` / `count(*) filter (where ...)` одним `union all`-запитом.

| поле | непорожніх | % | примітка |
|---|---|---|---|
| `type` | 63 159 | 100 % | paid 45 219, rv_park 10 244, camper_stop 4 400, wild 2 923, free 373 |
| `context.water.m` + `.kind` | 61 558 | 97,5 % | river 29 875, sea 10 724, lake 10 539, reservoir 10 420, без контексту 1 601 |
| `context.town.m` | 61 558 | 97,5 % | |
| `context.station.m` | 61 558 | 97,5 % | 🔴 576 рядків > 100 км, max 1 887 707 м |
| `context.supermarket.m` | 61 558 | 97,5 % | |
| `context.water.name` | 26 411 | 41,8 % | |
| `context.elevation` | 1 289 | **2,0 %** | > 1 500 м — **3 рядки** на всю базу |
| `context.terrain.type` | 1 239 | **2,0 %** | mountainous 501, rolling 251, flat 248, hilly 239 |
| `amenities` (ключі є) | 54 407 | 86,1 % | 8 752 рядки `{}`; наявність ключа ≠ знання |
| `amenities.electricity` ∈ {yes,no} | 17 330 | 27,4 % | yes 13 919 / no 3 411 / unknown 37 077 |
| `amenities.water` ∈ {yes,no} | 13 426 | 21,3 % | yes 11 440 / no 1 986 |
| `amenities.toilets` ∈ {yes,no} | 13 281 | 21,0 % | yes 11 136 / no 2 145 |
| `amenities.greyWater` ∈ {yes,no} | 13 166 | 20,8 % | yes 10 513 / no 2 653 |
| `amenities.shower` ∈ {yes,no} | 11 023 | 17,5 % | yes 9 031 / no 1 992 |
| `amenities.wifi` ∈ {yes,no} | 9 603 | 15,2 % | yes 7 170 / no 2 433 |
| `amenities.dogFriendly` ∈ {yes,no} | 5 179 | 8,2 % | yes 4 916 / no 263 |
| `amenities.wheelchair` ∈ {yes,no} | 4 896 | 7,8 % | |
| `amenities.laundry` ∈ {yes,no} | 1 594 | **2,5 %** | yes 1 523 / no 71 / unknown 52 812 |
| `overnight_status` ∈ {allowed,forbidden} | 3 449 | 5,5 % | allowed 3 192, forbidden 257, unknown 59 710; джерело лише `osm:motorhome=*` |
| `name` | 51 293 | 81,2 % | |
| `contact` ≠ `{}` | 35 970 | 57,0 % | |
| `osm_record_edited_at` | 47 534 | 75,3 % | |
| `warning_areas` непорожній | 52 907 | 83,8 % | живий join тривог, не властивість місця |
| `website` | 6 575 | 10,4 % | |
| `stars` | 4 214 | 6,7 % | 1★ 234, 2★ 959, 3★ 1 862, 4★ 953, 5★ 206 |
| `description` | 5 758 | 9,1 % | усі `description_lang=fr` (DATAtourisme) |
| `outline` | 1 292 | 2,0 % | |
| `region` | 63 023 | 99,8 % | 136 NULL |
| `owner_overrides` ≠ `{}` | 0 | 0 % | |

Сезонності, цін, фото, відгуків у таблиці немає (колонок немає: `information_schema.columns`, 30 колонок, перелік у заміру).

## 2. Розподіл по регіонах

```
with r as (select country, region, count(*) n, count(*) filter (where missing_since is null) alive from camping_spots where region is not null group by 1,2)
select count(*), count(*) filter (where n<5), count(*) filter (where n<10), count(*) filter (where n>=20), percentile_cont(0.25) within group (order by n), percentile_cont(0.5) within group (order by n), percentile_cont(0.75) within group (order by n), min(n), max(n), count(*) filter (where alive<5) from r
816|237|311|451|3|26|77|1|1472|243
```

- Регіонів (пара країна/регіон): **816**. Квартилі кількості об'єктів: **Q1 = 3, медіана = 26, Q3 = 77**; min 1, max 1 472.
- Менше 5 об'єктів: **237 (29 %)**; менше 10: 311; 20 і більше: 451. За живими (`missing_since is null`) менше 5: 243.
- Поріг індексації хаба: `REGION_INDEX_THRESHOLD = 3` (`apps/api/src/spots/spots.service.ts:788`).
- Регіонів на країну: IT 112, SI 105, FR 103, LV 79, ES 49 … LU 3, CY 4.

## 3. Кандидати у твердження — на скількох регіонах є ≥ 5 (≥ 20) об'єктів із ВІДОМИМ значенням

Команда (amenities): `with x as (select country, region, k, count(*) filter (where v in ('yes','no')) known, count(*) filter (where v='yes') yes from camping_spots, jsonb_each_text(amenities) e(k,v) where region is not null group by 1,2,3) select k, count(*) filter (where known>=5), count(*) filter (where known>=20), count(*) filter (where yes>=5) from x group by 1`
Команда (context): аналогічний `with r as (... count(*) filter (where context->'water' ? 'kind') ...)`.

| форма твердження | поле | регіонів ≥5 відомих | ≥20 відомих |
|---|---|---|---|
| «N із M кемпінгів регіону — paid / camper stop / wild» | `type` | 579 | 451 |
| «Найближча (названа) вода для N із M — море / озеро / річка» | `context.water.kind` | 576 | 448 |
| «N із M мають залізничну зупинку в межах 2 км» (12 235 рядків < 2 км по базі) | `context.station.m` | 576 | 448 |
| «Найближча названа вода: ‹назва› для N кемпінгів» | `context.water.name` | 459 | 280 |
| «Для N із M, де OSM записав, є електрика (yes), для K — ні» | `electricity` | 419 (yes≥5: 374) | 237 |
| те саме, туалети | `toilets` | 381 | 171 |
| те саме, злив сірої води | `greyWater` | 368 | 188 |
| те саме, wifi | `wifi` | 358 | 136 |
| те саме, душ | `shower` | 357 | 133 |
| те саме, питна вода | `water` | 356 | 175 |
| «Море — найближча вода для ≥5» | `water.kind='sea'` | 204 | 121 |
| те саме, собаки | `dogFriendly` | 243 | 77 |
| «OSM каже, що ночівля в автодомі дозволена для N із M» (уже є на сторінці країни) | `overnight_status` | 174 | 45 |
| те саме, доступність на візку | `wheelchair` | 215 | 56 |
| те саме, пральня | `laundry` | **96** | **9** |
| «Середня висота / N вище 1 000 м» | `context.elevation` | **51** | **13** |
| «Рельєф: N гірських, K рівнинних» | `context.terrain.type` | **50** | **13** |

Зразок із макета `02-hubs.html:409` «No wild camping spot above 1 500 m has a laundry»:
`select count(*) from camping_spots where (context->>'elevation')::numeric > 1500` → **3** (AT Salzburg 1 569 м, AT Vorarlberg 1 826 м, FR Hautes-Alpes 1 879 м; жоден не `wild`);
`wild` із відомою пральнею → 15 рядків (yes 5), unknown 2 908. Перетин «wild ∧ >1 500 м» = **0 із 0** — рядок із макета зараз не обчислюється на жодному регіоні.

## 4. 🔴 Де твердження стане брехнею

Джерело `unknown`: `apps/api/src/osm/import-spots.ts:591,605` — відсутній тег пишеться як `'unknown'`; `route-poi-facilities.ts:357`: «Nobody has written that tag». Тобто `unknown` = «ніхто не записав», не «немає».

Хибні формулювання (і чому):
- «Жоден кемпінг регіону не має пральні» — `laundry` відомий для 2,5 % рядків; 52 812 `unknown`. Те саме для будь-якого «жоден / ніхто / немає» по amenities.
- «X % кемпінгів регіону мають душ» зі знаменником = усі кемпінги — знаменник містить 82,5 % `unknown`; число залежить від того, хто що встиг затегувати.
- «Ночівля заборонена / не дозволена» для `unknown` — прецедент уже застерігає: `overnight-coverage.tsx:75`: «we do not know, which is not the same as not allowed».
- «Кемпінг біля річки» для кожного, у кого `water.kind='river'` — `water` це НАЙБЛИЖЧА вода з відфільтрованих класів і вона є завжди (97,5 %); 47 % «river» — властивість карти, не місця. Відстань треба друкувати, а не тип; 91 рядків із водою > 10 км.
- «Найближча станція …» для 576 рядків із `station.m` > 100 км (max 1 888 км) — артефакт покраїнного екстракту, не факт.
- Будь-що про висоту/рельєф («вище 1 500 м», «гірський регіон») — поле заповнене на 2,0 %, 212 регіонів мають хоч один рядок, 51 — п'ять; відсутність висоти не означає «низько».
- Відсотки взагалі — прецедент `overnight-coverage.tsx:16-19`: «No percentage: "2%" of a denominator that moves every Monday is a figure that is wrong by next week, and "12 of 612" is checkable by anybody who counts».

Чесні формулювання:
- «Серед N кемпінгів регіону, для яких OpenStreetMap записав, чи є душ, M кажуть так, K — ні» (знаменник = `yes+no`, `no` реально записане: shower no 1 992).
- «N кемпінгів регіону мають позначку "електрика" в OSM» — лічильник `yes` без знаменника.
- «Для N із M OSM каже, що ночівля в автодомі дозволена; для решти K ми не знаємо» — так уже написано на сторінці країни.
- «Для N кемпінгів найближча названа вода — ‹назва› на відстані ≤ 1 км» (обчислене поле, 97,5 %, із відстанню).
- «Залізнична зупинка в межах 2 км — у N із M» — обчислене, але після відсікання аномалій > 100 км.
- Дата зрізу в кожному рядку («Counted from our listings as of …»), як у `OvernightCoverage`.

Прецедент у коді, дослівно (`apps/web/src/components/region-listing.tsx:117-119`):

```
  // Only what is actually recorded. A card that prints five grey icons for
  // five unknown amenities says "we know nothing" five times; one honest
  // line says it once and leaves room for what we do know.
```

## 5. Що вже є

- `grep -rn -E "\b(insight|editorial|generated)\b" apps/web/src apps/api/src` → 20 збігів, усі про `src/generated/*.json` (редиректи, gone) і коментарі; генерації тверджень із даних — **0**. `summary` дає шум (`<summary>`), окремо не рахував.
- Єдиний рядок, порахований із власних даних по території: `apps/web/src/components/overnight-coverage.tsx` (CAMP-255, сторінка країни, «N of M … allowed … for the other K we do not know»).
- Сторінка кемпінгу друкує факти оточення: `apps/web/src/app/camping/[country]/[region]/[slug]/page.tsx:773-840` (вода+відстань, супермаркет, зупинка, висота, рельєф) — по одному об'єкту, без агрегатів.
- Число **289**: `docs/data-durability.md:66` — «289 of 1079 campsites have a computed context», замір 23.09.2026 (квота Open-Meteo: 6 кемпінгів на добу); повторене в `Facts/competitor-technical-audit.md:54` («289 сторінок із 9830», 24.09.2026) і `_INDEX.md:83`. У локальній базі зараз `context` ≠ `{}` на **61 558** рядках (PostGIS-відстані), а висота/рельєф — на 1 289/1 239. **На проді не перевірено.** Число 9 830 — із того ж аудиту, спосіб підрахунку в нотатці не названий, не перевірено.
- `grep -n -E "compute-context|backfill-context|refresh-context" .github/workflows/*.yml infra/*.sh infra/systemd/*` → 0 рядків: жоден воркфлоу не рахує контекст; `compute-context.ts` запускається руками (`apps/api/src/osm/compute-context.ts:3-4`).
