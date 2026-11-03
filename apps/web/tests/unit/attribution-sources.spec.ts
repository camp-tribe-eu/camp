import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { legalPage } from "@/lib/legal";
import {
  HOST,
  isLocalOrFixture,
  normalise,
  SWEEP_ROOTS,
  sweepHosts,
} from "./attribution-sweep";
import { SEEDED, seededHtml } from "./legal-cms";
import { visibleText } from "./rendered-text";

/**
 * Сторінка «Data and attribution» обіцяє назвати «exactly what, from whom,
 * and under which licence». Цей тест тримає обіцянку в обидва боки.
 *
 * 🔴 ЧОМУ ЦЕ ЛІЦЕНЗІЯ, А НЕ СТИЛЬ. CC BY 4.0, Licence Ouverte, IODL,
 * умови CEMS і MeteoAlarm дають право показувати чужі дані ЗА УМОВИ
 * атрибуції. Джерело, яке є в коді й відсутнє на цій сторінці, — це дані,
 * які ми показуємо, не виконавши умови, за якої маємо право їх показувати.
 * 1.0 (23.09.2026) не називала дванадцять таких джерел.
 *
 * 🔴 КОРПУС — ЦЕ КОД, А НЕ ПЕРЕЛІК У ЦЬОМУ ФАЙЛІ. Хости беруться з файлів,
 * де джерела справді визначені (`SOURCE_FILES`), регулярним виразом по
 * літералах `https://…`. Новий хост у будь-якому з цих файлів без рядка на
 * сторінці — падіння, яке називає хост і файл. Перелік хостів у самому
 * тесті був би другою копією того, що він перевіряє.
 *
 * 🔴 ЧИТАЄТЬСЯ ВІДДАНИЙ HTML сторінки — `href` посилань і видимий текст
 * крізь той самий `LegalProse`, що й справжня сторінка; текст — із міграцій
 * (`legal-cms.ts`). Правка в CMS цьому файлу невидима; це названо там.
 *
 * Зворотний бік: кожне зовнішнє посилання сторінки веде або на хост із коду,
 * або на текст ліцензії чи бібліотеку з `REFERENCE_HOSTS` — із причиною.
 * Рядок про джерело, якого в коді немає, — теж падіння з назвою хоста.
 *
 * 🔴 ДРУГИЙ СТОРОЖ — СУЦІЛЬНИЙ ОБХІД (`attribution-sweep.ts`). `SOURCE_FILES`
 * — список, написаний руками, і він бачить лише записане в ньому: новий файл
 * із новим зовнішнім хостом проходив зеленим (так `api.datatourisme.fr` і
 * `data.gouv.fr` стояли в коді без рядка на сторінці). Обхід читає ВСІ
 * файли виробничих тек і вимагає, щоб кожен знайдений хост був в одному з
 * трьох кошиків: названий на сторінці; у `REFERENCE_HOSTS`; у `NOT_A_SOURCE`.
 * Список лишається: він несе «чому» на кожен файл, а обхід — «нічого не
 * пропущено». Один не замінює другого.
 *
 * 🔴 ВИНЯТОК ЦЕ РЯДОК ІЗ ПРИЧИНОЮ І МІСЦЕМ. `NOT_A_SOURCE` не приймає голого
 * хоста: кожен запис — пояснення (`why`) і файли, де цей хост справді
 * лишається не джерелом (`in`). Той самий хост у файлі поза `in` — знову
 * падіння: виняток закриває рядок, а не ім'я.
 */

// `__dirname`, а не `import.meta`: Playwright компілює специфікації в CommonJS.
const ROOT = resolve(__dirname, "..", "..", "..", "..");

/**
 * Де в коді визначені зовнішні джерела, що потрапляють на сторінки або в
 * браузер читача. Одна причина на файл.
 */
