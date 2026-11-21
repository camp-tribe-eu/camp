import coats from "@/data/coats.json";

import { Flag } from "./flag";

/**
 * Знак регіону біля його назви на картці — CAMP-441.
 *
 * 🔴 ГЕРБ, ЯКЩО Є ЧИСТИЙ ФАЙЛ, ІНАКШЕ ПРАПОР КРАЇНИ. НІКОЛИ НЕ МАЛЮЄМО.
 * Рішення власника 20.11.2026: лише вільно ліцензовані файли
 * (Public domain / CC0 без жодного значення `Restrictions` на Commons), а де
 * герба немає — прапор країни. Намальований чи згенерований герб реального
 * регіону — неправдивий офіційний символ.
 *
 * 🔴 ЧИСТОТУ ВИРІШУЄ СКРИПТ, не цей файл: `scripts/images/fetch-coats.mjs`
 * кладе файл у `public/coats/` і запис у `data/coats.json` лише для чистих,
 * а `scripts/images/check-coats.mjs` у CI перевіряє, що файли й записи
 * збігаються й що жодна ліцензія не інша. Тут тільки читання.
 *
 * `alt` порожній — назва регіону стоїть поруч (так само, як у `Flag`).
 * Розмір — `1.5em`, як прапор у `country-chip.tsx`.
 */

interface CoatEntry {
  file: string;
  license: string;
  source: string;
  author: string | null;
  checkedOn: string;
}

const MANIFEST = coats as Record<string, CoatEntry | undefined>;

/** Запис манифесту для коду ISO 3166-2, або `null`: герба немає. */
export function coatFor(iso: string | null | undefined): CoatEntry | null {
  if (typeof iso !== "string") return null;
  // Власні ключі лише: `constructor` чи `__proto__` не є кодом.
  if (!Object.prototype.hasOwnProperty.call(MANIFEST, iso)) return null;
  const e = MANIFEST[iso];
  return e && e.file.startsWith("/coats/") ? e : null;
}

export const REGION_EMBLEM_CSS = `
.ct-emblem{display:inline-flex;align-items:center;flex:none;height:1.5em}
.ct-emblem .ct-flag{width:1.5em;height:auto;border-radius:.12em}
.ct-emblem .ct-coat{height:1.5em;width:auto;max-width:2em;object-fit:contain}
`;

export function RegionEmblem({
  iso,
  country,
}: {
  /** ISO 3166-2 регіону, як його віддає API; `null` — невідомий. */
  iso?: string | null;
  /** Код країни для прапора-запасу. */
  country: string;
}) {
  const coat = coatFor(iso);
  return (
    <span className="ct-emblem" data-emblem={coat ? "coat" : "flag"}>
      {coat ? (
        // eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config; SVG оптимізувати нічим.
        <img
          className="ct-coat"
          src={coat.file}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <Flag code={country} />
      )}
    </span>
  );
}
