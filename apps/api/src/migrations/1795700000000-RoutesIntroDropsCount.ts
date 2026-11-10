import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Вступ `/routes` перестає називати кількість маршрутів — CAMP-479.
 *
 * 🔴 ЦЕ СВІДОМА ЗМІНА ТЕКСТУ, А НЕ ПЕРЕЇЗД. Попередні міграції переносили
 * слова ДОСЛІВНО і казали про це вголос. Ця — навпаки: вона текст
 * ПРАВИТЬ, і тому мусить пояснити чому.
 *
 * Посіяний вступ починався зі слів «Twelve routes through the European
 * Union». Поки маршрути лежали файлом, число трималось само: дванадцять
 * у коді, дванадцять у тексті. Після переїзду маршрути додає редактор —
 * і перший же тринадцятий зробив би це речення неправдою, не зламавши
 * нічого видимого. Речення лишилось би граматично бездоганним.
 *
 * 🔴 ЧОМУ НЕ ПІДСТАВИТИ ЧИСЛО ШАБЛОНОМ. Підстановка в редакційний текст
 * означає, що редактор мусить памʼятати про `{{…}}` і не зламати його
 * правкою. Дешевше прибрати число звідти, де його ніхто не рахує: на
 * сторінці воно вже є двічі — у «All N routes» і в реченні «There are
 * N rather than fifty», і обидва рахуються з даних.
 *
 * 🔴 ІДЕМПОТЕНТНО Й ТОЧКОВО. Заміна відбувається лише там, де текст
 * справді починається зі старого слова: `replace` по всьому body
 * зачепив би будь-який інший «Twelve», і правка редактора, зроблена
 * між деплоями, була б перезаписана мовчки.
 */
export class RoutesIntroDropsCount1795700000000 implements MigrationInterface {
  name = 'RoutesIntroDropsCount1795700000000';

  private readonly before =
    'Twelve routes through the European Union, each one an ordered set of stops';

  private readonly after =
    'Routes through the European Union, each one an ordered set of stops';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE page_section_translations st
          SET body = $2 || substring(st.body from length($1) + 1)
         FROM page_sections s, pages p
        WHERE st.section_id = s.id
          AND s.page_id = p.id
          AND p.slug = 'routes'
          AND st.body LIKE $1 || '%'`,
      [this.before, this.after],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE page_section_translations st
          SET body = $2 || substring(st.body from length($1) + 1)
         FROM page_sections s, pages p
        WHERE st.section_id = s.id
          AND s.page_id = p.id
          AND p.slug = 'routes'
          AND st.body LIKE $1 || '%'`,
      [this.after, this.before],
    );
  }
}
