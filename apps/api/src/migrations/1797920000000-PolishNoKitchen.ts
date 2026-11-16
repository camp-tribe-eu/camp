import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Поліш: внутрішня кухня зникає з публічних сторінок, що живуть у CMS.
 *
 * Три правки, усі без видалення рядків і всі ідемпотентні:
 *
 * 1. Головна: секція `hero` («Every campsite, and what is around it» +
 *    вступний абзац) ховається (`visible = false`). h1 головної тепер —
 *    перший слайд; старий блок під слайдером був дублем заголовка.
 *    Рядок лишається в базі, `down()` його повертає.
 *
 * 2. Головна, слот `notable`: з підпису прибрано «we have not been to any of
 *    them, and there are no reviews on this site». Пояснення ранжування
 *    («ranked by how much has actually been recorded…», UCPD 7(4a))
 *    ЛИШАЄТЬСЯ — воно пояснює критерій читачеві, а не наш беклог.
 *
 * 3. Речення про вивантаження на /contact. Міграція 1797464100000 уже
 *    підміняє його при розкладі сторінки, але лише для «недоторканої»
 *    сторінки; тут те саме речення виправляється там, де воно лишилось.
 */
export class PolishNoKitchen1797920000000 implements MigrationInterface {
  name = 'PolishNoKitchen1797920000000';

  private readonly notableOld =
    'Ranked by how much has actually been recorded about them, not by any ' +
    'opinion of ours — we have not been to any of them, and there are no ' +
    'reviews on this site.';
  private readonly notableNew =
    'Ranked by how much has actually been recorded about them, not by any ' +
    'opinion of ours.';

  private readonly uploadsOld =
    'Uploads through the site do not exist yet, so email is the whole of it.';
  private readonly uploadsNew =
    'Email is all it takes — there is nothing else to fill in.';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE page_sections SET visible = false
        WHERE type = 'hero'
          AND page_id IN (SELECT id FROM pages WHERE slug = 'home' AND type = 'page')`,
    );
    await this.swap(q, this.notableOld, this.notableNew);
    await this.swap(q, this.uploadsOld, this.uploadsNew);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE page_sections SET visible = true
        WHERE type = 'hero'
          AND page_id IN (SELECT id FROM pages WHERE slug = 'home' AND type = 'page')`,
    );
    await this.swap(q, this.notableNew, this.notableOld);
    await this.swap(q, this.uploadsNew, this.uploadsOld);
  }

  /** Підміна в `body`, лише де старе речення справді є (повтор — нуль рядків). */
  private async swap(q: QueryRunner, from: string, to: string): Promise<void> {
    await q.query(
      `UPDATE page_section_translations
          SET body = replace(body, $1::text, $2::text)
        WHERE position($1::text in body) > 0`,
      [from, to],
    );
  }
}