const SOURCE_FILES: ReadonlyArray<{ path: string; why: string }> = [
  {
    path: "apps/web/src/lib/sources.ts",
    why: "per-record sources: OSM, DATAtourisme, EEA bathing water, EEA air quality",
  },
  {
    path: "apps/web/src/lib/map-sources.ts",
    why: "basemap tiles the browser loads",
  },
  {
    path: "apps/web/src/data/satellite-sources.json",
    why: "national orthophoto services the browser loads",
  },
  {
    path: "apps/web/src/lib/webcams.ts",
    why: "webcam frames the browser loads",
  },
  // 🔴 Доданий 02.11.2026, бо список пропустив справжнє. #402 прибрав
  // побудову URL кадра з `webcams.ts` (умови Windy забороняють будувати їх
  // поза API), і `imgproxy.windy.com` зник із корпусу — сторінка лишилася
  // називати хост, якого в корпусі нема, і сторож назвав це зайвим
  // посиланням. Хост нікуди не подівся: браузер читача ходить саме туди.
  // Політика безпеки — той перелік, який не може збрехати про це, бо її
  // порушення видно в консолі браузера: будь-який третій хост, до якого
  // браузер має право звернутися, стоїть у ній поіменно.
  {
    path: "apps/web/scripts/security-headers.mjs",
    why: "every third-party host the reader\u2019s browser is allowed to contact (CSP)",
  },
  { path: "scripts/windy/fetch-webcams.mjs", why: "webcam metadata import" },
  {
    path: "apps/web/src/lib/warnings.ts",
    why: "MeteoAlarm link the licence dictates",
  },
  {
    path: "scripts/meteoalarm/fetch-warnings.mjs",
    why: "weather warning feeds",
  },
  {
    path: "scripts/meteoalarm/zone-coverage.mjs",
    why: "geometry that decides which warnings concern which campsite",
  },
  {
    path: "scripts/meteoalarm/resolve-areas.mjs",
    why: "the same geometry sources, by scheme",
  },
  { path: "scripts/edo/fetch-drought.mjs", why: "drought layer" },
  {
    path: "apps/web/src/data/drought.json",
    why: "drought layer as shipped (meta)",
  },
  { path: "scripts/effis/fetch-wildfires.mjs", why: "wildfire layer" },
  {
    path: "apps/web/src/data/wildfires.json",
    why: "wildfire layer as shipped (meta)",
  },
  {
    path: "scripts/datatourisme/fetch-regions.mjs",
    why: "DATAtourisme regional files, discovered through data.gouv.fr",
  },
  {
    path: "apps/api/src/air/source.ts",
    why: "EEA air quality: the hourly file and the model service",
  },
  { path: "apps/api/src/bathing/source.ts", why: "EEA bathing water service" },
  {
    path: "apps/api/src/fuel/stations.ts",
    why: "per-station fuel prices, three ministries",
  },
  {
    path: "apps/web/src/lib/route-services.ts",
    why: "the public pages those prices are credited to",
  },
  { path: "scripts/fuel/fetch-fuel-prices.mjs", why: "country fuel averages" },
  {
    path: "apps/web/src/data/fuel-prices.json",
    why: "country fuel averages as shipped (meta)",
  },
  { path: "apps/api/src/osm/compute-context.ts", why: "elevation and relief" },
  {
    path: "scripts/osm-pipeline/geofabrik-url.sh",
    why: "OSM country extracts",
  },
  {
    path: "scripts/osm-pipeline/load-boundaries.sh",
    why: "Natural Earth boundaries",
  },
];

/**
 * Виняток: хост, який знайдено в коді і який НЕ є джерелом даних для
 * читача. `why` — чому; `in` — префікси шляхів, де саме він таким є.
 * Той самий хост у файлі поза `in` не прощається.
 */
interface Exception {
  why: string;
  in: readonly string[];
  /**
   * 🔴 «Тимчасово, з умовою»: модуль (шлях без розширення), який написано, але
   * не підключено. Виняток діє, доки його ніхто не імпортує; щойно імпортує —
   * тест червоніє, і хост мусить дістати рядок на сторінці, а не лишитися тут.
   */
  dormantModule?: string;
}
const because = (why: string, ...where: string[]): Exception => ({
  why,
  in: where,
});
const dormant = (
  module: string,
  why: string,
  ...where: string[]
): Exception => ({ why, in: where, dormantModule: module });

/** Де `data/rental` і сторінки оренди посилаються на першоджерело того, що переказують. */
const RENTAL = [
  "apps/web/src/data/rental/",
  "apps/web/src/app/camper-rental/",
  "apps/web/src/components/rental-checklist.tsx",
] as const;

/**
 * 🔴 Причина називає, ЩО САМЕ це за першоджерело, а не просто «зовнішнє
 * посилання»: різниця між цими формулюваннями через пів року — вся різниця.
 * Чотири різновиди, перевірені по `FactSource` кожного хоста в `countries.ts`,
 * `thresholds.ts`, `rental-checklist.tsx` і `camper-rental/page.tsx`.
 */
const LAW =
  "the text of the law that is the origin of a norm the camper-rental page retells in its own words; cited as the source of the rule, nothing is fetched or reproduced";
const AUTHORITY =
  "the public body that issues or administers a rule (toll, vignette, emission zone, winter tyres, overnight stay) which the camper-rental page retells in its own words; cited as the origin of the norm, nothing is fetched or reproduced";
const OPERATOR =
  "the operator’s own published tariff or vehicle classification, which the camper-rental page retells in its own words; cited as the origin of the rule, no figures are fetched or reproduced";
const CONTEXT =
  "the national body the camper-rental page names beside a general statement about the country made in our own words (not a rule, not a dataset); a link to where to read further, nothing is fetched";
const cited = (why: string, ...hosts: string[]): Record<string, Exception> =>
  Object.fromEntries(hosts.map((h) => [h, because(why, ...RENTAL)]));

