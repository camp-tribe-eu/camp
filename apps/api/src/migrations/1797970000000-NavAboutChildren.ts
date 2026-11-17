import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-441 (13): the «About» dropdown in the header had one child, Contact.
 * The owner asked for a real dropdown — «About us, Contacts…». It becomes:
 * About us, Contact, Legal notice, Data sources.
 *
 * Rows in `navigation`, so the owner edits them in Directus afterwards.
 * Idempotent: a child already under /about (by href) is left alone, and the
 * existing Contact row keeps its place; new rows are sorted around it.
 * `down` removes only the three rows this migration adds.
 */
const CHILDREN: ReadonlyArray<{ href: string; label: string; sort: number }> = [
  { href: '/about', label: 'About us', sort: -1 },
  { href: '/legal/notice', label: 'Legal notice', sort: 50 },
  { href: '/legal/attribution', label: 'Data sources', sort: 51 },
];

export class NavAboutChildren1797970000000 implements MigrationInterface {
  name = 'NavAboutChildren1797970000000';

  private async parentId(q: QueryRunner): Promise<string> {
    const parent = (await q.query(
      `SELECT id FROM navigation
        WHERE location = 'header' AND href = '/about' AND parent_id IS NULL
        LIMIT 1`,
    )) as Array<{ id: string }>;
    if (parent.length === 0) {
      throw new Error(
        'CAMP-441/13: у шапці немає пункту /about, під який мають стати ' +
          'дочірні. Перевір HeaderFooterMenus1797480000000.',
      );
    }
    return parent[0].id;
  }

  public async up(q: QueryRunner): Promise<void> {
    const parent = await this.parentId(q);
    for (const c of CHILDREN) {
      const seen = (await q.query(
        `SELECT id FROM navigation WHERE location = 'header' AND href = $1 AND parent_id = $2`,
        [c.href, parent],
      )) as Array<{ id: string }>;
      if (seen.length > 0) continue;
      const row = (await q.query(
        `INSERT INTO navigation (location, sort, href, parent_id, visible)
         VALUES ('header', $1, $2, $3, true) RETURNING id`,
        [c.sort, c.href, parent],
      )) as Array<{ id: string }>;
      await q.query(
        `INSERT INTO navigation_translations (navigation_id, language_code, label)
         VALUES ($1, 'en', $2)`,
        [row[0].id, c.label],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const parent = await this.parentId(q);
    for (const c of CHILDREN) {
      await q.query(
        `DELETE FROM navigation_translations t USING navigation n
          WHERE t.navigation_id = n.id AND n.location = 'header'
            AND n.href = $1 AND n.parent_id = $2`,
        [c.href, parent],
      );
      await q.query(
        `DELETE FROM navigation WHERE location = 'header' AND href = $1 AND parent_id = $2`,
        [c.href, parent],
      );
    }
  }
}
