/**
 * Країни, яких ми НЕ ПОКАЗУЄМО читачеві, хоча вони в області проєкту. CAMP-490.
 *
 * 🔴 ЦЕ НЕ ЧАСТИНА `EU_MEMBER_STATES`. Той перелік — копія області проєкту
 * (`apps/api/src/osm/eu-member-states.json`), його читає `drop-non-eu.mjs`,
 * який видаляє з бази все, чого в ньому немає. Кіпр — член Союзу; вилучити
 * його звідти означало б стерти рядки, а рішення власника 11.11.2026
 * («прибери», уперше 26.10.2026) — «не показувати», не «стерти».
 *
 * 🔴 ДРУГА КОПІЯ, І ЦЕ НАЗВАНО. Перша — `apps/api/src/spots/
 * unpublished-countries.ts`, звідки API відсікає рядки. Веб API-воркспейс
 * не імпортує, тож перелік виписано тут; `tests/unit/camping-index.spec.tsx`
 * звіряє обидва файли і червоніє, якщо вони розійшлися.
 *
 * Навіщо вебу власна копія, якщо API кемпінгів Кіпру вже не віддає:
 * сторінка /camping малює плитку для КОЖНОГО з 27 членів, навіть без даних
 * («ще немає»). Без цього списку Кіпр лишився б на ній порожньою плиткою.
 */
export const UNPUBLISHED_COUNTRIES: readonly string[] = ["cy"];

export const isUnpublishedCountry = (code: string): boolean =>
  UNPUBLISHED_COUNTRIES.includes(code.trim().toLowerCase());

/**
 * CAMP-490: код, який НЕ окрема країна, а частина члена Союзу. Сьогодні
 * один: `ax` (Åland) — автономний регіон Фінляндії. Таблиця виписана, а не
 * виведена (та сама дисципліна, що `ISO_SUBDIVISION_OF` в API): правило, що
 * вгадує, «чиє» що, одного дня прийняло б Ліхтенштейн.
 *
 * Читач не бачить такого коду як країни ніколи. Його кемпінги не зникають:
 * вони рахуються під членом (`ax` → `fi`). Міграція `FoldAlandIntoFinland`
 * переписує рядки в базі; `publishedCountries` нижче — другий пояс на
 * випадок, коли API ще віддає старий код.
 */
export const SUBDIVISION_OF: Readonly<Record<string, string>> = { ax: "fi" };

interface CountryRow {
  country: string;
  spots: number;
  regions: number;
}

/**
 * Рядки `/spots/countries` у тому вигляді, в якому їх бачить читач: без
 * прихованих країн, а підрозділ злитий із членом (spots і regions додаються).
 * Зіпсований код (не дві літери) проходить як є — його обробляє споживач,
 * один запис коштує одного запису.
 */
export function publishedCountries<T extends CountryRow>(rows: readonly T[]): T[] {
  const out = new Map<string, T>();
  const passthrough: T[] = [];
  for (const r of rows) {
    if (typeof r?.country !== "string" || !/^[a-z]{2}$/i.test(r.country.trim())) {
      passthrough.push(r);
      continue;
    }
    const raw = r.country.trim().toLowerCase();
    const code = SUBDIVISION_OF[raw] ?? raw;
    if (isUnpublishedCountry(code)) continue;
    const seen = out.get(code);
    out.set(
      code,
      seen
        ? { ...seen, spots: seen.spots + r.spots, regions: seen.regions + r.regions }
        : { ...r, country: code },
    );
  }
  return [...out.values(), ...passthrough];
}
