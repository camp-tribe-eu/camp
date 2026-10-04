"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const nearby_1 = require("./src/webcams/nearby");
async function main() {
    const c = new pg_1.default.Client({ connectionString: process.env.PGURL });
    await c.connect();
    const { rows } = await c.query(`
    SELECT s.slug, ${(0, nearby_1.nearbyWebcamsSql)('s.location')} AS cams
      FROM camping_spots s
     WHERE s.slug = 'camp-bovec'`);
    console.log(JSON.stringify(rows[0].cams));
    await c.end();
}
void main();
//# sourceMappingURL=dump-cams.js.map