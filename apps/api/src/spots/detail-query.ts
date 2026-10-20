import { nearestBathingWaterSql } from '../bathing/nearby';
import { airQualitySql } from '../air/nearby';
import { nearbyWebcamsSql } from '../webcams/nearby';
import { linkedSecondariesJoin } from './links';
import { tariffsSql, withheldTariffCountSql } from './tariffs';
import { OVERNIGHT_DAY_SQL, overnightStatusSql } from './overnight';

/**
 * 🔴 Every column here is qualified `s.`, so the table MUST be aliased
 * `s` wherever this is interpolated.
 *
 * It was unqualified until CAMP-144, which was fine while the only table
 * in the statement was `camping_spots`. The moment the linked row joined
 * in — and it carries `stars` and `description` too, by definition —
 * Postgres answers "column reference is ambiguous" and the query dies.
 * Unqualified would have been worse than an error if it had resolved: it
 * would have silently asked the question about the wrong row.
 */
export const NOTHING_TO_SAY_SQL = `(
  -- 🔴 "No amenity is KNOWN", not "the object is empty".
  --
  -- The first version of this asked \`amenities = '{}'\`, and it was wrong
  -- in a way only the CI fixture revealed. A campsite imported from
  -- OpenStreetMap stores every amenity explicitly, as
  -- {"wifi":"unknown","water":"unknown",…} — a full object that answers
  -- nothing. \`= '{}'\` is false for those rows, so 482 campsites that
  -- carry no fact whatsoever were counted as having something. Measured
  -- 24.09.2026: 1 872 by the old rule, 2 354 by this one.
  --
  -- The French rows happen to store a literal '{}', which is why the
  -- mistake produced a plausible number instead of an obvious one.
  NOT jsonb_path_exists(
    coalesce(s.amenities, '{}'::jsonb),
    '$.* ? (@ == "yes" || @ == "no")'
  )
  AND (s.context IS NULL OR s.context = '{}'::jsonb)
  AND s.description IS NULL
  AND s.stars IS NULL
)`;

/**
 * CAMP-280: the campsite page's query, exactly as the API runs it.
 *
 * 🔴 It lives here, outside the service, for one reason: so that
 * `verify-links.ts` can run THIS TEXT rather than a retyped stand-in.
 *
 * The first version of that rehearsal wrote its own SELECT over the new
 * lateral, printed seven ticks, and was read as proof. Meanwhile nine
 * columns in the real query still named `linked.id` and friends, which
 * the lateral no longer has: every campsite page was a 500 and nothing
 * in the rehearsal could see it, because the rehearsal never touched
 * those columns. A proof that reads a paraphrase proves the paraphrase.
 *
 * `$1` is the slug.
 */