/**
 * Хости, знайдені в коді, які не є джерелами даних читача, і чому.
 * Кожен — назване рішення, а не мовчазний пропуск.
 */
const NOT_A_SOURCE: Readonly<Record<string, Exception>> = {
  // ── ідентифікатори й простори імен, а не звернення ──
  "standards.iso.org": because(
    "an ISO schema identifier inside the query string of IGN France’s catalogue URL",
    "apps/web/src/data/satellite-sources.json",
  ),
  "opengis.net": because(
    "the OGC XML namespace in the WFS request fetch-wildfires.mjs builds; nothing is fetched from it",
    "scripts/effis/fetch-wildfires.mjs",
  ),
  "schema.org": because(
    "the JSON-LD vocabulary identifier in structured data and in its checker; a name, not an endpoint",
    "apps/web/src/",
    "scripts/seo/",
  ),
  "w3.org": because(
    "an XML namespace and a specification reference in the sitemap writer and its schemas",
    "apps/web/src/lib/sitemap.ts",
    "scripts/seo/schemas/",
  ),
  "sitemaps.org": because(
    "the sitemap XML namespace in the sitemap writer and its schemas",
    "apps/web/src/lib/sitemap.ts",
    "scripts/seo/schemas/",
  ),
  "ietf.org": because(
    "an RFC reference inside the sitemap XSD’s documentation",
    "scripts/seo/schemas/",
  ),
  "apple.com": because(
    "the DTD identifier of a property list in an ops script",
    "scripts/ops/pull-security-log.sh",
  ),
  "data.datatourisme.fr": because(
    "the prefix of DATAtourisme object identifiers, quoted in a comment about the tariff entity; nothing is fetched from it",
    "apps/api/src/entities/spot-tariff.entity.ts",
  ),

  // ── фікстури самоперевірок і приклади в коментарях ──
  "meteo.hr": because(
    "a CAP sender string, quoted in a comment and used as a self-test fixture; nothing is fetched from it",
    "scripts/meteoalarm/fetch-warnings.mjs",
    "apps/web/src/lib/warning-types.ts",
  ),
  "skaping.com": because(
    "a camera operator’s URL used as a self-test fixture in fetch-webcams.mjs; nothing is fetched from it",
    "scripts/windy/fetch-webcams.mjs",
  ),
  "e.com": because(
    "a self-test fixture for the internal-anchor checker",
    "scripts/ci/check-internal-anchors.mjs",
  ),
  "x.github.io": because(
    "a self-test fixture for the map-asset checker, which refuses github.io hosts",
    "scripts/ci/check-map-assets.mjs",
  ),
  "y.github.io": because(
    "a self-test fixture for the map-asset checker, which refuses github.io hosts",
    "scripts/ci/check-map-assets.mjs",
  ),
  "protomaps.github.io": because(
    "named so the map-asset checker can REFUSE it (GitHub Pages terms forbid commercial use); never loaded",
    "scripts/ci/check-map-assets.mjs",
  ),
  "mt1.google.com": because(
    "a Google tile URL the satellite-licence checker exists to REFUSE, written as a self-test fixture; never loaded",
    "scripts/ci/check-satellite-licences.mjs",
  ),
  "camping-verif-alpha.fr": because(
    "an invented campsite website in the reconcile-threshold verifier’s fixture data",
    "apps/api/src/spots/verify-reconcile-threshold.ts",
  ),
  "camping-verif-beta.fr": because(
    "an invented campsite website in the reconcile-threshold verifier’s fixture data",
    "apps/api/src/spots/verify-reconcile-threshold.ts",
  ),
  "camping-verif-gamma.fr": because(
    "an invented campsite website in the reconcile-threshold verifier’s fixture data",
    "apps/api/src/spots/verify-reconcile-threshold.ts",
  ),
  "autre-camping-beta.fr": because(
    "an invented campsite website in the reconcile-threshold verifier’s fixture data",
    "apps/api/src/spots/verify-reconcile-threshold.ts",
  ),
  evil: because(
    "an attacker-controlled redirect target quoted in comments about open-redirect defences",
    "apps/web/src/components/account-forms.tsx",
    "apps/web/src/lib/return-path.ts",
  ),
  "evil.com": because(
    "an attacker-controlled redirect target quoted in comments about open-redirect defences",
    "apps/web/src/lib/rich-text.ts",
  ),
  "camptribe.euab": because(
    "a malformed own-domain string quoted in a comment about URL joining",
    "apps/web/src/lib/jsonld.ts",
  ),
  user: because(
    "the userinfo part of a URL quoted in a comment about stripping credentials from logged paths",
    "apps/api/src/telemetry/not-found.rules.ts",
  ),

  // ── інфраструктура й збірка: нічого не доходить до читача ──
  "cloudflare.com": because(
    "Cloudflare’s published proxy IP ranges, read by the firewall script to allow only the proxy; no data reaches a page",
    "infra/bin/camptribe-firewall",
  ),
  "github.com": because(
    "our own repository: pull-request links in CI and release assets of our own OSM extracts, whose underlying data (OpenStreetMap, Geofabrik) is named on the page",
    "scripts/ci/check-dependabot-prs.mjs",
    "scripts/osm-pipeline/import-release.mjs",
    "infra/bin/",
    ".github/",
    "scripts/security/codeql-dismissals.json",
  ),
  "api.github.com": because(
    "the release listing of our own repository, read by the OSM import to find the extracts our pipeline published; the data itself is named on the page",
    "scripts/osm-pipeline/import-release.mjs",
  ),
  "build.protomaps.com": because(
    "a measurement script that reads only the directories of a PMTiles archive by range request to size a possible basemap; nothing it reads reaches a page. If that build ever ships as the basemap, this host moves onto the page",
    "scripts/tiles/measure-pmtiles.mjs",
  ),

  // ── партнерські мережі: читач отримує посилання, не дані ──
  "awin.com": because(
    "an affiliate network our outbound partner links are tagged for (marked sponsored); the reader gets a link, no data is read from it",
    "apps/web/src/lib/affiliate.ts",
  ),
  "awin1.com": because(
    "the tracking host of the Awin affiliate network, as a recognised outbound-link host; no data is read from it",
    "apps/web/src/lib/affiliate.ts",
  ),
  "impact.com": because(
    "an affiliate network our outbound partner links are tagged for (marked sponsored); the reader gets a link, no data is read from it",
    "apps/web/src/lib/affiliate.ts",
  ),
  "cj.com": because(
    "an affiliate network our outbound partner links are tagged for (marked sponsored); the reader gets a link, no data is read from it",
    "apps/web/src/lib/affiliate.ts",
  ),
  "booking.com": because(
    "a booking partner our outbound links are tagged for (marked sponsored); the reader gets a link, no data is read from it",
    "apps/web/src/lib/affiliate.ts",
  ),
  "acsi.eu": because(
    "a campsite-booking partner our outbound links are tagged for (marked sponsored); the reader gets a link, no data is read from it",
    "apps/web/src/lib/affiliate.ts",
  ),

  // ── сторінки оренди: першоджерело норми, яку сторінка переказує ──
  ...cited(
    LAW,
    "eur-lex.europa.eu",
    "boe.es",
    "normattiva.it",
    "diariodarepublica.pt",
    "gesetze-im-internet.de",
  ),
  ...cited(
    AUTHORITY,
    "umweltbundesamt.de",
    "certificat-air.gouv.fr",
    "mit.gov.it",
    "dgt.es",
    "mitma.gob.es",
    "rijksoverheid.nl",
    "milieuzones.nl",
    "oesterreich.gv.at",
    "policija.si",
    "transportstyrelsen.se",
    "fstyr.dk",
    "rsa.ie",
    "naturvardsverket.se",
    "economy-finance.ec.europa.eu",
  ),
  ...cited(
    OPERATOR,
    "toll-collect.de",
    "autoroutes.fr",
    "autostrade.it",
    "asfinag.at",
    "hac.hr",
    "evinjeta.dars.si",
    "infraestruturasdeportugal.pt",
    "storebaelt.dk",
    "tii.ie",
  ),
  ...cited(CONTEXT, "croatia.hr", "turismodeportugal.pt", "naturstyrelsen.dk"),

  // ── перехід #398 завершено ──
  //
  // 🔴 ЩО ТУТ БУЛО. Доки #398 не злито, `gisco-services.ec.europa.eu` і
  // `nominatim.openstreetmap.org` стояли як `transitional('#398')` — виняток,
  // якому дозволено бути мертвим, бо дерево ще не те. #398 злито в main, і
  // замір на злитому дереві показав: GISCO не зустрічається в коді жодного
  // разу, Nominatim — рівно в одному файлі. Тому запис GISCO видалено, а
  // Nominatim став звичайним винятком: тепер мертвим він бути не може, і
  // сторож падає, щойно скрипт перестане його читати.
  "nominatim.openstreetmap.org": because(
    "the query service the zone script calls once per run to fetch Croatia’s county outlines; the geometry is OpenStreetMap data, whose licence and credit are on the page, and the reader’s browser never contacts this host",
    "scripts/meteoalarm/osm-hr-counties.mjs",
  ),

  // ── CAMP-427: сайти самих прокатних компаній ──
  //
  // 🔴 ЧОМУ ЦЕ НЕ РЯДОК НА СТОРІНЦІ АТРИБУЦІЇ. Сторінка атрибуції називає
  // ДЖЕРЕЛА ДАНИХ і ліцензії, за якими ми маємо право їх показувати. Тут
  // інше: це сайт компанії, з якого прочитано факти ПРО НЕЇ САМУ, і
  // атрибуція до нього стоїть ПОРЯДУ З ФАКТОМ — на сторінці провайдера
  // друкується точна адреса сторінки й дата перевірки. Це суворіше за
  // один рядок у спільному переліку, а не слабше.
  //
  // Усі п'ятнадцять хостів приходять з одного файлу — засіву каталогу.

  // ── CAMP-427: сайти самих прокатних компаній ──
  //
  // 🔴 ЧОМУ ЦЕ НЕ РЯДОК НА СТОРІНЦІ АТРИБУЦІЇ. Та сторінка називає
  // ДЖЕРЕЛА ДАНИХ і ліцензії, за якими ми маємо право їх показувати.
  // Тут інше: сайт компанії, з якого прочитано факти ПРО НЕЇ САМУ, і
  // атрибуція стоїть ПОРЯД ІЗ ФАКТОМ — на сторінці провайдера
  // друкується точна адреса сторінки й дата перевірки. Це суворіше за
  // один рядок у спільному переліку, а не слабше.
  //
  // 🔴 ПЕРЕЛІК ВИВЕДЕНО З ФАЙЛІВ ЗАСІВУ, а не писаний рукою: компаній
  // десятки, і рукописний список розійшовся б із даними тихо. Коли
  // засів міняється, цей блок треба перебудувати — а якщо забути,
  // скаже тест «виняток не мертвий».
  "autogrupp.ee": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "avtodomi-stipic.si": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "blacksheep-van.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "camperdanmark.dk": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "camperisimo.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "cross-rent.de": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "dimarrent.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "drm.de": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "favoritrent.lv": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "fr.trustpilot.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers.seed.json",
  ),
  "g.co": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "gocamp.lt": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "greencamper.ro": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "guruloluxus.hu": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "help.indiecampers.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers.seed.json",
  ),
  "help.paulcamper.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers.seed.json",
  ),
  "hisanakolesih.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "indiecampers.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "joy2wander.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "jysk-caravan.dk": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "kamperi.hr": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "karavan.sk": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "karavan365.sk": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "karavanea.sk": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "karavany-krejci.cz": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "keliaujukemperiu.lt": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "leana.lv": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "mcrent.de": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers.seed.json",
  ),
  "mcrent.eu": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "paulcamper.de": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "premiumlakoauto.hu": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "puikuskemperiai.lt": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "rent-easy.de": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "rental-alliance.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers.seed.json",
  ),
  "reslgroup.cz": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "roadsurfer.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "touringcars.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),
  "trustpilot.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "vanbaltic.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "vpt-caravan.hu": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "webcamper.lu": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "xcampers.bg": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/providers-local.seed.json",
  ),
  "yescapa.com": because(
    "the rental company\u2019s own site, from which that company\u2019s own facts were read; attribution is per row on the provider page, where the exact page and the date it was checked stand next to the fact, which is stricter than one line in a global list",
    "apps/api/src/rental/provider-countries.json",
    "apps/api/src/rental/providers.seed.json",
  ),

  // ── написано, але не підключено: тимчасово, з умовою ──
  "api.datatourisme.fr": dormant(
    "apps/api/src/datatourisme/api-v1",
    "DATAtourisme catalogue API v1: the module is written but not wired to any importer (CAMP-181), so nothing is read from this host today. When it is wired, this host MUST get a line on the attribution page and leave this list",
    "apps/api/src/datatourisme/api-v1.ts",
  ),
};

