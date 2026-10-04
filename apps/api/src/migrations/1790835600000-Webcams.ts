import type { MigrationInterface, QueryRunner } from 'typeorm';

// CAMP-190 — the webcams we may point a reader at, and nothing more.
//
// 🔴 WHAT THIS TABLE DELIBERATELY DOES NOT HOLD: pictures.
//
// The Windy terms name two things as a material breach — "continuous
// scanning of a significant number of available Webcams" and
// "downloading of significant portions of the Webcam image history".
// So this stores identifiers, a position and a link, the frames are
// fetched by the reader's browser from Windy's own CDN at the moment
// they look, and we keep no history at all. There is no image column
// here and there must never be one.
//
// 🔴 AND IT HOLDS NO LICENCE TO THE IMAGES, because Windy has none to
// give us. Their terms: the rights "owned by the Provider or the
// Provider's suppliers shall remain the property of the Provider and the
// Provider's suppliers". What we have is permission to use the SERVICE.
// That is why `detail_url` is NOT NULL: every frame we show must be a
// link back to their page, which is their condition and our only
// standing to show it at all.
//
// Measured before any of this was written (CAMP-189, 04.10.2026):
// 20 841 cameras across all 27 member states, 88% of campsites have one
// within 25 km, and the median frame is 8 minutes old.

/** Categories a camper is served by. Anything else is noise beside a campsite. */
export const WEBCAM_CATEGORIES = [
  'beach',
  'coast',
  'lake',
  'river',
  'mountain',
  'landscape',
  'forest',
  'meteo',
] as const;

export class Webcams1790835600000 implements MigrationInterface {
  name = 'Webcams1790835600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS webcams (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        provider     text NOT NULL,
        ref          text NOT NULL,
        title        text NOT NULL,
        country      text NOT NULL,
        categories   text[] NOT NULL DEFAULT '{}',
        location     geography(Point, 4326) NOT NULL,
        -- 🔴 Their page for this camera. The terms require every image we
        -- show to link back to it, so a row that cannot be linked is a
        -- row we may not render.
        detail_url   text NOT NULL,
        -- The operator's own site, where they publish one. They do not
        -- ask for this; we show it because the camera is theirs, not
        -- Windy's.
        provider_url text,
        -- When the camera last reported, as the catalogue stated it at
        -- our last read. A fact about the CAMERA, never about the frame
        -- a reader is looking at.
        last_frame_at timestamptz,
        fetched_at   timestamptz NOT NULL DEFAULT now(),

        -- 🔴 Two letters or nothing. CAMP-158: a source that answers
        -- with its own country spelling puts a word on our page that
        -- nobody chose. Windy answers ISO here — measured, both ways:
        -- GR returns 514 cameras and EL returns 0 — but the constraint
        -- is what keeps that true after the next schema change there.
        CONSTRAINT webcams_country_iso CHECK (country ~ '^[A-Z]{2}$'),

        -- 🔴 A camera whose own NAME says a word the CEMS terms reserve
        -- cannot be stored, because it would be printed beside
        -- Copernicus drought data under our voice.
        --
        -- Here rather than in the page: a row that cannot exist needs no
        -- filter at render time, and putting the check in the web lib
        -- meant importing the CEMS word list into it — which dragged
        -- thirty-odd pages into the coverage guard's graph.
        --
        -- The same list as apps/web/src/lib/cems.ts, written as a
        -- Postgres pattern, with the backslashes DOUBLED.
        --
        -- 🔴 This is a JS template literal, in which a lone backslash-m
        -- is not an escape and collapses to a plain m. The first version
        -- shipped exactly that: the constraint stored a pattern with no
        -- word boundary at all, matched nothing, and the table happily
        -- accepted "flood warning cam". Proved by reading
        -- pg_get_constraintdef back from the server, which is the only
        -- way to know what it actually holds.
        --
        -- Whole words: "Alerta" is a commune and
        -- "brisk" is a word.
        CONSTRAINT webcams_title_sayable CHECK (
          title !~* '\\m(warning|warnings|danger|dangers|dangerous|dangerously|risk|risks|risky|riskier|riskiest|risked|risking|alert|alerts|alerted|alerting|evacuate|evacuates|evacuated|evacuating|evacuation|evacuations)\\M'
        ),

        CONSTRAINT webcams_detail_url_https CHECK (detail_url LIKE 'https://%'),
        CONSTRAINT webcams_provider_url_https
          CHECK (provider_url IS NULL OR provider_url LIKE 'https://%')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_webcams_identity
        ON webcams (provider, ref)
    `);

    // 🔴 The index the campsite page actually uses: a KNN walk from a
    // campsite's point to the nearest cameras. Without it, every one of
    // 65 435 pages measures its distance to all 20 841 rows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_webcams_location
        ON webcams USING gist (location)
    `);

    // Country pages and the coverage report read by country.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_webcams_country ON webcams (country)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS webcams');
  }
}
