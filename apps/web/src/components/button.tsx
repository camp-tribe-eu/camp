import Link from 'next/link';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Кнопка — одна на весь застосунок (CAMP-345).
 *
 * 🔴 СКІНИ ЗАМІРЯНІ, НЕ ВИГАДАНІ. 19.10.2026 я перебрав усі `.tsx` у
 * `apps/web/src` і витяг кожен елемент із `inline-flex` і заданою
 * висотою: 27 означень у 21 файлі. Чотири скіни нижче — це вони,
 * згруповані.
 *
 * 🔴 І ОДРАЗУ ПРО ВЛАСНУ ПОМИЛКУ: спершу я нарахував «22 кнопки, три
 * скіни» — регекс вимагав `px-` у тому ж рядку й не бачив тих, що
 * склеюються з кількох рядків (`map-filters`, `account-*-view`).
 * Правильні числа — 27 і чотири, плюс пʼятий, одноразовий, про який
 * нижче.
 *
 * 🔴 ВИСОТА 48 px — ЧИСЛО ТЕМИ, А НЕ МОЄ. У розпакованому архіві Fuse
 * серед правил із `button`/`btn` у селекторі `height: 48px` трапляється
 * 27 разів, частіше за будь-яку іншу висоту (наступна, 56px, — 7). Воно
 * ж збігається з мінімальною зоною натискання з картки, тож одне число
 * закриває і вигляд, і дотик.
 *
 * 🔴 А ОСЬ ЩО КОД ВВАЖАВ ЦІЛЛЮ ДЛЯ ПАЛЬЦЯ ДО ЦЬОГО — ТРИ РІЗНІ
 * ВІДПОВІДІ, ДВІ З НИХ ЗАПИСАНІ ЯК РІШЕННЯ:
 *
 *   `map-filters.tsx`         «36 px — найменше, що надійно не
 *                              промахується»
 *   `account-cabinet-view.tsx` «Висота 44 px: це ціль для пальця на
 *                              375 px»
 *   решта 19 файлів            числа від 32 до 44 без жодного
 *                              обґрунтування
 *
 * Жодне з них не дотягує до 48. Обидва коментарі виправлені там, де
 * вони написані, бо число в коментарі стає специфікацією для
 * наступного, хто його прочитає.
 */

/**
 * Шість скінів, і В КОЖНОГО Є ВИДИМЕ НАВЕДЕННЯ — заміряно в браузері
 * 19.10.2026, обчисленим стилем під курсором, а не прочитанням коду:
 *
 *   primary      тло  #404B62 → #2F384A
 *   secondary    рамка #D4D4D4 → --line-blue
 *   accent       рамка --line-blue → --heading
 *   chip         рамка --line-blue, і текст --ink-2 → --heading
 *   danger       тло  #C83D28 → #A8321F
 *   danger-soft  тло  #FFFFFF → #F8F8F9
 *
 * 🔴 Трьом із них наведення довелось ДОДАТИ: `accent`, `danger` і
 * `danger-soft` його не мали зовсім. Тобто кнопка «видалити акаунт» —
 * єдина незворотна дія на сайті — під курсором не змінювалась ніяк.
 *
 * 🔴 І окремо про саму тему: її «пʼять варіантів, у кожного стан
 * hover» — лише наполовину правда. У `config/settings_schema.json`
 * значення `button_background_color_primary` і `..._primary_hover`
 * однакові (#F8F8F9), і так само в `thirdly`. Тобто два з пʼяти її
 * варіантів оголошують наведення, якого не видно. Ми повторили її
 * НАПРЯМОК (світла тема темнішає, темна світлішає), а не цю ваду.
 *
 * Шість скінів.
 *
 * 🔴 І ЦЕ ВЖЕ ВДРУГЕ ВИПРАВЛЕНЕ ЧИСЛО. Спершу я написав «три», потім
 * «чотири», і щоразу тому, що зупинявся на першому, що вкладалось у
 * задум. Руйнівні дії знайшлись аж тоді, коли я дочитав до констант у
 * `account-delete-view` і `account-data-view`. Шість — це те, що в коді,
 * а не те, скільки мені хотілося б підтримувати.
 *
 * `secondary` — біла з рамкою, `btn-s` макета. Найчастіша.
 * `primary`   — залита темна, `btn-p` макета. Головна дія сторінки.
 * `accent`    — блакитна рамка + `accent-surface`. Це НЕ третя кнопка,
 *               а стан «вибрано» у перемикачах і наголос у формах.
 * `danger`    — залита `warn`. Рівно одна в проєкті: «видалити акаунт».
 * `danger-soft` — контурна `warn`. Теж одна: «видалити мої дані».
 * `chip`      — та сама рамка, що в `secondary`, але притемнений текст
 *               (`text-ink-2`). Це невибраний бік перемикача; він
 *               ЗАВЖДИ ходить у парі з `accent` і наодинці не
 *               трапляється.
 *
 * 🔴 `chip` існує саме тому, що `secondary` йому не підходить: різниця
 * в кольорі тексту, і переписати її через `className` не можна. Tailwind
 * вирішує конфлікт `text-heading` проти `text-ink-2` порядком у
 * зібраному CSS, а не порядком у рядку класів — тобто «перекриття»
 * спрацювало б або ні залежно від того, яку утиліту збірка поставила
 * пізніше. Це не те, на що можна спиратись.
 */