/**
 * Хости, на які сторінка МОЖЕ посилатися, не маючи їх у коді: тексти
 * ліцензій, бібліотеки, каталожні сторінки джерел, які самі в коді стоять
 * іншим хостом. Кожен — із причиною.
 */
const REFERENCE_HOSTS: Readonly<Record<string, string>> = {
  "opendatacommons.org": "ODbL licence text",
  "creativecommons.org": "CC BY 4.0 licence text",
  "etalab.gouv.fr": "Licence Ouverte 2.0 text",
  "dati.gov.it": "IODL 2.0 text",
  "datos.gob.es": "datos.gob.es general conditions of reuse",
  "cartes.gouv.fr":
    "IGN France’s conditions of use, which its service points to",
  "openfontlicense.org": "SIL Open Font License text",
  "maplibre.org":
    "the map library (BSD-3-Clause), a dependency rather than a data source",
  "openmaptiles.org":
    "the tile schema, named by the tile provider’s own credit line",
  "openfreemap.org":
    "the tile provider’s home page; its tiles come from tiles.openfreemap.org, which is in code",
  "spacedata.copernicus.eu":
    "the Copernicus DEM catalogue record; the data reaches us through api.open-meteo.com, which is in code",
  "open-meteo.com":
    "Open-Meteo’s home page and terms; the endpoint api.open-meteo.com is in code",
  "naturalearthdata.com":
    "Natural Earth’s home page; its files come from naciscdn.org and raw.githubusercontent.com, which are in code",
  "datatourisme.fr": "DATAtourisme’s home page, which is also in code",
  "eea.europa.eu": "the EEA Datahub and legal notice, which are also in code",
  "openstreetmap.org": "OpenStreetMap, which is also in code",
  "meteoalarm.org": "MeteoAlarm’s terms, which are also in code",
  "windy.com": "Windy’s terms, which is also in code",
};

