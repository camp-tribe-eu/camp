import type { MigrationInterface, QueryRunner } from 'typeorm';

// CAMP-190 follow-up — the image address the API gave us, stored as given.
//
// 🔴 WHY THIS COLUMN EXISTS. Windy's Webcams API terms list "image URL
// usage other than provided by the API" among the misuses that end the
// service. Until now the page BUILT the address from the camera id
// (`frameUrl`), which is exactly that. The address now comes from the
// API's own `images.daylight.preview` at collection time and is stored
// here untouched.
//
// 🔴 IT IS AN ADDRESS, NOT A PICTURE. The first migration of this table
// says there must never be an image column, and this is not one: a
// reader's browser still fetches the frame from Windy's CDN at the moment
// they look, we keep no bytes and no history. The CHECK below pins the
// host to the one the page's CSP `img-src` allows, so a row that points
// anywhere else cannot be stored rather than being stored and blocked in
// every reader's browser.
//
// Nullable, and no backfill: a row imported before this column has no
// address from the API, and inventing one from its id is the thing this
// change removes. The page treats such a row as unusable until the next
// collection run replaces it.
export class WebcamImageUrl1793700000000 implements MigrationInterface {
  name = 'WebcamImageUrl1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE webcams ADD COLUMN IF NOT EXISTS image_url text`);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TABLE webcams ADD CONSTRAINT webcams_image_url_host
          CHECK (image_url IS NULL OR image_url LIKE 'https://imgproxy.windy.com/%');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE webcams DROP CONSTRAINT IF EXISTS webcams_image_url_host`);
    await queryRunner.query(`ALTER TABLE webcams DROP COLUMN IF EXISTS image_url`);
  }
}
