// CAMP-28: staging -> camping_spots, as an upsert.
//
//   cd apps/api
//   npx ts-node src/osm/import-spots.ts <country-code> [staging-table]
//   npx ts-node src/osm/import-spots.ts SI
//
// Run it twice on the same data and the row count must not move. That is
// the acceptance criterion of the card, and it is the whole reason this is
// an upsert keyed on the OSM id rather than an insert.
//
// Two things this deliberately never writes:
//
//   slug             assigned once, on first insert. If OSM renames a
//                    campsite the URL stays put - a slug that follows the
//                    name would break every link and search ranking the
//                    page has earned (CAMP-87).
//
//   owner_overrides  belongs to the campsite owner (CAMP-86). A weekly job
//                    that overwrites it would quietly erase their work.

import 'dotenv/config';
import { Client } from 'pg';
import {
  mapAmenities,
  mapContact,
  mapOvernight,
  mapSpotType,
  OsmTags,
} from './tag-mapping';
import { isEuMemberState } from './eu';
import { foldToAscii } from '../spots/canonical';
import { correctRegion, isKnownRegion } from './region-names';
import {
  loadDateVerdict,
  mergedRecord,
  readRecordAge,
  recentShare,
  RECENT_WINDOW_HOURS,
  type RecordAge,
  type RecordAgeProblem,
  type RecordEdit,
} from './record-age';

const COUNTRY = (process.argv[2] ?? '').toUpperCase();
const TABLE = process.argv[3] ?? 'osm_camping_staging';
const DB_URL =
  process.env.DATABASE_URL ?? 'postgres://localhost:5432/camptribe_dev';

/** True only when this file is run directly, not when a test imports it. */
const RUN_DIRECTLY = require.main === module;

if (RUN_DIRECTLY && !/^[A-Z]{2}$/.test(COUNTRY)) {
  console.error(
    'Usage: import-spots.ts <ISO-3166-1 alpha-2 country> [staging-table]\n' +
      '\n' +
      'The country is an argument, not a tag: only 26 of 448 Slovenian\n' +
      'campsites carry addr:country, and we import one country extract at a\n' +
      'time anyway. Reading it from the data would leave 94% of rows blank.',
  );
  process.exit(1);
}

/** Metres within which two identically named sites are taken to be one. */
const DUPLICATE_RADIUS_M = 200;