/** Чи закриває виняток цей хост у цьому файлі (а не просто це ім'я). */
const isExcepted = (host: string, file: string) =>
  Object.hasOwn(NOT_A_SOURCE, host) &&
  NOT_A_SOURCE[host].in.some((p) => file.startsWith(p));

/** Хости джерел, і в яких файлах кожен стоїть. */
function hostsInCode(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const f of SOURCE_FILES) {
    const text = readFileSync(join(ROOT, f.path), "utf8");
    for (const m of text.matchAll(HOST)) {
      const host = normalise(m[1]);
      if (isLocalOrFixture(host) || isExcepted(host, f.path)) continue;
      const files = found.get(host) ?? new Set<string>();
      files.add(f.path);
      found.set(host, files);
    }
  }
  return found;
}

/** Хости зовнішніх посилань відданої сторінки. */
function hostsOnPage(html: string): Set<string> {
  const hosts = new Set<string>();
  for (const m of html.matchAll(/\bhref="([^"]+)"/g)) {
    const href = m[1].replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(href)) continue;
    hosts.add(normalise(new URL(href).hostname));
  }
  return hosts;
}

/**
 * Чи покриває хост сторінки хост із коду — лише рівність (після `www.`).
 * Батьківський домен НЕ рахується: `ec.europa.eu` на сторінці не є
 * рядком ані про GISCO, ані про Weekly Oil Bulletin, хоч обидва під ним.
 */
