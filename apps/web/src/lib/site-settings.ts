import { apiFetch } from "./api";
import { NAV_REVALIDATE_SECONDS } from "./navigation";

/**
 * Налаштування сайту з CMS — CAMP-481.
 *
 * Заміряно 10.11.2026: колекція `site_settings` була видима редактору,
 * порожня (нуль рядків) і не читалась вебом жодного разу. Людина могла
 * змінити підпис у підвалі, побачити «збережено» — і нічого не сталось
 * би. Ця картка розриває саме цей розрив.
 */
export interface SiteSettings {
  tagline: string | null;
  footerNote: string | null;
  /** CAMP-448: соцмережі підвалу. Порожньо — блоку немає. */
  socialLinks: SocialLink[];
}

export type SocialNetwork =
  | "instagram"
  | "facebook"
  | "youtube"
  | "tiktok"
  | "x"
  | "linkedin"
  | "pinterest";

export interface SocialLink {
  network: SocialNetwork;
  url: string;
}

const NETWORKS: readonly SocialNetwork[] = [
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
  "x",
  "linkedin",
  "pinterest",
];

/**
 * 🔴 ВЕБ ПЕРЕВІРЯЄ ЩЕ РАЗ, І ЦЕ НЕ ДУБЛЬ. API розгортається окремо від
 * сайту: сайт зібраний проти старого чи зіпсованого API не повинен
 * перетворити чужий рядок на `href` кожної сторінки. Один зіпсований запис
 * відпадає сам, решта лишається.
 */
export function cleanSocialLinks(raw: unknown): SocialLink[] {
  if (!Array.isArray(raw)) return [];
  const out: SocialLink[] = [];
  for (const row of raw) {
    const r = row as { network?: unknown; url?: unknown } | null;
    if (!r || typeof r.network !== "string" || typeof r.url !== "string") continue;
    if (!NETWORKS.includes(r.network as SocialNetwork)) continue;
    try {
      if (new URL(r.url).protocol !== "https:") continue;
    } catch {
      continue;
    }
    out.push({ network: r.network as SocialNetwork, url: r.url });
  }
  return out;
}

/**
 * 🔴 ВИТРИМКА ТА САМА, ЩО В МЕНЮ, І ЦЕ НАВМИСНО.
 *
 * Next бере МІНІМУМ витримки по дереву маршруту, а і меню, і ці
 * налаштування живуть у кореневому макеті — тобто обидва стають
 * витримкою кожної сторінки сайту. Поставити тут менше число означало
 * б тихо пришвидшити перевидання всіх 55 тисяч сторінок кемпінгів,
 * і дізнались би ми про це з навантаження, а не з коду.
 *
 * Мітки тут немає навмисно: `revalidateTag` на проді переводив
 * десятки тисяч сторінок у 404 до перезапуску служби (CAMP-396), і
 * гачок відтоді роззброєний. Чесне формулювання: правка доходить до
 * читача в межах 15 хвилин, а не «за секунди».
 */
export const SETTINGS_REVALIDATE_SECONDS = NAV_REVALIDATE_SECONDS;

/**
 * 🔴 ЗАПАСНОГО ТЕКСТУ В КОДІ НЕМАЄ, І КИДАТИ ТУТ ТЕЖ НЕ МОЖНА.
 *
 * Два очевидні рішення обидва хибні, тому вибір описаний:
 *
 * • Запасне речення в коді повернуло б той самий хардкод, який картка
 *   прибирає, і зробило б збій невидимим: підвал малювався б
 *   «правильно» і тоді, коли база недосяжна.
 * • Виняток на кожній сторінці (як у `headerNav()`) поклав би ВЕСЬ
 *   сайт через відсутній підпис у підвалі. Площа ураження сторожа
 *   вийшла б більшою за площу дефекту — а це правило в нас уже
 *   оплачене болем.
 *
 * Тому: немає тексту — немає абзацу, сторінка жива. А те, що рядок
 * мусить існувати й бути непорожнім, стереже e2e, який червоніє в
 * прогоні, а не кладе прод.
 */
export async function siteSettings(): Promise<SiteSettings> {
  const res = await apiFetch("/site-settings", {
    next: { revalidate: SETTINGS_REVALIDATE_SECONDS },
  });
  if (!res.ok) return { tagline: null, footerNote: null, socialLinks: [] };

  const body = (await res.json()) as Partial<
    Record<keyof SiteSettings, unknown>
  >;
  const clean = (v: unknown) =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  return {
    tagline: clean(body.tagline),
    footerNote: clean(body.footerNote),
    socialLinks: cleanSocialLinks(body.socialLinks),
  };
}