export const SPOT_DETAIL_SQL = `SELECT s.slug, s.name, s.country, s.region, s.type,
              ST_Y(s.location::geometry) AS lat,
              ST_X(s.location::geometry) AS lon,
              -- CAMP-352. Обрис ділянки, коли він є; NULL, коли кемпінг
              -- у OSM позначений крапкою.
              --
              -- 🔴 Віддаємо БЕЗ спрощення. Спокуса пропустити через
              -- ST_SimplifyPreserveTopology є завжди, але заміряно
              -- 20.10.2026 на 1 292 контурах: у середньому 614 байт і 24
              -- вершини, найбільший 12 308 байт і 515 вершин. Це мало,
              -- тож спрощення лише спотворило б форму ділянки заради
              -- економії, якої не видно. Якщо числа колись виростуть —
              -- спершу переміряти, а не вгадати.
              ST_AsGeoJSON(s.outline) AS outline,
              s.amenities, s.owner_overrides, s.last_seen_at, s.missing_since,
              s.context, s.description, s.description_lang, s.stars,
              s.website, s.contact, s.sources,
              -- 🔴 CAMP-287 крок 4. Коди зон попереджень, записані
              -- кроком 1. Без них сторінка не може спитати «чи це
              -- попередження про мене»: матчер зіставляє саме коди, а
              -- не країну — хорватське попередження на всіх хорватських
              -- кемпінгах це тривога там, де її немає.
              --
              -- NULL означає «резолвер сюди не дійшов», порожній масив
              -- — «дійшов і кодів немає». Різницю сторінка показує
              -- по-різному. (Без зворотних лапок: ми всередині
              -- шаблонного рядка, і файл попереджає про це вище.)
              s.warning_areas,
              -- 🔴 CAMP-255. The status through the ONE gate every reader
              -- uses (overnight.ts), so a status with no source reads as
              -- unknown here exactly as it does on the map. The raw source
              -- and the day travel with it: the page prints both beside
              -- the claim. (No backticks: template literal.)
              ${overnightStatusSql('s')} AS overnight_status,
              s.overnight_source,
              ${OVERNIGHT_DAY_SQL('s')} AS overnight_checked_at,
              -- 🔴 CAMP-256. The day a MAPPER last edited the OSM record —
              -- NOT s.last_seen_at, selected earlier in this list, which is
              -- the day our importer last found it and moves every week. The page
              -- prints this one under the words "Record last edited", and
              -- it is selected by its own name so that nothing downstream
              -- can reach for the other by mistake. NULL is "not known".
              -- (No backticks: template literal.)
              s.osm_record_edited_at,
              -- 🔴 CAMP-144. The other sources' rows, joined in — not
              -- merged in SQL. Which field wins is a decision with
              -- reasons behind it (mergeLinked, below), and a reason
              -- cannot be written in a coalesce() list.
              --
              -- 🔴 CAMP-280: they arrive as ONE ordered array, in
              -- linked.rows below, because there can be several. Nine
              -- columns naming linked.id and friends survived the change
              -- here for a while and made every campsite page a 500 --
              -- the lateral no longer has them. Nothing in this list may
              -- reach past linked.rows. (No backticks: this comment is
              -- inside a template literal.)
              -- 🔴 CAMP-147. Read for BOTH rows, and the link is not a
              -- nicety here: of the 1 200 pages that can show a price,
              -- 648 get it only through their DATAtourisme secondary.
              -- OpenStreetMap carries no tariffs at all, so reading
              -- s.id alone would have halved the feature and the
              -- measurement would still have looked plausible.
              ${tariffsSql('s.id')} AS tariffs,
              ${withheldTariffCountSql('s.id')} AS tariffs_withheld,
              -- 🔴 CAMP-280. The secondaries' tariffs are read INSIDE the
              -- lateral, once per row, because there can be more than one
              -- of them and a price list belongs to the record it was
              -- published in.
              linked.rows AS linked_rows,
              -- 🔴 CAMP-168, and read for the primary row ONLY, unlike
              -- the tariffs. A bathing water is chosen by geography, and
              -- linked secondary is the same campsite under another
              -- source's name a few dozen metres away — so it would
              -- return the same row, and "merging" two identical answers
              -- would be a rule with nothing to decide.
              ${nearestBathingWaterSql('s.location')} AS bathing_water,
              -- 🔴 CAMP-164, primary row only, for the reason above: air
              -- is chosen by geography, and the linked secondary would
              -- return the same station.
              ${airQualitySql('s.location', 's.id')} AS air_quality,
              -- 🔴 CAMP-190, primary row only, for the reason above the
              -- bathing water: a camera is chosen by geography, and the
              -- linked secondary is the same campsite a few dozen metres
              -- away, so it would return the same cameras.
              ${nearbyWebcamsSql('s.location')} AS webcams,
              -- 🔴 Has the catalogue been imported AT ALL? One cheap
              -- EXISTS, and it is what lets the page tell "no camera
              -- near this campsite" from "no cameras anywhere yet".
              EXISTS (SELECT 1 FROM webcams LIMIT 1) AS webcams_imported,
              (NOT ${NOTHING_TO_SAY_SQL}
               OR linked.has_stars
               OR linked.has_description) AS indexable
         FROM camping_spots s${linkedSecondariesJoin({
           linked_tariffs: tariffsSql('x.id'),
           linked_tariffs_withheld: withheldTariffCountSql('x.id'),
         })}
        WHERE s.slug = $1
        LIMIT 1`;