const covers = (pageHost: string, codeHost: string) => pageHost === codeHost;

test.describe("attribution: every source in code is on the page, and nothing else is", () => {
  const html = seededHtml("attribution");
  const page = hostsOnPage(html);
  const code = hostsInCode();

  test("the corpus is not empty and the files exist", () => {
    expect(code.size, "no source hosts found in SOURCE_FILES").toBeGreaterThan(
      10,
    );
    expect(
      page.size,
      "no external links on the attribution page",
    ).toBeGreaterThan(5);
  });

  test("every source host in code has a link on the attribution page", () => {
    const missing = [...code.entries()]
      .filter(([host]) => ![...page].some((p) => covers(p, host)))
      .map(([host, files]) => `${host}  ←  ${[...files].join(", ")}`);
    expect(
      missing,
      `sources in code with no line on the attribution page (${missing.length} of ${code.size}):\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  test("every external link on the page is a source in code or a named reference", () => {
    const stray = [...page].filter(
      (h) => !code.has(h) && !(h in REFERENCE_HOSTS),
    );
    expect(
      stray,
      `attribution page links to hosts that are neither in code nor in REFERENCE_HOSTS: ${stray.join(", ")}`,
    ).toEqual([]);
  });

  test("a reference host that is also in code is not a dead allowance", () => {
    // 🔴 REFERENCE_HOSTS that are "also in code" must really be in code,
    // or the comment beside them is a falsehood that would outlive the code.
    const claimed = Object.entries(REFERENCE_HOSTS)
      .filter(([, why]) => /also in code/.test(why))
      .map(([h]) => h)
      .filter((h) => !code.has(h));
    expect(
      claimed,
      `REFERENCE_HOSTS claims these are in code and they are not: ${claimed.join(", ")}`,
    ).toEqual([]);
  });

  test("the notices the licences dictate are in the visible text", () => {
    const text = visibleText(html);
    // MeteoAlarm terms clause 5: the source for information spanning countries.
    expect(text).toContain("EUMETNET – MeteoAlarm");
    // CEMS terms: the notice for modified data, with a four-digit year.
    expect(text).toMatch(
      /Contains modified Copernicus Emergency Management Service information \d{4}/,
    );
    // Windy’s terms: the credit the components print.
    expect(text).toContain("Webcams provided by windy.com");
    // IGN Spain: the attribution string read from the service.
    expect(text).toContain("CC BY 4.0 scne.es");
  });

  test("the registry and the seeded text carry the same version", () => {
    const seeded = SEEDED.find((d) => d.slug === "attribution");
    expect(seeded?.version).toBe(legalPage("attribution")?.version);
    expect(seeded?.effectiveFrom).toBe(legalPage("attribution")?.effectiveFrom);
  });
});

/** Теки, яких обхід не читає, і чому. Кожна — причина, а не мовчання. */
const NOT_SWEPT: Readonly<Record<string, string>> = {
  docs: "prose documentation for people; none of it runs on the site or reaches a reader",
  "test-results": "Playwright output written by test runs, not source",
  scratchpad:
    "untracked local scratch space on a developer machine; not in git",
};

/**
 * 🔴 СУЦІЛЬНИЙ ОБХІД. Не користується `SOURCE_FILES`: корпус — усе, що лежить
 * у виробничих теках (`SWEEP_ROOTS`). Кожен знайдений хост — у кошику:
 * названий на сторінці, `REFERENCE_HOSTS` або `NOT_A_SOURCE`; інакше падіння
 * з назвою хоста й файлів.
 */
test.describe("attribution: a sweep of all production code, independent of SOURCE_FILES", () => {
  const html = seededHtml("attribution");
  const page = hostsOnPage(html);
  const sweep = sweepHosts(ROOT);

  /** Кошики: знаменник — усі хости, які знайшов обхід. */
  const buckets = () => {
    const named: string[] = [];
    const reference: string[] = [];
    const excepted: string[] = [];
    const uncovered: string[] = [];
    for (const [host, files] of sweep.hosts) {
      if (page.has(host)) named.push(host);
      else if (Object.hasOwn(REFERENCE_HOSTS, host)) reference.push(host);
      else {
        const outside = [...files].filter((f) => !isExcepted(host, f));
        if (outside.length === 0) excepted.push(host);
        else uncovered.push(`${host}  ←  ${outside.join(", ")}`);
      }
    }
    return { named, reference, excepted, uncovered };
  };

  test("the corpus is the code: files read, hosts found, and every SOURCE_FILES entry is inside it", () => {
    expect(sweep.files.size, "the sweep read almost nothing").toBeGreaterThan(
      400,
    );
    expect(sweep.hosts.size, "the sweep found almost no hosts").toBeGreaterThan(
      80,
    );
    const outside = SOURCE_FILES.map((f) => f.path).filter(
      (p) => !sweep.files.has(p),
    );
    expect(
      outside,
      `SOURCE_FILES lists files the sweep does not read: ${outside.join(", ")}`,
    ).toEqual([]);
    for (const r of SWEEP_ROOTS) {
      expect(
        sweepHosts(ROOT, [r]).files.size,
        `sweep root ${r} is empty or missing`,
      ).toBeGreaterThan(0);
    }
  });

  test("a new top-level directory or app is a decision, not an oversight", () => {
    // 🔴 Обхід читає лише `SWEEP_ROOTS`. Нова тека з кодом (`packages/…`,
    // `apps/mobile`) без рядка тут була б сліпою зоною — тож вона падає, поки
    // її не внесено в корені або не названо тут із причиною.
    const covered = (rel: string) =>
      SWEEP_ROOTS.some((r) => r === rel || r.startsWith(`${rel}/`));
    const dirs = (rel: string) =>
      readdirSync(join(ROOT, rel), { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            e.name !== "node_modules" &&
            (!e.name.startsWith(".") || covered(e.name)),
        )
        .map((e) => (rel ? `${rel}/${e.name}` : e.name));
    const unclassified = [...dirs(""), ...dirs("apps")]
      .filter((d) => d !== "apps")
      .filter((d) => !covered(d) && !Object.hasOwn(NOT_SWEPT, d));
    expect(
      unclassified,
      `directories that are neither swept nor named in NOT_SWEPT with a reason: ${unclassified.join(", ")}`,
    ).toEqual([]);
    const bare = Object.entries(NOT_SWEPT)
      .filter(([, why]) => why.trim().split(/\s+/).length < 4)
      .map(([d]) => d);
    expect(
      bare,
      `NOT_SWEPT entries without a reason: ${bare.join(", ")}`,
    ).toEqual([]);
  });

  test("every host the sweep finds is named on the page, a reference, or a stated exception", () => {
    const b = buckets();
    test.info().annotations.push({
      type: "denominator",
      description: `${sweep.files.size} files, ${sweep.hosts.size} hosts: ${b.named.length} named on the page, ${b.reference.length} reference, ${b.excepted.length} excepted, ${b.uncovered.length} uncovered`,
    });
    expect(
      b.uncovered,
      `external hosts in production code that are not on the attribution page, not a reference and not an exception ` +
        `(${b.uncovered.length} of ${sweep.hosts.size}). Name the source on the page, or add it to NOT_A_SOURCE with a reason and a place:\n  ${b.uncovered.join("\n  ")}`,
    ).toEqual([]);
  });

  test("an exception without a reason is not an exception", () => {
    const bare = Object.entries(NOT_A_SOURCE)
      .filter(
        ([, e]) =>
          typeof e.why !== "string" ||
          e.why.trim().split(/\s+/).length < 5 ||
          e.in.length === 0 ||
          e.in.some((p) => !p.trim()),
      )
      .map(([h]) => h);
    expect(
      bare,
      `exceptions with no real reason (5+ words) or no place: ${bare.join(", ")}`,
    ).toEqual([]);
    const bareRef = Object.entries(REFERENCE_HOSTS)
      .filter(
        ([, why]) =>
          typeof why !== "string" || why.trim().split(/\s+/).length < 3,
      )
      .map(([h]) => h);
    expect(
      bareRef,
      `REFERENCE_HOSTS with no real reason: ${bareRef.join(", ")}`,
    ).toEqual([]);
  });

  test("an exception is not dead and not shadowing a line on the page", () => {
    const dead = Object.entries(NOT_A_SOURCE)
      .filter(([h]) => !sweep.hosts.has(h))
      .map(([h]) => h);
    expect(
      dead,
      `exceptions for hosts the sweep no longer finds (delete them): ${dead.join(", ")}`,
    ).toEqual([]);
    const shadowing = Object.keys(NOT_A_SOURCE).filter((h) => page.has(h));
    expect(
      shadowing,
      `exceptions for hosts that ARE on the page — remove the row, or deleting the page link would stay green: ${shadowing.join(", ")}`,
    ).toEqual([]);
  });

  test("a dormant exception ends the moment its module is imported", () => {
    const importers: string[] = [];
    for (const [host, e] of Object.entries(NOT_A_SOURCE)) {
      if (!e.dormantModule) continue;
      const base = e.dormantModule.split("/").pop() as string;
      // 🔴 МЕЖА, НАЗВАНА В КОДІ: ловляться лише СТАТИЧНІ імпорти — `from '…'`,
      // `require('…')`, `import('…')` з рядковим літералом (розширення
      // `.js`/`.ts`/`.mjs` зрізається). `import(змінна)`, `require(join(__dirname,
      // 'api-v1'))` і підстановка імені під час виконання лишаються поза цим
      // тестом: статично їх не впіймати.
      for (const f of sweep.files) {
        if (f.startsWith(e.dormantModule)) continue;
        // `from './api-v1'`, `require('../datatourisme/api-v1')`, `import('./api-v1')`
        for (const m of readFileSync(join(ROOT, f), "utf8").matchAll(
          /(?:from|require\(|import\()\s*['"]([^'"]+)['"]/g,
        )) {
          if (
            (m[1].split("/").pop() as string).replace(/\.[cm]?[jt]sx?$/, "") ===
            base
          )
            importers.push(`${host} ← imported by ${f}`);
        }
      }
    }
    expect(
      importers,
      `a module whose host is excepted as "not wired" is now imported; give the host a line on the attribution page and delete the exception:\n  ${importers.join("\n  ")}`,
    ).toEqual([]);
  });

  test("the walker finds a new host wherever it lies, and skips what it should", () => {
    const dir = mkdtempSync(join(tmpdir(), "attribution-sweep-"));
    const put = (rel: string, body: string | Buffer) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    };
    try {
      put(
        "apps/api/src/fresh/feature.ts",
        "const U = 'https://fresh-source.eu/v1';",
      );
      put(
        "scripts/meteoalarm/osm-hr-counties.mjs",
        "export const U = 'https://nominatim.openstreetmap.org/lookup?osm_ids=R1';",
      );
      put(
        "apps/web/src/data/x.json",
        '{"a":"https://www.Shouting-Host.eu/path"}',
      );
      put(
        "scripts/sentence.mjs",
        "// see https://sentence-end.eu. And https://ported.eu:8443/x",
      );
      put(
        "apps/api/src/fresh/feature.spec.ts",
        "const U = 'https://only-in-a-spec.eu';",
      );
      put(
        "apps/api/src/migrations/1-Seed.ts",
        "const U = 'https://only-in-a-migration.eu';",
      );
      put(
        "apps/api/node_modules/dep/index.js",
        "const U = 'https://only-in-a-dependency.eu';",
      );
      put(
        "apps/web/src/blob.bin",
        Buffer.concat([
          Buffer.from("https://only-in-a-binary.eu"),
          Buffer.from([0, 1, 2]),
        ]),
      );
      put(
        "apps/web/src/own.ts",
        "'http://localhost:3000' 'https://camptribe.eu/x' 'https://cms.camptribe.eu' 'https://example.com' 'https://a.example'",
      );
      const found = sweepHosts(dir);
      expect([...found.hosts.keys()].sort()).toEqual([
        "fresh-source.eu",
        "nominatim.openstreetmap.org",
        "ported.eu",
        "sentence-end.eu",
        "shouting-host.eu",
      ]);
      expect([
        ...(found.hosts.get("nominatim.openstreetmap.org") ?? []),
      ]).toEqual(["scripts/meteoalarm/osm-hr-counties.mjs"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
