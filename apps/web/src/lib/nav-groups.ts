import { countryName, getCountries } from "./api";
import type { NavItem } from "./navigation";
import { publishableCountries } from "./rental";

/**
 * CAMP-448 — мега-меню: до пунктів із бази шапка добудовує країни з ДАНИХ.
 *
 * 🔴 ЧОМУ КРАЇНИ НЕ ЛЕЖАТЬ У `navigation`. Пункт меню — рядок бази, який
 * власник правит руками; країна ж зʼявляється в меню в день, коли для неї
 * є сторінка. Двадцять сім рядків, засіяних міграцією, ніколи б не збіглись
 * із країнами, які справді опубліковані: фікстура CI має дві, прод — решту,
 * а Кіпр ми не показуємо взагалі (`unpublished-countries.ts`). Рядок на
 * сторінку, якої немає, — і є «мертве посилання в меню», проти якого стоїть
 * сторож `navigation.spec.ts`.
 *
 * Тому джерело те саме, з якого сторінки й будуються:
 *   • `/camping`       ← `getCountries()` (ті, де є кемпінги, `ax` злито з `fi`);
 *   • `/camper-rental` ← `publishableCountries()` (ті, що пройшли ворота
 *     публікації; країна без неї віддала б 404 на `/camper-rental/[country]`).
 *
 * 🔴 ДАНИХ НЕМАЄ — ГРУПИ НЕМАЄ. Збій читання країн не валить сторінку (шапка
 * живе на кожній): підпункти просто не зʼявляються, а пункт лишається
 * звичайним посиланням. Порожню групу з заголовком не малюємо.
 */

/** Заголовок групи, під якою мега-меню збирає країни. */
export const COUNTRY_GROUP = "By country";

export interface MenuCountry {
  code: string;
  name: string;
}

/** Рядок країни в меню: прапор, назва, адреса сторінки країни. */
function countryChild(base: string, c: MenuCountry): NavItem {
  return {
    href: `${base}/${c.code}`,
    label: c.name,
    children: [],
    flag: c.code,
    group: COUNTRY_GROUP,
  };
}

/**
 * Чиста функція: пункти з бази + країни → пункти для шапки.
 *
 * Пункт, що вже має ДІТЕЙ З БАЗИ, їх зберігає й дістає країни після них.
 * Пункт без країн лишається як є — за посиланням, не за копією, щоб
 * порожній вхід не вигадував нових вузлів.
 */
export function withCountryGroups(
  nav: NavItem[],
  sources: { camping: MenuCountry[]; rental: MenuCountry[] },
): NavItem[] {
  const feeds: Record<string, { base: string; list: MenuCountry[] }> = {
    "/camping": { base: "/camping", list: sources.camping },
    "/camper-rental": { base: "/camper-rental", list: sources.rental },
  };
  return nav.map((item) => {
    const feed = feeds[item.href];
    if (!feed || feed.list.length === 0) return item;
    // Той самий код двічі (дубль у джерелі) — один рядок, а не два.
    const seen = new Set(item.children.map((c) => c.href));
    const added = feed.list
      .map((c) => countryChild(feed.base, c))
      .filter((c) => !seen.has(c.href) && seen.add(c.href));
    return { ...item, children: [...item.children, ...added] };
  });
}

/**
 * Добудувати шапку країнами з даних. Кожне джерело ловить власну помилку:
 * недосяжні країни оренди не повинні забрати країни кемпінгів.
 */
export async function headerNavWithCountries(
  nav: NavItem[],
): Promise<NavItem[]> {
  const [camping, rental] = await Promise.all([
    getCountries()
      .then((rows) =>
        rows.map((c) => ({ code: c.country, name: countryName(c.country) })),
      )
      .catch(() => []),
    publishableCountries()
      .then((rows) => rows.map((c) => ({ code: c.code, name: c.name })))
      .catch(() => []),
  ]);
  camping.sort((a, b) => a.name.localeCompare(b.name, "en"));
  rental.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return withCountryGroups(nav, { camping, rental });
}