type Variant =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'chip'
  | 'danger'
  | 'danger-soft';

/**
 * Два розміри.
 *
 * `md` (48 px) — заклики до дії, кнопки форм, усе, що стояло на 40–44.
 * `sm` (36 px) — щільні місця: шари мапи, фільтри, пагінація. Вигляд
 *                лишається дрібним, а зона натискання розсувається до
 *                48×48 псевдоелементом `.touch-target` (globals.css).
 *
 * 🔴 Підняти ВСІ до 48 було б простіше й неправильно: ряд фільтрів мапи
 * і перемикач шарів розлізлись би на зайвий рядок на 375 px, а рішення
 * «кнопка має бути 48» стосується того, у що влучає палець, а не того,
 * що бачить око.
 */
type Size = 'sm' | 'md';

/** Спільне: форма, вирівнювання, рух, видимий фокус, вимкнений стан. */
/**
 * Спільне: форма, вирівнювання, рух, видимий фокус.
 *
 * 🔴 `disabled:opacity-60` ТУТ НЕМАЄ, і це навмисно. Кнопка видалення
 * акаунта у вимкненому стані має власний вигляд — сіра рамка, `surface-2`,
 * `ink-3` — тобто не бліда копія себе, а інший елемент. Загальна
 * прозорість наклалась би поверх і притемнила те, що вже свідомо
 * знебарвлене. Тому прозорість живе у тих скінах, яким вона потрібна.
 *
 * 🔴 `aria-disabled`, а не лише `disabled`: перемикач супутника на мапі
 * лишається у фокусі навмисно — без цього той, хто ходить клавіатурою,
 * не дізнається, що контрол існує, і не почує пояснення, чому він
 * вимкнений. Такий елемент НЕ має `disabled`, тож варіанти `disabled:*`
 * його не бачать, і без рядка нижче він виглядав би звичайним.
 */
const BASE =
  'relative inline-flex items-center justify-center gap-2 rounded-sm border ' +
  'text-sm transition-colors disabled:pointer-events-none ' +
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line-blue';

const VARIANT: Record<Variant, string> = {
  primary:
    'border-transparent bg-btn font-semibold text-btn-ink hover:bg-btn-hover disabled:opacity-60',
  secondary:
    'border-line-2 bg-surface text-heading hover:border-line-blue disabled:opacity-60',
  accent:
    'border-line-blue bg-accent-surface font-semibold text-heading hover:border-heading disabled:opacity-60',
  chip: 'border-line-2 bg-surface text-ink-2 hover:border-line-blue hover:text-heading disabled:opacity-60',
  danger: 'border-transparent bg-warn font-semibold text-white hover:bg-warn-hover',
  'danger-soft': 'border-warn bg-surface text-warn hover:bg-surface-2',
};

const SIZE: Record<Size, string> = {
  sm: 'h-9 px-3 touch-target',
  md: 'h-12 px-5',
};

/**
 * Класи кнопки без самої кнопки.
 *
 * 🔴 Для тих небагатьох місць, де елемент мусить лишитись сирим `<a>`:
 * `mailto:` на /contact — це не маршрут, і проганяти його через
 * `next/link` означало б віддати посилання на пошту роутеру, який про
 * нього нічого не знає. Експорт тут кращий за ще одну руками намальовану
 * кнопку: джерело істини лишається одне.
 */
export const buttonClasses = (
  variant: Variant = 'secondary',
  size: Size = 'md',
  extra?: string,
) => [BASE, VARIANT[variant], SIZE[size], extra].filter(Boolean).join(' ');

const classesFor = buttonClasses;

type Common = {
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={classesFor(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

/**
 * Та сама кнопка, але посилання.
 *
 * 🔴 Окремий компонент, а не проп `as`: 11 із 27 замірених «кнопок» —
 * це `<Link>`, і вони мусять лишитись посиланнями. Кнопка, що веде на
 * іншу сторінку, має відкриватись у новій вкладці середнім кліком,
 * копіюватись правою і показувати адресу в рядку стану —
 * `<button onClick={router.push}>` не вміє нічого з цього, і підміна
 * коштувала б рівно тієї поведінки, якої ніхто не помічає, доки вона є.
 */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  children,
  href,
  ...rest
}: Common & { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return (
    <Link href={href} className={classesFor(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
