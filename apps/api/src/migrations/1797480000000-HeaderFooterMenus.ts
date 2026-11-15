import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-448 — підвал як навігація, а не чотири текстові колонки, і Contact
 * під About у шапці.
 *
 * 🔴 ЗАМІРЯНО 15.11.2026 (звірка з ревю, A1): у підвалі з CMS стояв один
 * пункт — Contact, корінь без дітей; решта меню в підвалі не була
 * представлена зовсім. А у шапці About — пласке посилання, хоча картка
 * просить розкривач із дочірніми.
 *
 * 🔴 ЩО РОБИТЬ МІГРАЦІЯ — ЛИШЕ ДОДАЄ Й ОДИН РАЗ ПЕРЕПІДПОРЯДКОВУЄ:
 *
 *   шапка   About  → дитина Contact (/contact)
 *   підвал  три колонки-корені, кожна — справжня сторінка:
 *             Campsites /camping → Map, Search, Routes, Guides
 *             Plan      /plan    → Tools, Trip cost calculator,
 *                                  Packing list, Camper rental,
 *                                  Rental companies
 *             CampTribe /about   → Blog, Contact
 *
 * 🔴 ЗАГОЛОВОК КОЛОНКИ — ПОСИЛАННЯ, а не рядок тексту: `navigation.href`
 * NOT NULL, і порожню адресу туди не покласти. Тож кожен заголовок веде на
 * справжню сторінку, і сторож «кожен пункт відкривається» його перевіряє
 * так само, як решту.
 *
 * 🔴 `Contact` У ПІДВАЛІ ВЖЕ Є — корінь, посіяний `ContactInFooter`. Його не
 * дублюємо: він ПЕРЕХОДИТЬ під колонку CampTribe (`parent_id`). `down()`
 * повертає його коренем. Нічого не видаляється, крім рядків, які додав
 * `up()`: за трійкою (location, href, батько).
 *
 * 🔴 ПІДПИС — В `navigation_translations`, мова `en` (як усі попередні
 * міграції меню). Країни сюди НЕ сіються: вони приходять з даних
 * (`lib/nav-groups.ts`) — рядок на країну без сторінки і є мертве
 * посилання в меню.
 */
export class HeaderFooterMenus1797480000000 implements MigrationInterface {
  name = 'HeaderFooterMenus1797480000000';

  /** Колонки підвалу: [адреса, підпис, sort, діти [адреса, підпис]]. */
  private readonly footerColumns: Array<
    [string, string, number, Array<[string, string]>]
  > = [
    [
      '/camping',
      'Campsites',
      0,
      [
        ['/map', 'Map'],
        ['/search', 'Search'],
        ['/routes', 'Routes'],
        ['/guides', 'Guides'],
      ],
    ],
    [
      '/plan',
      'Plan',
      1,
      [
        ['/tools', 'Tools'],
        ['/tools/camper-trip-cost', 'Trip cost calculator'],
        ['/tools/camper-packing-list', 'Packing list'],
        ['/camper-rental', 'Camper rental'],
        ['/camper-rental/providers', 'Rental companies'],
      ],
    ],
    // Contact — уже в підвалі; сюди він ПЕРЕХОДИТЬ, а не дублюється.
    ['/about', 'CampTribe', 2, [['/blog', 'Blog']]],
  ];

  private async find(
    q: QueryRunner,
    location: 'header' | 'footer',
    href: string,
    parentId: string | null,
  ): Promise<string | null> {
    const rows = (await q.query(
      `SELECT id FROM navigation
        WHERE location = $1 AND href = $2
          AND parent_id IS NOT DISTINCT FROM $3
        LIMIT 1`,
      [location, href, parentId],
    )) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }

  private async insert(
    q: QueryRunner,
    location: 'header' | 'footer',
    href: string,
    label: string,
    sort: number,
    parentId: string | null,
  ): Promise<string> {
    const existing = await this.find(q, location, href, parentId);
    if (existing) return existing;
    const row = (await q.query(
      `INSERT INTO navigation (location, sort, href, parent_id, visible)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [location, sort, href, parentId],
    )) as Array<{ id: string }>;
    await q.query(
      `INSERT INTO navigation_translations (navigation_id, language_code, label)
       VALUES ($1, 'en', $2)`,
      [row[0].id, label],
    );
    return row[0].id;
  }

  public async up(q: QueryRunner): Promise<void> {
    // Шапка: Contact під About. Батька немає — збій, не мовчазний пропуск.
    const about = await this.find(q, 'header', '/about', null);
    if (!about) {
      throw new Error(
        'CAMP-448: у шапці немає кореневого /about, під який мав стати /contact',
      );
    }
    await this.insert(q, 'header', '/contact', 'Contact', 0, about);

    // Підвал: колонки.
    for (const [href, label, sort, kids] of this.footerColumns) {
      const col = await this.insert(q, 'footer', href, label, sort, null);
      let n = 0;
      for (const [kidHref, kidLabel] of kids) {
        await this.insert(q, 'footer', kidHref, kidLabel, n++, col);
      }
      if (href === '/about') {
        // Існуючий кореневий Contact переходить під CampTribe.
        const contact = await this.find(q, 'footer', '/contact', null);
        if (contact) {
          await q.query(
            `UPDATE navigation SET parent_id = $1, sort = $2 WHERE id = $3`,
            [col, n, contact],
          );
        } else {
          await this.insert(q, 'footer', '/contact', 'Contact', n, col);
        }
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    const about = await this.find(q, 'footer', '/about', null);
    if (about) {
      // Contact повертається коренем, як його лишив ContactInFooter.
      await q.query(
        `UPDATE navigation SET parent_id = NULL, sort = 10
          WHERE location = 'footer' AND href = '/contact' AND parent_id = $1`,
        [about],
      );
    }
    const remove = async (
      location: 'header' | 'footer',
      href: string,
      parentHref: string | null,
    ) => {
      await q.query(
        `DELETE FROM navigation c
          WHERE c.location = $1 AND c.href = $2
            AND (
              ($3::text IS NULL AND c.parent_id IS NULL)
              OR c.parent_id IN (
                SELECT p.id FROM navigation p
                 WHERE p.location = $1 AND p.href = $3 AND p.parent_id IS NULL
              )
            )`,
        [location, href, parentHref],
      );
    };
    await remove('header', '/contact', '/about');
    for (const [href, , , kids] of [...this.footerColumns].reverse()) {
      for (const [kidHref] of kids) await remove('footer', kidHref, href);
      await remove('footer', href, null);
    }
  }
}
