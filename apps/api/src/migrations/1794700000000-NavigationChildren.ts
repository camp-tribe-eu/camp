import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CAMP-448 (1/2) — три готові сторінки стають підпунктами меню.
 *
 * 🔴 ЗНАЙШОВ ВЛАСНИК 08.11.2026: «В нас багато сторінок але ми на них не
 * можемо потрапити і це баг», і про калькулятор окремо: «Сторінка є а в
 * меню хедера не виведена… чого сховав?». Заміряно на проді (`curl
 * /navigation`): 11 рядків, усі кореневі, підпунктів 0. Статичних
 * маршрутів у застосунку 28; з тих, яким у меню місце, бракувало рівно
 * трьох — і це рівно ті, що назвав власник.
 *
 * 🔴 ЧОМУ ДІТЬМИ, А НЕ КОРЕНЯМИ. У шапці вже десять пунктів; без JS вони
 * малюються одним рядом (CAMP-383 показала, як легко вилізти за екран).
 * Калькулятор і список речей — інструменти, компанії — частина оренди;
 * схема має `parent_id` саме для цього, а від сьогодні його читає й шапка
 * (`site-nav-dropdown.tsx`). Додавати ці рядки ДО того, як шапка навчилась
 * показувати дітей, було б безглуздо: їх не побачив би ніхто.
 *
 * 🔴 ПІДПИС ЙДЕ В `navigation_translations` — у самій `navigation`
 * колонки з підписом немає (на цьому вже спотикались у CAMP-397). Мова —
 * `en`, і це не вибір навмання: обидві попередні міграції меню
 * (`SeedNavigation`, `ContactInFooter`) сіяли лише `en`, і на проді всі 11
 * перекладів — `en` (заміряно 08.11.2026). Пункт без перекладу API не
 * віддає, тож інші мови дістануть ці рядки тоді, коли власник їх
 * перекладе в CMS, а не з вигаданого тут тексту.
 *
 * 🔴 `down()` прибирає РІВНО те, що додав `up()`: три рядки за трійкою
 * (location, href, батько) і їхні переклади. Умова на батька стоїть
 * навмисно — кореневий `/tools/camper-trip-cost`, якби власник завів
 * його сам, відкат не зачепить.
 */
export class NavigationChildren1794700000000 implements MigrationInterface {
  name = 'NavigationChildren1794700000000';

  /** [адреса батька, адреса дитини, sort серед дітей, підпис]. */
  private readonly children: Array<[string, string, number, string]> = [
    ['/tools', '/tools/camper-trip-cost', 0, 'Trip cost calculator'],
    ['/tools', '/tools/camper-packing-list', 1, 'Packing list'],
    ['/camper-rental', '/camper-rental/providers', 0, 'Rental companies'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [parentHref, href, sort, label] of this.children) {
      const parent = (await queryRunner.query(
        `SELECT id FROM navigation
          WHERE location = 'header' AND href = $1 AND parent_id IS NULL
          LIMIT 1`,
        [parentHref],
      )) as Array<{ id: string }>;
      // 🔴 Батька немає — це збій, не пропуск. Мовчки пропустити означало
      // б накотити міграцію «успішно» і лишити сторінку невидимою далі.
      if (parent.length === 0) {
        throw new Error(
          `CAMP-448: у меню немає кореневого пункту ${parentHref}, ` +
            `під який мав стати ${href}. Перевір SeedNavigation і рядки header.`,
        );
      }

      // Ідемпотентно: повтор після відкату не має дати дубля.
      const existing = (await queryRunner.query(
        `SELECT id FROM navigation
          WHERE location = 'header' AND href = $1 AND parent_id = $2
          LIMIT 1`,
        [href, parent[0].id],
      )) as Array<{ id: string }>;
      if (existing.length > 0) continue;

      const row = (await queryRunner.query(
        `INSERT INTO navigation (location, sort, href, parent_id, visible)
         VALUES ('header', $1, $2, $3, true) RETURNING id`,
        [sort, href, parent[0].id],
      )) as Array<{ id: string }>;

      await queryRunner.query(
        `INSERT INTO navigation_translations (navigation_id, language_code, label)
         VALUES ($1, 'en', $2)`,
        [row[0].id, label],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [parentHref, href] of this.children) {
      await queryRunner.query(
        `DELETE FROM navigation_translations WHERE navigation_id IN
           (SELECT c.id FROM navigation c
              JOIN navigation p ON p.id = c.parent_id
             WHERE c.location = 'header' AND c.href = $1
               AND p.location = 'header' AND p.href = $2 AND p.parent_id IS NULL)`,
        [href, parentHref],
      );
      await queryRunner.query(
        `DELETE FROM navigation c
          USING navigation p
          WHERE p.id = c.parent_id
            AND c.location = 'header' AND c.href = $1
            AND p.location = 'header' AND p.href = $2 AND p.parent_id IS NULL`,
        [href, parentHref],
      );
    }
  }
}
