import Link from "next/link";

import { Block } from "@/components/layout";
import type { SectionView } from "@/lib/page-content";

/**
 * CAMP-501 — блок оренди на сторінці маршруту, для того, у кого кемпера ще
 * нема.
 *
 * 🔴 ВІН Є В HTML ЗАВЖДИ, А ХОВАЄ ЙОГО CSS (`data-persona-only="renter"` у
 * globals.css) для того, хто обрав «маю кемпер». Сторінка статична, одна
 * на всіх; різниця — в атрибуті на `<html>`. Нічого про нього не кажеться
 * без вибору: тоді його бачать усі, бо оренда — відповідь і для того, хто
 * ще не сказав, хто він.
 *
 * 🔴 ТУТ НЕМАЄ ЖОДНОГО ГАБАРИТУ. Приблизні розміри «типового прокатного
 * кемпера» ми не міряли ні в кого, а таблиця невиміряних цифр — саме та
 * вигадка, від якої відмовилась `data/rental/thresholds.ts`. Блок веде на
 * сторінки оренди тих країн, якими йде маршрут: там — чотири числа, які
 * читач знайде в договорі, а не наші.
 *
 * 🔴 ПОРОЖНЄ НЕ МАЛЮЄМО: нема тексту в CMS або жодної сторінки оренди для
 * країн маршруту — блока немає зовсім.
 */
export default function RouteRental({
  section,
  countries,
}: {
  section: SectionView | null;
  countries: Array<{ code: string; name: string }>;
}) {
  if (!section?.heading || countries.length === 0) return null;
  return (
    <section
      data-testid="route-rental"
      data-persona-only="renter"
      aria-labelledby="route-rental-heading"
      className="mx-auto mt-10 max-w-read rounded-card border border-line-2 bg-surface p-5"
    >
      <h2 id="route-rental-heading" className="text-xl md:text-[25px]">
        {section.heading}
      </h2>
      {section.body && (
        <Block as="p" measure="read" className="mt-2 leading-7 text-ink-2">
          {section.body}
        </Block>
      )}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {countries.map((c) => (
          <li key={c.code}>
            <Link href={`/camper-rental/${c.code}`} className="underline">
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
