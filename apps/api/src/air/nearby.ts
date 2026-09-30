// CAMP-164: what a campsite page may say about the air — the FACTS, in
// SQL, on the way out of the database.
//
// 🔴 FACTS, NOT A VERDICT. There is no `now()` anywhere in the query
// below, and that is on purpose: whether a reading is fresh enough to
// show is decided where it is shown (apps/web/src/lib/air-quality.ts),
// against the reader's clock, because a statically built page outlives
// the import that fed it. The same query run at build time and an hour
// later must give the same bytes, or a statically built site rewrites
// every page it has whenever the clock ticks — the lesson tariffsSql and
// nearestBathingWaterSql already record.
//
// 🔴 THREE MUTUALLY EXCLUSIVE ANSWERS, chosen by geography and nothing
// else, in this order:
//
//   station   the nearest EEA station within AIR_RADIUS_M — and if it is
//             silent, that is the answer: a station that is not
//             reporting is a station that is not reporting, and it does
//             NOT hand the page to the model. `reading` is null then.
//   modelled  no station within the radius: the 1 km modelled index for
//             this campsite, if the import found the model covers it.
//   none      no station and no model value. Said out loud on the page.
//
// It is one scalar subquery, so it can sit in a SELECT list like the
// bathing water's.
//
// 🔴 `ORDER BY … , st.code`. Two stations at an identical distance would
// otherwise swap between builds and rewrite pages whose content did not
// change.

import {
  AIR_RADIUS_M,
  type AirBasis,
  type AirPollutant,
  type AirStationType,
} from './source';
import type { PollutantReading } from './parse';

export interface AirStationFacts {
  code: string;
  name: string;
  municipality: string | null;
  type: AirStationType;
  /** Straight-line metres from the campsite. Honest: not a walking route. */
  metres: number;
}

export interface AirReadingFacts {
  /** The hour reported, ISO 8601 UTC. */
  hour: string;
  band: number;
  /** 🔴 `reported` or `mixed`. Never `modelled`: a station row cannot hold that. */
  basis: AirBasis;
  culprit: AirPollutant;
  pollutants: PollutantReading[];
  /** When WE read the station's file, ISO 8601 UTC. */
  readAt: string;
}

export type AirQualityFacts =
  | {
      kind: 'station';
      station: AirStationFacts;
      /** null: the station has no reported hour we hold. */
      reading: AirReadingFacts | null;
    }
  | {
      kind: 'modelled';
      modelled: { hour: string; band: number; readAt: string };
    }
  | { kind: 'none' };

/** A timestamptz as ISO 8601 UTC, spelled one way. */
const iso = (col: string): string =>
  `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export function airQualitySql(
  spotLocationExpr: string,
  spotIdExpr: string,
  radiusM: number = AIR_RADIUS_M,
): string {
  return `(
    SELECT COALESCE(
      (SELECT json_build_object(
                'kind', 'station',
                'station', json_build_object(
                  'code', st.code,
                  'name', st.name,
                  'municipality', st.municipality,
                  'type', st.station_type,
                  'metres', round(ST_Distance(${spotLocationExpr}::geography, st.location))::int
                ),
                'reading', CASE WHEN st.reading_hour IS NULL THEN NULL
                  ELSE json_build_object(
                    'hour', ${iso('st.reading_hour')},
                    'band', st.reading_band,
                    'basis', st.reading_basis,
                    'culprit', st.reading_culprit,
                    'pollutants', st.reading_pollutants,
                    'readAt', ${iso('st.read_at')}
                  ) END
              )
         FROM air_quality_stations st
        WHERE ST_DWithin(${spotLocationExpr}::geography, st.location, ${radiusM})
        ORDER BY ${spotLocationExpr}::geography <-> st.location, st.code
        LIMIT 1),
      (SELECT json_build_object(
                'kind', 'modelled',
                'modelled', json_build_object(
                  'hour', ${iso('m.hour')},
                  'band', m.band,
                  'readAt', ${iso('m.read_at')}
                )
              )
         FROM air_quality_modelled m
        WHERE m.spot_id = ${spotIdExpr}),
      json_build_object('kind', 'none')
    )
  )`;
}