/** Rough metres between two WKT points. Fine at this scale. */
function metresApart(a: string, b: string): number {
  const p = (w: string) => {
    const m = /POINT\s*\(([-\d.]+)\s+([-\d.]+)\)/.exec(w);
    return m ? { lon: +m[1], lat: +m[2] } : null;
  };
  const x = p(a);
  const y = p(b);
  if (!x || !y) return Infinity;
  const dLat = (y.lat - x.lat) * 111_320;
  const dLon =
    (y.lon - x.lon) *
    111_320 *
    Math.cos(((x.lat + y.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/**
 * 🔴 One campsite, two OSM objects.
 *
 * OSM commonly carries a campsite as a node AND as the way around its
 * perimeter, and our filter asks for both, so both arrive as separate
 * rows with different type_ids. Measured on Slovenia: 120 such pairs,
 * average 37 m apart — **51% of all rows were involved in a duplicate**.
 * Every listing page showed each site twice, and every count was inflated.
 *
 * The way wins, not the node: it carries the real footprint, which is
 * what the campsite page is meant to draw. The node's tags are merged in
 * underneath, because the two objects rarely carry the same tags and
 * throwing the node away wholesale would lose amenities.
 *
 * Unnamed sites are merged only under a much stricter rule — see
 * `mergeUnnamed` below.
 */
export function dedupe(rows: StagingRow[]): StagingRow[] {
  const byName = new Map<string, StagingRow[]>();
  const unnamed: StagingRow[] = [];
  const out: StagingRow[] = [];

  for (const row of rows) {
    const name = row.tags.name?.trim().toLowerCase();
    if (!name) {
      unnamed.push(row);
      continue;
    }
    const bucket = byName.get(name);
    if (bucket) bucket.push(row);
    else byName.set(name, [row]);
  }

  out.push(...mergeUnnamed(unnamed));

  for (const bucket of byName.values()) {
    const clusters: StagingRow[][] = [];
    for (const row of bucket) {
      const near = clusters.find((c) =>
        c.some(
          (o) => metresApart(o.point_wkt, row.point_wkt) <= DUPLICATE_RADIUS_M,
        ),
      );
      if (near) near.push(row);
      else clusters.push([row]);
    }

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        out.push(cluster[0]);
        continue;
      }
      // Ways (`w…`) and areas (`a…`) beat nodes (`n…`); between equals,
      // the richer tag set wins so the merge starts from the better row.
      //
      // 🔴 The osm_ref comparison is the important one, even though it
      // looks like a formality. Without it two equally-ranked rows are
      // ordered by whatever Postgres happened to return, which is not
      // guaranteed and does change — so the winner, and therefore the
      // slug, and therefore the published URL, would flip between runs.
      // Caught in testing: Camping Bled moved between `camping-bled` and
      // `camping-bled-2` on consecutive imports of identical data, which
      // is precisely the URL churn CAMP-87 forbids, happening silently
      // every Monday.
      const ranked = [...cluster].sort((a, b) => {
        const rank = (r: StagingRow) => (r.osm_ref.startsWith('n') ? 1 : 0);
        return (
          rank(a) - rank(b) ||
          Object.keys(b.tags).length - Object.keys(a.tags).length ||
          a.osm_ref.localeCompare(b.osm_ref)
        );
      });
      const [winner, ...losers] = ranked;
      for (const loser of losers) {
        for (const [k, v] of Object.entries(loser.tags)) {
          if (winner.tags[k] === undefined) winner.tags[k] = v;
        }
        // 🔴 CAMP-256: the tags above are a UNION, so the date is the newest
        // of the objects that contributed to it (see mergedRecord).
        winner.record = mergedRecord(winner.record, loser.record);
        adoptOutline(winner, loser);
      }
      out.push(winner);
    }
  }

  return out;
}

/** Unnamed sites merge only this close — a quarter of the named radius. */
const UNNAMED_DUPLICATE_RADIUS_M = 50;

/** `n123` is a node; `w456` and `a789` are both the traced outline. */
const isPolygon = (ref: string) => !ref.startsWith('n');

/**
 * Polygon beats node; between equals, the richer tag set wins; and when
 * those tie, osm_ref decides.
 *
 * 🔴 That last step is not tidiness. Two equal rows would otherwise be
 * separated by input order, which comes from Postgres and is not
 * guaranteed stable — so the same data could elect a different winner on
 * a later run and move a published URL.
 */
/**
 * 🔴 CAMP-352: скільки рядків справді мають контур — і чи кожен із них
 * тримає СВОЮ точку.
 *
 * CHECK міграції питає `ST_DWithin(outline, location, 0.0001)`, тобто
 * пропустить точку за ~11 м від ділянки. Наша побудова дає нуль:
 * `location` це `ST_PointOnSurface` тієї самої фігури, а `adoptOutline`
 * переносить точку разом із контуром. Будь-яке інше число означає, що
 * рядок зібрано з двох різних обʼєктів — помилка, яку CHECK пропустить,
 * бо його допуск ширший за нашу обіцянку.
 *
 * Читається з ТАБЛИЦІ й до COMMIT, з тієї ж причини, що й
 * assertStoredEditDates: перевірка входу не бачить підміни, зробленої
 * між входом і таблицею.
 */
export async function assertStoredOutlines(
  db: { query: (q: string, v?: unknown[]) => Promise<{ rows: unknown[] }> },
  startedAt: Date,
  country: string,
): Promise<number> {
  const r = (await db.query(
    `SELECT count(*) FILTER (WHERE outline IS NOT NULL) AS n,
            count(*) FILTER (WHERE outline IS NOT NULL
                               AND ST_Distance(outline, location) <> 0) AS off
       FROM camping_spots
      WHERE country = $1 AND last_seen_at = $2`,
    [country, startedAt],
  )) as { rows: { n: string; off: string }[] };
  const off = Number(r.rows[0]?.off ?? 0);
  if (off > 0) {
    throw new Error(
      `${off} rows carry an outline their own location is not on.\n` +
        'The migration CHECK allows 0.0001 degrees (~11 m); this import ' +
        'promises 0, because the point is ST_PointOnSurface of that same ' +
        'shape. A non-zero distance means the pair was assembled from two ' +
        'different objects.',
    );
  }
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * 🔴 CAMP-352. Контур переможця може лежати у програвшого.
 *
 * Переможця обирає `isPolygon`, а він питає про ПРЕФІКС:
 * `!ref.startsWith('n')`. Для контуру це інше питання, і відповідь інша.
 * `normalise-export.mjs:11`: `osmium export` віддає закритий way ДВІЧІ —
 * LineString під `w…` і полігон під `a…`, — а ранжування лишає полігон.
 * Отже вижилий `w…` це лінія: префікс «полігонний», контуру нема. Теги
 * ми обʼєднуємо, а геометрію досі ні, тож контур сусіда зникав мовчки.
 *
 * Виміряно 20.10.2026 на `camptribe_dev` (2 280 рядків staging): 44
 * кластери-дублікати, з них 0 втрачають контур — у подвійного викиду
 * теги однакові, і `localeCompare` віддає перемогу `a…`. Тобто на цьому
 * корпусі дефект не стріляє. Він структурний, а не статистичний: корпус
 * це одна країна з двадцяти семи, і наступна може мати `w…` з зайвим
 * тегом поруч із полігоном.
 *
 * 🔴 ТОЧКА ЙДЕ РАЗОМ ІЗ КОНТУРОМ. Міграція вимагає
 * `ST_DWithin(outline, location, 0.0001)` — близько 11 м, а сусідами тут
 * вважаються рядки за 50 м (без назви) і 200 м (з назвою). Узяти чужий
 * контур, лишивши свою точку, означало б із певністю впертись у власне
 * обмеження на вставці.
 *
 * 🔴 І САМЕ ТОМУ — ЛИШЕ В МЕЖАХ ОДНОГО РЕГІОНУ. `admin_region`,
 * `admin_country` і `raw_country` рахуються в staging-запиті з ТІЄЇ
 * САМОЇ точки, тож перенести точку означає перенести і їх. А вони — два
 * сегменти опублікованого URL (`/camping/{country}/{region}/{slug}`),
 * який CAMP-87 забороняє рухати. Коли регіон збігається, переїзд точки
 * не видно в URL: `osm_ref` і назва не змінились, отже slug той самий, а
 * шпилька лише переїхала НА ділянку. Коли не збігається — лишаємось без
 * контуру. Втратити обрис дешевше, ніж зрушити адресу сторінки.
 */
function adoptOutline(keep: StagingRow, drop: StagingRow): void {
  if (keep.outline_wkt || !drop.outline_wkt) return;
  if (keep.admin_region !== drop.admin_region) return;
  if (keep.admin_country !== drop.admin_country) return;
  keep.outline_wkt = drop.outline_wkt;
  keep.point_wkt = drop.point_wkt;
  keep.raw_country = drop.raw_country;
}

function betterRow(a: StagingRow, b: StagingRow): StagingRow {
  if (isPolygon(a.osm_ref) !== isPolygon(b.osm_ref)) {
    return isPolygon(a.osm_ref) ? a : b;
  }
  const byTags = Object.keys(b.tags).length - Object.keys(a.tags).length;
  if (byTags !== 0) return byTags < 0 ? a : b;
  return a.osm_ref.localeCompare(b.osm_ref) <= 0 ? a : b;
}

/**
 * 🔴 Unnamed duplicates: merged, on a much tighter radius.
 *
 * With no name, proximity alone cannot tell "one site mapped twice" from
 * "two pitches side by side", so the first version of this refused to
 * merge unnamed rows at all. Measuring the built pages showed the cost:
 * the most duplicate-looking pages on the whole site were pairs of
 * unnamed spots in one region — same heading, same breadcrumb, every
 * amenity unknown, differing only in coordinates.
 *
 * So the rule is tightened instead of dropped: unnamed rows merge within
 * 50 m, a quarter of the named radius.
 *
 * The first attempt also demanded that one row be a node and the other a
 * polygon. Measuring killed that idea: of the 54 unnamed pairs inside
 * 50 m, only 8 are node-vs-polygon. The dominant pattern is 39 pairs of
 * `a` against `w` — an area and the way it was built from, both emitted
 * by `osmium export`, 3 to 43 m apart and averaging 19 m. That is our own
 * pipeline producing the same outline twice, not two campsites.
 *
 * The "two pitches side by side" worry that motivated the original
 * caution was calibrated for the 200 m radius and does not survive here:
 * we filter `tourism=camp_site` and `caravan_site`, never
 * `tourism=camp_pitch`, so individual pitches are not in this data at
 * all, and two whole campsites 19 m apart are not a real arrangement.
 */
export function mergeUnnamed(rows: StagingRow[]): StagingRow[] {
  const out: StagingRow[] = [];
  const taken = new Set<number>();

  for (let i = 0; i < rows.length; i++) {
    if (taken.has(i)) continue;
    let winner = rows[i];
    // 🔴 CAMP-352. Якір сусідства — ОКРЕМО від збереженої точки.
    //
    // adoptOutline() рухає `winner.point_wkt` на точку програвшого, бо
    // цього вимагає CHECK міграції. Але цей самий цикл наступною
    // ітерацією міряє відстань ВІД переможця — і зсунута точка робить
    // сусідом того, хто сусідом не був.
    //
    // Заміряно 20.10.2026 на трьох безіменних рядках через 31 м і 31 м
    // (разом 62 м, тобто поза радіусом): порядок [w1,a2,a3] дав ОДИН
    // рядок, порядок [w1,a3,a2] — ДВА. Тобто кількість кемпінгів почала
    // залежати від `ORDER BY p.id`, а з нею й те, яка сторінка виживе.
    // Це дослівно нестабільність CAMP-39, через яку Camping Bled
    // перестрибував між `camping-bled` і `camping-bled-2`.
    //
    // Тому якір оновлюється ВЛАСНОЮ точкою переможця — до перенесення
    // контуру. Межа «безіменні зливаються в 50 м» тоді знову міряється
    // від реального обʼєкта, а не від місця, куди його перемістив
    // попередній крок.
    let anchor = winner.point_wkt;

    for (let j = i + 1; j < rows.length; j++) {
      if (taken.has(j)) continue;
      const other = rows[j];
      if (metresApart(anchor, other.point_wkt) > UNNAMED_DUPLICATE_RADIUS_M) {
        continue;
      }

      taken.add(j);
      const keep = betterRow(winner, other);
      const drop = keep === winner ? other : winner;
      for (const [k, v] of Object.entries(drop.tags)) {
        if (keep.tags[k] === undefined) keep.tags[k] = v;
      }
      // 🔴 CAMP-256: as in dedupe() — the merged row is dated by the newest
      // object it was built from.
      keep.record = mergedRecord(keep.record, drop.record);
      anchor = keep.point_wkt;
      adoptOutline(keep, drop);
      winner = keep;
    }

    out.push(winner);
  }

  return out;
}

/** Latin-ish slug. Falls back to the OSM id when a name yields nothing. */
/**
 * The campsite's own address segment.
 *
 * 🔴 CAMP-290: the fold lives in spots/canonical.ts and is shared with
 * `slugifyRegion`, because a campsite's address and the address of the
 * region it sits in are two segments of ONE URL. When the two had their
 * own copies of the same five lines, `Søby Strand Camping` became
 * `s-by-strand-camping` in both — but a change to one would have moved
 * only half the path.
 */
export function slugify(name: string | null, osmRef: string): string {
  const base = foldToAscii(name ?? '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return base || `spot-${osmRef}`;
}

/**
 * The upsert, kept as a named constant so a test can assert what it does
 * NOT contain. `slug` and `owner_overrides` must never appear in the DO
 * UPDATE clause - the first would break every earned URL when OSM renames
 * a site, the second would erase the campsite owner's corrections once a
 * week. Both are easy to add by accident and invisible once added.
 */
/**
 * Stamp the first disappearance of a campsite this import did not see.
 *
 * 🔴 A FOLDED TWIN IS NOT A MISSING CAMPSITE (CAMP-274).
 *
 * `osmium export` hands back a closed way TWICE — once as the line and
 * once as the area — and CAMP-253's normaliser collapses the pair,
 * keeping ONE identifier. So the other identifier stops appearing in
 * every later extract BY OUR OWN DESIGN.
 *
 * 844 such twins live in the table and 828 of them are now folded into
 * their partner through `spot_links`. Without the clause below, the next
 * import would read "not in the extract" as "gone from OSM" and stamp
 * them — measured on France: 2 287 rows would be marked, and among them
 *
 *   · 155 are folded secondaries. The redirect that sends a reader to
 *     the surviving page is built only for secondaries with
 *     missing_since IS NULL, so stamping them turns 155 working 301s
 *     into 410s — "this page is gone" about a campsite that is open.
 *   · 12 are primaries of a live link. When a primary goes missing the
 *     secondary stops being hidden, so twelve duplicate pages come back.
 *
 * 🔴 The clause asks about the PRIMARY, not just about being linked.
 * If the partner is itself gone, both really have disappeared and both
 * should be stamped — otherwise a closed campsite would keep one live
 * page forever, which is the opposite failure.
 */
export const MARK_GONE_SQL = `UPDATE camping_spots
    SET missing_since = $1
  WHERE country = $2
    AND osm_ref IS NOT NULL
    AND (last_seen_at IS NULL
         OR last_seen_at < $1::timestamptz - ($3 || ' hours')::interval)
    AND missing_since IS NULL
    AND NOT EXISTS (
      SELECT 1
        FROM spot_links l
        JOIN camping_spots pri ON pri.id = l.primary_id
       WHERE l.secondary_id = camping_spots.id
         AND l.unlinked_at IS NULL
         AND pri.missing_since IS NULL
    )
  RETURNING osm_ref`;

/**
 * 🔴 CAMP-352. Винесено з main() рівно для того, щоб це можна було
 * перевірити тестом.
 *
 * Мутація «брати контур за префіксом osm_ref, а не за типом геометрії»
 * вижила в матриці 20.10.2026 — найважливіший рядок імпорту не пінило
 * ніщо, бо запит жив усередині функції на 1100 рядків. Його ціна
 * названа тут же в коментарі: ST_Multi(LineString) = MULTILINESTRING і
 * відмова на typmod колонки.
 */
export const stagingSelectSql = (table: string) =>
  `WITH pts AS (
       SELECT s.*,
              CASE WHEN GeometryType(s.geom) = 'POINT'
                   THEN s.geom
                   ELSE ST_PointOnSurface(s.geom) END AS pt
         FROM "${table}" s
        WHERE s.id IS NOT NULL
     )
     SELECT p.id AS osm_ref,
            ST_AsText(p.pt) AS point_wkt,
            -- 🔴 CAMP-352. Контур беремо ЗА ТИПОМ ГЕОМЕТРІЇ, а не за
            -- префіксом osm_ref, і це не дрібниця. Картка вважала, що
            -- w... теж має контур; normalise-export.mjs:11 пояснює,
            -- чому ні: osmium export віддає закритий way ДВІЧІ — як
            -- LineString під w<id> і як Polygon під a<id>, — а
            -- ранжування лишає полігон. Отже w..., що вижив, це лінія.
            --
            -- Якби відбір ішов за префіксом, сюди потрапив би
            -- ST_Multi(LineString) = MULTILINESTRING і впав би на
            -- typmod колонки на 856 рядках.
            --
            -- ST_Multi обовʼязковий: колонка оголошена MultiPolygon, і
            -- звичайний POLYGON вона не прийме.
            CASE WHEN GeometryType(p.geom) IN ('POLYGON', 'MULTIPOLYGON')
                 THEN ST_AsText(ST_Multi(p.geom))
                 ELSE NULL END AS outline_wkt,
            -- 🔴 Natural Earth writes -1 where it has no ISO code, and
            -- that is "unknown", not "not a country".
            --
            -- Measured 24.09.2026 on the released Cyprus extract: of 60
            -- imported campsites, 34 fall in the polygon called Northern
            -- Cyprus and 2 in Dhekelia, both coded -1. Read literally,
            -- the EU filter below then throws 60% of Cyprus away as
            -- foreign — from the extract of a member state, which is the
            -- one place it cannot be right. (Some Natural Earth builds
            -- use -99 for the same thing; the pattern catches both.)
            --
            -- 🔴 THE REGION GOES WITH IT, and that is the whole point of
            -- doing this in one CASE rather than two.
            --
            -- The first version cleared only the country. Review caught
            -- what that shipped: "region" still came from the sentinel
            -- polygon, so 34 campsites would have been published at
            -- /camping/cy/northern-cyprus/… with a region hub page to
            -- match, and 2 at /camping/cy/dhekelia/… — a political
            -- attribution nobody decided, made permanent by CAMP-87,
            -- which forbids moving a published URL afterwards. Dhekelia
            -- and Akrotiri are British Sovereign Base Areas, so that
            -- second URL would also have put UK ground under "cy" in the
            -- very commit that added the EU-27 filter.
            --
            -- So a point in a polygon with no ISO code keeps its place
            -- on the map and loses only its page: country falls back to
            -- the extract being imported, region stays NULL, and the
            -- count is printed every run. It is the same treatment as a
            -- point in the sea, for the same reason — we do not know,
            -- and not knowing is not a licence to name it. What these
            -- campsites are finally called is CAMP-125, for the owner.
            CASE WHEN a.iso_a2 ~ '^[A-Za-z]{2}$' THEN a.name END
              AS admin_region,
            CASE WHEN a.iso_a2 ~ '^[A-Za-z]{2}$' THEN a.iso_a2 END
              AS admin_country,
            a.iso_a2 AS raw_country,
            p.*
       FROM pts p
       LEFT JOIN LATERAL (
         -- 🔴 Containment first, nearest polygon second — and the second
         -- is not a nicety.
         --
         -- Natural Earth is 1:10m, so its coastline is generalised. The
         -- first Croatian import put 367 campsites of 778 — 47% — outside
         -- every admin-1 polygon, and without a region a campsite gets no
         -- page URL at all. Measured, every one of them was within
         -- 3.85 km of a Croatian polygon; the average was 593 m and the
         -- closest 8 m. They are not in the sea: they are on a shore or a
         -- small island that the generalised outline smooths away, and
         -- Croatia's campsites are overwhelmingly coastal.
         --
         -- So a point that falls in nothing takes the nearest polygon of
         -- a country, within a hard limit. The limit is what keeps this
         -- honest: beyond it the row keeps no region and gets no page,
         -- rather than being assigned a county by a guess.
         --
         -- 🔴 Two steps, because one was unusably slow. Casting every
         -- polygon to geography to measure a distance defeats the GiST
         -- index, and the query then compared each point against all
         -- 4,594 admin-1 polygons on Earth. First the index narrows to a
         -- handful of candidates by bounding box and KNN; only those few
         -- are measured exactly.
         SELECT c.name, c.iso_a2
           FROM (
             SELECT name, iso_a2, geom, ST_Contains(geom, p.pt) AS inside
               FROM ne_admin1
              WHERE geom && ST_Expand(p.pt, 0.1)
              ORDER BY geom <-> p.pt
              LIMIT 8
           ) c
          WHERE c.inside
             OR ST_DWithin(c.geom::geography, p.pt::geography, 5000)
          -- Containment always wins; among near misses the closest wins.
          -- 🔴 name breaks the tie, because two polygons can be
          -- equidistant and an undetermined winner would move a published
          -- URL between runs (the lesson of CAMP-39).
          ORDER BY c.inside DESC, c.geom <-> p.pt, c.name
          LIMIT 1
       ) a ON true
      ORDER BY p.id`;

export const UPSERT_SPOT_SQL = `INSERT INTO camping_spots
           (name, country, region, slug, type, amenities, location,
            osm_ref, last_seen_at, missing_since, content_changed_at, sources,
            contact, overnight_status, overnight_source, overnight_checked_at,
            osm_record_edited_at, osm_record_version, osm_record_ref, outline)
         -- 🔴 $8::text in BOTH places, not just in the JSON below.
         --
         -- osm_ref is character varying, so an uncast $8 here made
         -- Postgres deduce varchar from the column and text from the
         -- cast in jsonb_build_object, and refuse the whole statement:
         -- "inconsistent types deduced for parameter $8 — text versus
         -- character varying". Every OSM import failed on the first row.
         --
         -- It went unnoticed because the sources column (CAMP-101) added
         -- the second use of $8 after the last import had run, and the
         -- weekly workflow only BUILDS extracts — it does not import
         -- them. So the break sat between two jobs that each looked
         -- healthy. Found 24.09.2026 while importing the EU.
         VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromText($7, 4326), $8::text, $9, NULL, $9,
                 jsonb_build_array(jsonb_build_object(
                   'id', 'osm', 'ref', $8::text,
                   'updatedAt', to_char($9::timestamptz, 'YYYY-MM-DD'),
                   -- 🔴 CAMP-141 adds "contact" here, and the page prints
                   -- this list as "what this source gave us". A field we
                   -- write and do not declare is an attribution that lies
                   -- by omission.
                   -- 🔴 CAMP-255: "overnight" is declared ONLY when this
                   -- source actually gave us an answer. The page prints
                   -- this list as "what this source gave us", and
                   -- listing it beside a row whose status is unknown
                   -- would credit OSM with something it did not supply.
                   'fields', '["name","location","amenities","contact"]'::jsonb
                             || CASE WHEN $11::text = 'unknown'
                                     THEN '[]'::jsonb
                                     ELSE '["overnight"]'::jsonb END)),
                 $10,
                 -- 🔴 CAMP-255. The status, its source and the day we read
                 -- it, written TOGETHER from one mapper result. The source
                 -- comes from the mapper, which returns one exactly when
                 -- it returns an answer; the day is decided HERE, from the
                 -- status, so it cannot be passed inconsistently. The
                 -- table's CHECK refuses anything that disagrees — and a
                 -- guard on the source here would be a second copy of the
                 -- mapper's rule that no test could tell from the first.
                 $11::text,
                 $12::text,
                 CASE WHEN $11::text = 'unknown' THEN NULL
                      ELSE $9::timestamptz::date END,
                 -- 🔴 CAMP-256. The day a MAPPER last edited this object and
                 -- the object's version, straight from the extract's own
                 -- timestamp. NOT $9: that is the day THIS RUN started,
                 -- which is what last_seen_at holds, and writing it here is
                 -- the one mistake this card is most likely to ship — every
                 -- page would read "edited this month" and nothing would
                 -- look wrong. NULL is "not known" and stays NULL.
                 --
                 -- $15 is the OBJECT those two belong to — the same one, every
                 -- time, because the three are one fact. It is osm_ref except
                 -- where the importer built this row from several objects and
                 -- the newest of them is not the one the row is keyed on.
                 $13::timestamptz, $14::integer, $15::text,
                 ST_GeomFromText($16, 4326))
         ON CONFLICT (osm_ref) DO UPDATE SET
           name          = EXCLUDED.name,
           country       = EXCLUDED.country,
           region        = EXCLUDED.region,
           type          = EXCLUDED.type,
           amenities     = EXCLUDED.amenities,
           -- 🔴 CAMP-141. Safe to overwrite: this column holds only what
           -- OSM said, and the reader-facing code merges it with the
           -- website column DATAtourisme filled. That column itself is
           -- NOT in this list, for the same reason owner_overrides is
           -- not: a weekly import must not quietly outrank a better
           -- source. (Backticks are deliberately absent here — this is
           -- inside a template literal, and the first draft of this
           -- comment ended the string and broke the build.)
           contact       = EXCLUDED.contact,
           -- 🔴 CAMP-255. Rewritten from the tags on EVERY run, all three
           -- together, so a motorhome=yes a mapper later deletes stops
           -- being an "allowed" the next Monday — a stale claim is worse
           -- than a missing one. Absent tag in, unknown out.
           overnight_status     = EXCLUDED.overnight_status,
           overnight_source     = EXCLUDED.overnight_source,
           overnight_checked_at = EXCLUDED.overnight_checked_at,
           -- 🔴 CAMP-256. Rewritten on every run, the date and the version
           -- TOGETHER, and a NULL in is a NULL out: an extract that does
           -- not carry the date must not leave last month's in place under
           -- this month's import — a stale claim is worse than a missing
           -- one. Neither is in the content_changed_at comparison below,
           -- on purpose: see there.
           osm_record_edited_at = EXCLUDED.osm_record_edited_at,
           osm_record_version   = EXCLUDED.osm_record_version,
           osm_record_ref       = EXCLUDED.osm_record_ref,
           location      = EXCLUDED.location,
           -- 🔴 CAMP-352. Контур оновлюється РАЗОМ із точкою, і це
           -- умова, а не стиль: location це ST_PointOnSurface тієї ж
           -- фігури, а міграція вимагає, щоб точка лежала НА контурі.
           -- Оновити одне без іншого означало б зібрати рядок із двох
           -- різних імпортів і впертись у власне обмеження.
           --
           -- NULL тут законний і перезаписує попереднє значення: якщо
           -- обʼєкт в OSM із площі став крапкою, старий обрис більше не
           -- описує нічого, і лишати його означало б показувати
           -- читачеві форму, якої вже немає.
           outline       = EXCLUDED.outline,
           last_seen_at  = EXCLUDED.last_seen_at,
           missing_since = NULL,
           -- 🔴 CAMP-101. Replace only OUR entry; keep every other
           -- source's. Writing EXCLUDED.sources wholesale would erase
           -- the DATAtourisme attribution every Monday — the same class
           -- of bug as overwriting owner_overrides, and just as silent.
           --
           -- The date here is when WE last found the campsite in OSM,
           -- never when a mapper last edited it, and the page says
           -- exactly that ("last checked against this source on").
           sources = (
             SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
               FROM jsonb_array_elements(camping_spots.sources) e
              WHERE e->>'id' <> 'osm'
           ) || EXCLUDED.sources,
           -- 🔴 CAMP-39: only moves when something a reader would notice
           -- moved. last_seen_at ticks every week whether or not anything
           -- changed, so using it as <lastmod> would restamp every page
           -- each Monday and teach crawlers the field is noise.
           --
           -- 🔴 CAMP-256: osm_record_edited_at is NOT in the comparison.
           -- The first load of the column turns NULL into a date on every
           -- OSM row, and counting that as a change would restamp every
           -- page's <lastmod> in one run for a sentence that appeared
           -- beside the facilities, not for anything about the campsite.
           -- A mapper's later edit that changes anything we show already
           -- moves it through name, amenities, contact or location.
           content_changed_at = CASE
             -- 🔴 CAMP-255: status and source, NOT the day. The day moves
             -- every run, and a <lastmod> that moves with it restamps
             -- every confirmed page each Monday, which is the churn this
             -- CASE exists to prevent.
             WHEN (camping_spots.name, camping_spots.country,
                   camping_spots.region, camping_spots.type,
                   camping_spots.amenities, camping_spots.contact,
                   camping_spots.overnight_status,
                   camping_spots.overnight_source)
                  IS DISTINCT FROM
                  (EXCLUDED.name, EXCLUDED.country,
                   EXCLUDED.region, EXCLUDED.type,
                   EXCLUDED.amenities, EXCLUDED.contact,
                   EXCLUDED.overnight_status,
                   EXCLUDED.overnight_source)
               OR NOT ST_Equals(camping_spots.location, EXCLUDED.location)
             -- 🔴 CAMP-352. Контур у порівнянні Є, але лише КОЛИ ВІН УЖЕ
             -- БУВ. Сторінка малює обрис, тож перемальований мапером
             -- контур це видима зміна, і <lastmod> мусить її показати.
             --
             -- А от сторож IS NOT NULL — це дослівно урок CAMP-256 на
             -- сусідніх рядках. Перший прогін після цієї міграції
             -- перетворює NULL на геометрію в КОЖНОМУ полігонному рядку
             -- (68% екстракту — площі), і без сторожа один імпорт
             -- перештампував би <lastmod> десяткам тисяч сторінок за
             -- появу колонки, а не за зміну кемпінгу. Саме та churn,
             -- заради якої цей CASE і написаний.
             --
             -- Зникнення контуру (площу перемалювали в точку) рахується
             -- зміною: обрис зі сторінки щез. Тому порівняння написане
             -- через явний NULL-випадок, а не через ST_Equals — він на
             -- NULL віддає NULL, і втрата контуру пройшла б непоміченою.
               OR (camping_spots.outline IS NOT NULL
                   AND (EXCLUDED.outline IS NULL
                        OR NOT ST_Equals(camping_spots.outline,
                                         EXCLUDED.outline)))
             THEN EXCLUDED.last_seen_at
             ELSE camping_spots.content_changed_at
           END
           -- slug and owner_overrides are intentionally absent: see the
           -- header. Adding them here is the bug this comment prevents.
         -- RETURNING sees the final row, never EXCLUDED — Postgres
         -- rejects it there. $9 is the same value last_seen_at was set
         -- to, so comparing against it answers the same question.
         RETURNING (xmax = 0) AS was_insert,
                   (camping_spots.content_changed_at = $9) AS content_changed`;

interface StagingRow {
  osm_ref: string;
  point_wkt: string;
  /** `MULTIPOLYGON(...)` або `null` — контур ділянки, коли він є. */
  outline_wkt: string | null;
  /** Admin-1 name the point falls inside, e.g. "Bled". Null outside coverage. */
  admin_region: string | null;
  /** ISO-3166-1 alpha-2 of that polygon - overrides the CLI argument. */
  admin_country: string | null;
  /**
   * What Natural Earth actually wrote, sentinel included.
   *
   * Kept so the run can COUNT the points whose polygon carries no code
   * rather than only behaving differently for them. A fallback nobody
   * sees working is a fallback nobody can check.
   */
  raw_country?: string | null;
  /**
   * CAMP-256: the OSM edit date and version of THIS object, and the object
   * they belong to, read from the staging columns `"@timestamp"` /
   * `"@version"` and the row's own `osm_ref`.
   *
   * Optional only so that the row helpers in the specs, which predate it,
   * keep compiling; `main()` always sets it. It travels on the row so that
   * `dedupe` — which keeps one object's row and merges the other's tags
   * into it — can date the merged row (below). For a row of one object it
   * is that object's own date, and `record.ref` is that object: `osm_ref`.
   *
   * 🔴 A ROW BUILT FROM SEVERAL OBJECTS is dated by the NEWEST of them
   * (`mergedRecord`): its tags are a union, and the kept object's date alone
   * was older than a displayed tag in 162 of 516 merged clusters (measured
   * 15.10.2026, 27 extracts; 123 database rows). For such a row the date
   * belongs to the merged-away object, and `record.ref` says which — it is
   * NOT `osm_ref`, which stays the kept object's, so a person checking the
   * date on openstreetmap.org looks up `record.ref` (the column
   * `osm_record_ref`) and never `osm_ref`.
   */
  record?: RecordAge;
  tags: OsmTags;
}

/**
 * Everything one UPSERT_SPOT_SQL execution takes, by name.
 *
 * 🔴 CAMP-256: the statement takes FIFTEEN placeholders and this is the
 * only place that knows their order. The importer, the link rehearsal
 * (`verify-links.ts`) and the DB specs all execute that one statement, and
 * each used to carry its own positional array. The array grew from ten to
 * twelve for CAMP-255 and the rehearsal kept passing ten — CI died on
 * "bind message supplies 10 parameters, but prepared statement requires
 * 12", between two files that each looked right. Adding the thirteenth to
 * the fifteenth is the same edit; this makes it one edit in one place.
 */
export interface UpsertSpotValues {
  name: string | null;
  country: string;
  region: string | null;
  slug: string;
  type: string;
  amenities: unknown;
  /** `MULTIPOLYGON(...)` or null — the plot outline, when OSM has one. */
  outlineWkt?: string | null;
  /** `POINT(lon lat)` — what ST_GeomFromText reads. */
  pointWkt: string;
  osmRef: string;
  /** When THIS RUN started: becomes last_seen_at and nothing else. */
  seenAt: Date | string;
  contact: unknown;
  overnightStatus: string;
  overnightSource: string | null;
  /**
   * The OSM edit — object, date and version, as ONE value — or `null` for "not
   * known". Never `seenAt`. A date cannot be passed without its ref: there is
   * no way to spell it (see RecordEdit), which is the point.
   */
  record: RecordEdit | null;
}

export function upsertSpotParams(v: UpsertSpotValues): unknown[] {
  return [
    v.name,
    v.country,
    v.region,
    v.slug,
    v.type,
    JSON.stringify(v.amenities),
    v.pointWkt,
    v.osmRef,
    v.seenAt,
    JSON.stringify(v.contact),
    v.overnightStatus,
    v.overnightSource,
    v.record?.editedAt ?? null,
    v.record?.version ?? null,
    v.record?.ref ?? null,
    // 🔴 $16 — ДОПИСАНИЙ У КІНЕЦЬ НАВМИСНО. Вставити контур поруч із
    // точкою означало б зсунути нумерацію всіх параметрів після нього,
    // а вони розкидані по statement у кількох місцях ($8 і $9 вжиті
    // двічі кожен). Зсув, який компілятор не бачить, — найдешевший
    // спосіб переплутати країну з регіоном.
    v.outlineWkt ?? null,
  ];
}

/**
 * 🔴 CAMP-256: the edit dates THE DATABASE NOW HOLDS for the rows this run
 * wrote — and a refusal if they look like the day of the load.
 *
 * Read back from the table, for the rows whose `last_seen_at` is exactly the
 * run's start (which is what the upsert stamps on every row it touches). Not
 * the values that were about to be sent: a check on the INPUT cannot see a
 * substitution made by anything between the input and the table — the
 * builder, the statement, a later edit of either — and the card's named
 * failure, "the import wrote the load date instead of the edit date", is
 * exactly that. A substituted date is wrong on every row at once, so no
 * per-row test can see it; the only witness is the shape of the whole
 * country.
 *
 * Called inside the transaction, before COMMIT: the throw lands in main()'s
 * catch, which ROLLS BACK, so a refused country is left exactly as it was and
 * the next one is unaffected.
 */
export async function assertStoredEditDates(
  db: Pick<Client, 'query'>,
  startedAt: Date,
  country: string,
): Promise<(Date | null)[]> {
  const stored = await db.query<{ osm_record_edited_at: Date | null }>(
    `SELECT osm_record_edited_at FROM camping_spots
      WHERE osm_ref IS NOT NULL AND last_seen_at = $1`,
    [startedAt],
  );
  const dates = stored.rows.map((r) => r.osm_record_edited_at);
  const verdict = loadDateVerdict(dates, startedAt);
  if (verdict) throw new Error(`${country}: ${verdict}`);
  return dates;
}

async function main(): Promise<void> {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const startedAt = new Date();

  // Text columns only: ogr2ogr lands every OSM tag as its own column, and
  // the tag bag we hand to the mapper is rebuilt from them.
  const cols = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND data_type IN ('text','character varying')`,
    [TABLE],
  );
  const tagColumns = cols.rows
    .map((r) => r.column_name)
    .filter((c) => c !== 'id');

  // 🔴 CAMP-256: does the staging table carry the OSM edit date at all?
  //
  // A release built before `-a timestamp,version` has no such column, and
  // the importer must say so in as many words rather than let "every row
  // is not known" read as a country nobody has edited. ogr2ogr lands the
  // two attributes as INTEGER columns named exactly `@timestamp` and
  // `@version` — measured here on 15.10.2026 (Malta, then all 27 countries)
  // and, independently, by review on GDAL 3.13.3. That is NOT pinned by a test:
  // CI has no GDAL. If a GDAL release ever renames them, the symptom is
  // exactly the line printed below, on every country, and `import-main.db.spec`
  // pins that this line is printed and what the run then writes.
  const editCols = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND column_name IN ('@timestamp', '@version')`,
    [TABLE],
  );
  const stagingHasEditDate = editCols.rows.some(
    (r) => r.column_name === '@timestamp',
  );

  // CAMP-34: the region and the country come from the geometry, not from
  // tags and not from the command line.
  //
  // Tags cannot supply them: addr:state or addr:province was present on
  // 0 of 448 Slovenian campsites (measured). And the country argument is
  // a claim about the whole extract, which is wrong at the edges - a
  // Geofabrik extract carries a strip beyond the border, so nine spots in
  // the Slovenian file actually stand in Croatia and Austria. Publishing
  // those under /camping/si/ would be a wrong URL that CAMP-87 then
  // forbids us to move.
  const hasBoundaries = await db.query(
    `SELECT to_regclass('public.ne_admin1') IS NOT NULL AS ok`,
  );
  if (!hasBoundaries.rows[0]?.ok) {
    throw new Error(
      'Table ne_admin1 is missing - every page URL depends on it.\n' +
        'Run: ./scripts/osm-pipeline/load-boundaries.sh',
    );
  }

  // 🔴 68% of the Slovenian extract are ways, not nodes - campsites are
  // mapped as areas. ST_PointOnSurface, not ST_Centroid: the centroid of a
  // concave or ring-shaped site can land outside it, which would put the
  // pin in a neighbouring field.
  const rows = await db.query(stagingSelectSql(TABLE));

  // 🔴 Тип НА КОЛБЕКУ, не лише на змінній. `db.query` без генерика віддає
  // `any`, тож `rows.rows.map(...)` теж `any`, і анотація `StagingRow[]`
  // зліва не перевіряє нічого: 20.10.2026 ця мапа не копіювала
  // `outline_wkt`, tsc мовчав із кодом 0, юніт-тести були зелені, а
  // колонка лишалась порожньою на кожному рядку. Анотація повернення
  // колбека перевіряється навіть над `any`.
  const staged: StagingRow[] = rows.rows.map((row): StagingRow => {
    const tags: OsmTags = {};
    for (const col of tagColumns) {
      const v = row[col];
      if (v !== null && v !== undefined && v !== '') tags[col] = String(v);
    }
    return {
      osm_ref: row.osm_ref,
      point_wkt: row.point_wkt,
      outline_wkt: row.outline_wkt ?? null,
      admin_region: row.admin_region ?? null,
      admin_country: row.admin_country ?? null,
      raw_country: row.raw_country ?? null,
      // 🔴 CAMP-256: read from the object's OWN row, before dedupe. A
      // missing column reads as `undefined` and becomes problem
      // `missing` — never a default, and never `startedAt`.
      // The object's OWN id travels with its date: `dedupe` may later hand
      // the row to another object's date, and the ref goes with it.
      record: readRecordAge(
        row['@timestamp'],
        row['@version'],
        startedAt,
        row.osm_ref,
      ),
      tags,
    };
  });

  const deduped = dedupe(staged);
  const droppedAsDuplicate = staged.length - deduped.length;

  // Existing slugs stay with their spot; new ones must not collide.
  const known = await db.query<{ osm_ref: string; slug: string }>(
    `SELECT osm_ref, slug FROM camping_spots WHERE osm_ref IS NOT NULL`,
  );
  // Typed, because the named parameters below refuse a bare `unknown`.
  const slugByRef = new Map<string, string>(
    known.rows.map((r): [string, string] => [r.osm_ref, r.slug]),
  );
  const allSlugs = await db.query<{ slug: string }>(
    `SELECT slug FROM camping_spots`,
  );
  const usedSlugs = new Set(allSlugs.rows.map((r) => r.slug));

  let inserted = 0;
  let updated = 0;
  let unnamed = 0;
  let fromPolygon = 0;
  let withOutline = 0;
  /** Points whose polygon says a different country than the argument. */
  let outsideExtent = 0;
  /** Points that resolved to a country outside the European Union. */
  let outsideUnion = 0;
  /**
   * Points inside a polygon Natural Earth gives no ISO code to.
   *
   * 🔴 Counted because the fallback is silent by construction: the row
   * arrives, it just arrives without a region. Without this number a
   * change in the boundary file could re-attribute thousands of
   * campsites and the run would print exactly what it printed before.
   */
  let noCountryCode = 0;
  // CAMP-255: what the run decided about overnight stay, counted.
  //
  // 🔴 Printed every run INCLUDING the zeros, and with the reason a tag
  // that was present did not become an answer. A mapper that quietly
  // stopped recognising `yes` would otherwise look exactly like a
  // country with no tags.
  const overnightCounts = { allowed: 0, forbidden: 0, unknown: 0 };
  const overnightLeft = new Map<string, number>();
  // CAMP-288: how many names this run corrected, and which it could not.
  let renamed = 0;
  const unknownRegions = new Map<string, number>();
  /** Points outside every admin-1 polygon - these get no page URL. */
  let withoutRegion = 0;
  // CAMP-256: what the run decided about each record's OSM edit date.
  //
  // 🔴 Counted per KIND of refusal and printed every run, zeros included.
  // A date written as NULL looks identical to the page whether the extract
  // never had it, had a malformed one, or had one from the future — and
  // only the kind says which part of the pipeline to look at.
  const editRefused = new Map<RecordAgeProblem, number>();
  /** What the database holds for this run's rows, read back before COMMIT. */
  let storedEditDates: (Date | null)[] = [];

  await db.query('BEGIN');
  try {
    for (const row of deduped) {
      // Geometry wins over the argument. The argument only stands in where
      // the point falls outside every polygon (open sea, a gap in the data).
      const country = row.admin_country ?? COUNTRY;
      // 🔴 CAMP-288: Natural Earth's spelling is not the state's.
      // Two of its admin-1 names are misspelt and went straight into
      // the URL — `Haute-Rhin` on 238 campsites, `Seien-et-Marne` on
      // 70. This is the only place `region` is written, so it is the
      // only place a correction holds past next Monday's import.
      const region = correctRegion(country, row.admin_region);
      if (region !== row.admin_region) renamed++;
      // A French region that is not a département is either a new
      // misspelling or a neighbour's polygon flown under our flag, and
      // both are worth a line rather than a silent page.
      if (isKnownRegion(country, region) === false) {
        unknownRegions.set(
          `${country}/${region}`,
          (unknownRegions.get(`${country}/${region}`) ?? 0) + 1,
        );
      }
      if (row.raw_country && !row.admin_country) noCountryCode++;

      // 🔴 CAMP-118: the Union, and nothing else. DECIDED FIRST, on purpose.
      //
      // Geofabrik cuts its extracts to bounding boxes, so Slovenia's
      // includes a strip of Bosnia and Croatia's a strip of Serbia. The
      // line above resolves those points to their real country — which is
      // right — and the old code then imported them anyway, merely
      // counting them as `outsideExtent`. That is how 13 Bosnian and 2
      // Serbian campsites ended up in a database whose stated scope is
      // the EU, with nobody deciding anything.
      //
      // They are skipped here rather than filtered later, because a row
      // that never arrives cannot be forgotten about; and the count is
      // printed, because a filter that silently drops things is the next
      // problem after the one it fixed.
      //
      // 🔴 And it stands BEFORE the slug, not after. Review caught the
      // first version skipping the row only once the slug had already
      // been reserved in `usedSlugs`: a Bosnian "Camping Sava" that we
      // never import would take `camping-sava` with it, and the Slovenian
      // one arriving later in the same run would be published as
      // `camping-sava-2` — a permanent URL, paid for by a row that does
      // not exist. Same reason the other counters moved down: a row we
      // refuse is not an unnamed campsite, not a border campsite and not
      // a region-less campsite. It is not a campsite of ours at all.
      //
      // ⚠️ What this cannot undo: a non-EU row imported BEFORE the filter
      // existed still holds its slug in `usedSlugs` until drop-non-eu.mjs
      // deletes the row, and by CAMP-87 a slug already published stays
      // published. Measured 24.09.2026 on the 61 521 rows we hold: of
      // 5 546 numbered slugs, 313 have a free base, and every one of
      // those 313 is a name that ends in a digit of its own ("Aire de
      // Nismes 1", "Camping Le Buisson 2*", "Camping nr 146"). Nothing
      // was stolen. The fix is a lock on a door nobody has walked
      // through yet.
      if (!isEuMemberState(country)) {
        outsideUnion++;
        continue;
      }

      const name = row.tags.name?.trim() || null;
      if (!name) unnamed++;
      if (row.admin_country && row.admin_country !== COUNTRY) outsideExtent++;
      if (!region) withoutRegion++;

      let slug = slugByRef.get(row.osm_ref);
      if (!slug) {
        const base = slugify(name, row.osm_ref);
        slug = base;
        let n = 2;
        // Campsite names repeat constantly ("Camping Municipal" appears
        // hundreds of times in France), so collisions are the norm.
        while (usedSlugs.has(slug)) slug = `${base}-${n++}`;
        usedSlugs.add(slug);
      }

      const amenities = mapAmenities(row.tags);
      const contact = mapContact(row.tags);
      const type = mapSpotType(row.tags).type;
      const overnight = mapOvernight(row.tags);
      overnightCounts[overnight.status]++;
      if (overnight.leftUnknownBecause) {
        overnightLeft.set(
          overnight.leftUnknownBecause,
          (overnightLeft.get(overnight.leftUnknownBecause) ?? 0) + 1,
        );
      }

      // 🔴 CAMP-256: a record with no `record` at all (a caller that built
      // the row by hand) is "not known", not an error and not a date.
      const record: RecordAge = row.record ?? {
        edit: null,
        problem: 'missing',
      };
      if (!record.edit && record.problem) {
        editRefused.set(
          record.problem,
          (editRefused.get(record.problem) ?? 0) + 1,
        );
      }

      const res = await db.query(
        UPSERT_SPOT_SQL,
        upsertSpotParams({
          name,
          country,
          region,
          slug,
          type,
          amenities,
          pointWkt: row.point_wkt,
          outlineWkt: row.outline_wkt,
          osmRef: row.osm_ref,
          seenAt: startedAt,
          contact,
          overnightStatus: overnight.status,
          overnightSource: overnight.source,
          record: record.edit,
        }),
      );
      if (res.rows[0]?.was_insert) inserted++;
      else updated++;
    }

    // Anything in this country that OSM stopped mentioning. Only the first
    // disappearance is stamped, so the four-import rule from CAMP-87 can
    // measure how long it has been gone.
    //
    // 🔴 `last_seen_at < startedAt` on its own is wrong, and the second
    // country is what exposed it.
    //
    // Geofabrik's extracts overlap at the borders, and their idea of a
    // border is OSM's, while ours is Natural Earth's. Kamp Hupkač sits in
    // Međimurje: Natural Earth puts it inside Croatia, so we store it as
    // HR — and Geofabrik's Croatian extract does not contain it, because
    // OSM's boundary runs differently. It arrived in the SLOVENIAN
    // extract, an hour earlier in the same import cycle.
    //
    // With the naive condition, every weekly Croatian import declared a
    // campsite that plainly exists to be missing, and after four of them
    // CAMP-73 would start answering 410 for a live campsite — the exact
    // damage the 410 was built to avoid.
    //
    // So a spot seen by ANY extract in this cycle is not missing. The
    // window is generous on purpose: the gone rule already waits four
    // weeks, so nothing is lost by being slow to suspect.
    const CYCLE_HOURS = 24;
    const gone = await db.query(MARK_GONE_SQL, [
      startedAt,
      COUNTRY,
      CYCLE_HOURS,
    ]);

    // 🔴 CAMP-256: what the table now holds, judged before COMMIT — see
    // assertStoredEditDates for why it reads the table and not the input.
    storedEditDates = await assertStoredEditDates(db, startedAt, COUNTRY);
    withOutline = await assertStoredOutlines(db, startedAt, COUNTRY);

    await db.query('COMMIT');

    const polygons = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM "${TABLE}" WHERE GeometryType(geom) <> 'POINT'`,
    );
    fromPolygon = Number(polygons.rows[0]?.n ?? 0);

    const total = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM camping_spots WHERE country = $1`,
      [COUNTRY],
    );

    const unknownCounts = await db.query<{ amenity: string; n: string }>(
      `SELECT key AS amenity, count(*) AS n
         FROM camping_spots, jsonb_each_text(amenities)
        WHERE country = $1 AND value = 'unknown'
        GROUP BY key ORDER BY key`,
      [COUNTRY],
    );

    console.log(`\nOSM import — ${COUNTRY}, from "${TABLE}"\n`);
    console.log(`  staged rows        ${staged.length}`);
    console.log(
      `  merged duplicates  ${droppedAsDuplicate}  (named within 200 m, unnamed within 50 m; polygon beats node)`,
    );
    console.log(`  inserted           ${inserted}`);
    console.log(`  updated            ${updated}`);
    console.log(`  newly missing      ${gone.rowCount}`);
    console.log(`  ─────────────────────────`);
    console.log(`  rows in ${COUNTRY} now     ${total.rows[0].n}`);
    console.log(
      `\n  without a name     ${unnamed}  (pin shown, name honestly unknown)`,
    );
    console.log(`  mapped as areas    ${fromPolygon}  (ST_PointOnSurface)`);
    // 🔴 Рахується з ТАБЛИЦІ, а не зі staging, і це не те саме число.
    // `mapped as areas` вище міряє вхід і зараховує LINESTRING та
    // GEOMETRYCOLLECTION, які контуру не отримують, — тобто тим рядком
    // не видно, чи контур узагалі записався. 20.10.2026 він і не
    // записувався: мапа не копіювала поле, а цей рядок показував би ті
    // самі площі.
    console.log(
      `  with an outline    ${withOutline}  (read back from the table)`,
    );
    console.log(
      `  outside ${COUNTRY.padEnd(2)}         ${outsideExtent}  (extent overlaps the border; country taken from geometry)`,
    );
    // 🔴 Said out loud every run, INCLUDING when it is zero.
    //
    // A filter nobody sees working is a filter somebody removes as dead
    // code, and this one is the only thing keeping the project's stated
    // scope true in the data. It used to print only when it fired, so
    // the run where it stopped firing looked exactly like the run where
    // there was nothing to catch — which is the difference between a
    // guard and a decoration.
    console.log(
      `  outside the EU     ${outsideUnion}  (skipped — CAMP-118, we serve the Union)`,
    );
    console.log(
      `  no ISO code        ${noCountryCode}  (polygon has none — region withheld, no page: CAMP-125)`,
    );
    // 🔴 CAMP-288, and printed when it is zero for the same reason as
    // the line above: the run where the correction stops being needed
    // and the run where it stopped being applied look identical
    // otherwise.
    console.log(
      `  names corrected    ${renamed}  (Natural Earth spelling → the state's: CAMP-288)`,
    );
    console.log(
      `  overnight stay     allowed ${overnightCounts.allowed} · forbidden ${overnightCounts.forbidden} · unknown ${overnightCounts.unknown}  (motorhome tag — CAMP-255)`,
    );
    for (const [why, n] of [...overnightLeft]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 15)) {
      console.log(`    left unknown on purpose  ${why}  ${n}`);
    }
    // 🔴 CAMP-256, said out loud every run INCLUDING the zeros — and the
    // second line is the one that would have caught the card's own named
    // failure: the share of records whose "edit" falls inside the last
    // two days. Real data is a small fraction of one percent; the load
    // date written over every row is 100%.
    // Counted from what the table holds, not from what the loop meant to
    // write, so the line cannot say "dated" about a column that is empty.
    const share = recentShare(storedEditDates, startedAt);
    console.log(
      `  OSM edit date      dated ${share.dated} · not known ${storedEditDates.length - share.dated}  (the extract's own timestamp, never this run's date: CAMP-256)`,
    );
    if (!stagingHasEditDate) {
      console.log(
        `  🔴 "${TABLE}" has no "@timestamp" column — this extract was built before the edit date was exported, so every record above reads "not known"`,
      );
    }
    for (const [why, n] of [...editRefused].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )) {
      console.log(`    not known because  ${why}  ${n}`);
    }
    console.log(
      `  edited ≤${RECENT_WINDOW_HOURS} h before this run  ${share.recent} of ${share.dated} dated` +
        (share.dated > 0
          ? `  (${((100 * share.recent) / share.dated).toFixed(2)}%)`
          : ''),
    );
    if (unknownRegions.size > 0) {
      console.log(
        `  🔴 ${unknownRegions.size} region name(s) this country does not have:`,
      );
      for (const [key, n] of [...unknownRegions].sort((a, b) => b[1] - a[1])) {
        console.log(`       ${key}  ${n}`);
      }
    }
    if (withoutRegion) {
      console.log(
        `  🔴 no region       ${withoutRegion}  (no admin-1 polygon — these cannot get a page URL)`,
      );
    }
    if (unknownCounts.rowCount) {
      console.log('\n  amenities still unknown:');
      for (const r of unknownCounts.rows) {
        console.log(`    ${r.amenity.padEnd(13)} ${r.n}`);
      }
    }
    console.log('');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

if (RUN_DIRECTLY) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
