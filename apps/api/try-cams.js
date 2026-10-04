"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const pg_1 = require("pg");
const nearby_1 = require("/Users/george/Documents/UTD/Claude/camp/apps/api/src/webcams/nearby");
async function main() {
    const c = new pg_1.default.Client({ connectionString: process.env.PGURL });
    await c.connect();
    const { rows } = await c.query(`
    SELECT s.slug, s.name, s.region, ${(0, nearby_1.nearbyWebcamsSql)('s.location')} AS cams
      FROM camping_spots s
     WHERE s.region IN ('Bovec','Zadarska','Faro') AND s.missing_since IS NULL
     ORDER BY s.region, s.slug LIMIT 5`);
    for (const r of rows) {
        console.log(`\n${r.region}/${r.slug} — ${r.name}`);
        if (!r.cams.length) {
            console.log('    (жодної камери в 25 км)');
            continue;
        }
        for (const w of r.cams) {
            const age = w.lastFrameAt ? Math.round((Date.now() - Date.parse(w.lastFrameAt)) / 60000) : null;
            console.log(`   ${String(w.metres).padStart(6)} m  ${String(w.title).slice(0, 38).padEnd(40)} ${(w.categories || []).join('/')}  ${age === null ? '?' : age + ' min'}`);
        }
    }
    await c.end();
}
void main();
//# sourceMappingURL=try-cams.js.map