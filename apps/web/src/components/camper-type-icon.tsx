/**
 * Іконки типів кемпера — CAMP-444 (рішення власника 20.11.2026).
 *
 * 🔴 ІКОНКА, А НЕ ФОТО. Фото машин належать компаніям і власникам авто;
 * без договору ми їх не показуємо. Щоб картки й вибір типу не були
 * порожніми, тип показується власним малюнком-силуетом: це наш малюнок
 * узагальненого типу, а не зображення чиєїсь машини.
 *
 * Пʼять силуетів — рівно пʼять типів у `camper_types` (заміряно на проді
 * 20.11.2026: van, lowprofile, coachbuilt, aclass, caravan). Тип, якого
 * тут немає, отримує нейтральний силует, а не порожнечу й не чужий тип.
 *
 * Лінія 1.5, `currentColor`, без заливки — та сама мова, що в іконок
 * `ct-feat__icon` (картки «Where to go next»). Профіль — кабіною ліворуч.
 * `aria-hidden`: назва типу завжди стоїть поруч текстом.
 */

const PATHS: Record<string, string[]> = {
  // Кемпер-фургон: один обʼєм, похилий капот, бічні двері.
  van: [
    'M4 17V10.5c0-.8.4-1.6 1-2.1L8.5 6H40a2 2 0 0 1 2 2v9',
    'M4 17h3m6 0h18m6 0h5',
    'M9 7 6.5 11H13V7',
    'M24 8v8',
    'M28 9h8v4h-8z',
  ],
  // Низький профіль: кабіна фургона + житловий короб трохи вищий за неї.
  lowprofile: [
    'M4 17v-5.5c0-.6.3-1.2.8-1.6L9 7h5',
    'M14 5h26a2 2 0 0 1 2 2v10',
    'M14 5v12',
    'M4 17h3m6 0h18m6 0h5',
    'M8 8.5 6 11h5V8.5',
    'M20 8h8v4h-8z',
  ],
  // Альков: житловий короб нависає над кабіною.
  coachbuilt: [
    'M4 17v-5c0-.6.3-1.2.8-1.6L8 8h6',
    'M9 8V5.5A1.5 1.5 0 0 1 10.5 4H40a2 2 0 0 1 2 2v11',
    'M14 8v9',
    'M4 17h3m6 0h18m6 0h5',
    'M7.5 10 6 12h4v-2',
    'M20 8h8v4h-8z',
  ],
  // Інтегрований (A-class): один високий корпус, широке лобове скло.
  aclass: [
    'M4 17V8c0-1.7 1.3-3 3-3h33a2 2 0 0 1 2 2v10',
    'M4 17h3m6 0h18m6 0h5',
    'M4.5 8.5 8 6h3v6H4.5',
    'M18 8h8v4h-8z',
    'M30 8h6v4h-6z',
  ],
  // Причіп-дача: заокруглений короб, одна вісь, дишло без кабіни.
  caravan: [
    'M12 16V8.5C12 6.6 13.6 5 15.5 5H39a3 3 0 0 1 3 3v8',
    'M12 16h17m6 0h7',
    'M12 14H4',
    'M18 8h8v4h-8z',
  ],
};

const WHEELS: Record<string, number[]> = {
  van: [10, 34],
  lowprofile: [10, 34],
  coachbuilt: [10, 34],
  aclass: [10, 34],
  caravan: [32],
};

export function CamperTypeIcon({
  slug,
  className = 'h-6 w-12',
}: {
  slug: string;
  className?: string;
}) {
  const paths = PATHS[slug] ?? PATHS.van;
  const wheels = WHEELS[slug] ?? WHEELS.van;
  return (
    <svg
      viewBox="0 0 48 22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      data-camper-icon={PATHS[slug] ? slug : 'generic'}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {wheels.map((cx) => (
        <circle key={cx} cx={cx} cy={17.5} r={2.6} />
      ))}
    </svg>
  );
}

/** Тип має власний силует (а не нейтральний запасний). */
export const hasCamperIcon = (slug: string) => slug in PATHS;
