import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { AirBasis, AirStationType } from '../air/source';
import type { PollutantReading } from '../air/parse';

/**
 * CAMP-164: one EEA air quality monitoring station, with the newest hour
 * in which it REPORTED anything.
 *
 * The reasoning — why the reading is on the station row, why the basis
 * can never be "modelled", why `country` is checked against the 27 — is
 * in the migration, next to the constraints that enforce it. This class
 * only names the columns; nothing reads or writes through it (the page
 * reads by SQL, in air/nearby.ts, the import writes by SQL).
 */
@Entity('air_quality_stations')
export class AirQualityStation {
  /** The EEA's own code, e.g. `DEBB021`. The first two letters are the country. */
  @PrimaryColumn({ type: 'text' })
  code: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  municipality: string | null;

  /** Lower-case ISO 3166-1 alpha-2 — `gr`, and only one of the 27. */
  @Column({ type: 'text' })
  country: string;

  @Column({ name: 'station_type', type: 'text' })
  stationType: AirStationType;

  @Column({ name: 'area_classification', type: 'text', nullable: true })
  areaClassification: string | null;

  /** geography(Point,4326). */
  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  location: string;

  /** The roster file this row was last seen in. Rows from an older one are deleted. */
  @Column({ name: 'roster_file', type: 'text' })
  rosterFile: string;

  /** 🔴 All of `reading_*` are null, or all are set. Never half. */
  @Column({ name: 'reading_hour', type: 'timestamptz', nullable: true })
  readingHour: Date | null;

  @Column({ name: 'reading_index', type: 'numeric', nullable: true })
  readingIndex: string | null;

  @Column({ name: 'reading_band', type: 'smallint', nullable: true })
  readingBand: number | null;

  /** 🔴 `reported` or `mixed`. A fully modelled hour is not storable. */
  @Column({ name: 'reading_basis', type: 'text', nullable: true })
  readingBasis: AirBasis | null;

  @Column({ name: 'reading_culprit', type: 'text', nullable: true })
  readingCulprit: string | null;

  @Column({ name: 'reading_pollutants', type: 'jsonb', nullable: true })
  readingPollutants: PollutantReading[] | null;

  /** When WE last read this station's file. Not when the station reported. */
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;
}

/**
 * CAMP-164: the 1 km modelled index at one campsite that has no station
 * within AIR_RADIUS_M. A model output, and the only place a page shows
 * one — labelled as such.
 */
@Entity('air_quality_modelled')
export class AirQualityModelled {
  @PrimaryColumn({ name: 'spot_id', type: 'uuid' })
  spotId: string;

  /** The hour the model was sampled for. */
  @Column({ type: 'timestamptz' })
  hour: Date;

  /** Index level 1–6. */
  @Column({ type: 'smallint' })
  band: number;

  @Column({ name: 'read_at', type: 'timestamptz' })
  readAt: Date;
}
