import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Налаштування сайту, які редактор міняє сам — CAMP-481.
 *
 * Тут лише те, що СПРАВДІ читає веб. Поле, яке ніхто не читає, не
 * зʼявляється у відповіді навмисно: інакше ми повторимо дефект, заради
 * якого картка заведена, — форму, що не впливає на сайт.
 */
export interface SiteSettingsView {
  /** Опис сайту за замовчуванням: голова документа, OG і Twitter. */
  tagline: string | null;
  /** Речення під назвою в підвалі. */
  footerNote: string | null;
}

@Injectable()
export class SiteSettingsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * 🔴 ПОРОЖНІЙ РЯДОК ПОВЕРТАЄТЬСЯ ЯК `null`, А НЕ ЯК `''`.
   *
   * Редактор, який стер текст і зберіг, і редактор, який ще нічого не
   * вписав, — для сайту це той самий стан: тексту немає. Якби сюди
   * доїхав `''`, веб намалював би порожній абзац, і підвал виглядав би
   * зламаним, а не порожнім. Різницю між «стерли» й «не вписували»
   * зберігає історія в CMS, і вона веб не цікавить.
   */
  async get(language = 'en'): Promise<SiteSettingsView> {
    const rows: Array<{ tagline: string | null; footer_note: string | null }> =
      await this.db.query(
        `SELECT t.tagline, t.footer_note
           FROM site_settings s
           JOIN site_settings_translations t ON t.settings_id = s.id
          WHERE s.singleton AND t.language_code = $1
          LIMIT 1`,
        [language],
      );

    const row = rows[0];
    const trim = (v: string | null | undefined) => {
      const s = (v ?? '').trim();
      return s === '' ? null : s;
    };

    return {
      tagline: trim(row?.tagline),
      footerNote: trim(row?.footer_note),
    };
  }
}
