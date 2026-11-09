import { flagSrc, hasFlag } from "@/lib/eu-countries";

/**
 * Прапор країни — CAMP-450.
 *
 * 🔴 ОКРЕМИЙ ЕЛЕМЕНТ, А НЕ `TickerImage` І НЕ `collection-card__image`
 * ТЕМИ. Обидва в теми — квадрат із `object-fit: cover`: картинка колекції
 * обрізається до рамки. Прапор обрізати не можна — у хорватського й
 * іспанського герб стоїть не по центру, у кіпрського острів займає
 * середину, і «cover» відрізав би саме те, що відрізняє прапор від
 * триколора. Тому тут власна пропорція 4:3 (така сама, як у файлів) і
 * `object-fit: contain`. Це свідоме відхилення від теми, і воно назване.
 *
 * 🔴 КОД БЕЗ ФАЙЛУ — БЕЗ `<img>`. Для коду, якого немає в `public/flags/`
 * (новий код з API), віддається не картинка, яка на проді стала б 404, а
 * сам код літерами. Порожнє не малюємо, а чого немає — не обіцяємо.
 *
 * `alt` порожній: прапор стоїть поруч із назвою країни, і диктор, який
 * прочитав би «Flag of Croatia Croatia», чув би одне й те саме двічі.
 * `width`/`height` стоять у розмітці, щоб браузер зарезервував місце до
 * завантаження і сітка не стрибала; розмір на екрані задає CSS батька.
 */
export function Flag({
  code,
  className,
  loading = "lazy",
}: {
  code: string;
  className?: string;
  /** `eager` там, де картинка рухається (тікер): лінива не встигає. */
  loading?: "lazy" | "eager";
}) {
  const classes = ["ct-flag", className].filter(Boolean).join(" ");
  if (!hasFlag(code)) {
    return (
      <span className={`${classes} ct-flag--none`} aria-hidden="true">
        {code.trim().toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- `images.unoptimized: true` у next.config; SVG оптимізувати нічим.
    <img
      className={classes}
      src={flagSrc(code)}
      alt=""
      width={640}
      height={480}
      loading={loading}
      decoding="async"
    />
  );
}
