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
  /**
   * 🔴 CAMP-448. Соцмережі підвалу — лише ті, що редактор вписав І які
   * пройшли перевірку (`parseSocialLinks`). Порожній масив — блоку в
   * підвалі немає: кнопка без адреси гірша за відсутню.
   */
  socialLinks: SocialLink[];
}

export interface SocialLink {
  network: SocialNetwork;
  url: string;
}

/** Мережі, для яких підвал має іконку. Порядок = порядок кнопок. */
export const SOCIAL_NETWORKS = [
  'instagram',
  'facebook',
  'youtube',
  'tiktok',
  'x',
  'linkedin',
  'pinterest',
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/**
 * `site_settings.social_links` (jsonb, `{"instagram": "https://…"}`) →
 * впорядкований масив. 🔴 ОДИН ЗІПСОВАНИЙ ЗАПИС КОШТУЄ ОДНОГО ЗАПИСУ:
 * невідома мережа, не-рядок, не `https:` або порожній рядок відпадають
 * поодинці, решта доїжджає. `javascript:` і `http:` не проходять, бо
 * адреса стане `href` кнопки на кожній сторінці сайту.
 */
export function parseSocialLinks(raw: unknown): SocialLink[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const map = raw as Record<string, unknown>;
  const out: SocialLink[] = [];
  for (const network of SOCIAL_NETWORKS) {
    const v = map[network];
    if (typeof v !== 'string') continue;
    const text = v.trim();
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || url.hostname === '') continue;
    out.push({ network, url: url.toString() });
  }
  return out;
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
    const rows: Array<{
      tagline: string | null;
      footer_note: string | null;
      social_links: unknown;
    }> = await this.db.query(
        `SELECT t.tagline, t.footer_note, s.social_links
           FROM site_settings s
      LEFT JOIN site_settings_translations t
             ON t.settings_id = s.id AND t.language_code = $1
          WHERE s.singleton
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
      // 🔴 LEFT JOIN, не JOIN: адреси соцмереж не залежать від мови, і
      // відсутній переклад не мусить забирати з собою кнопки.
      socialLinks: parseSocialLinks(row?.social_links),
    };
  }
}
