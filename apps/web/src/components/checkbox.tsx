import type { ReactNode } from 'react';

/**
 * Чекбокс сайту — CAMP-459.
 *
 * 🔴 ЧОМУ ВІН ІСНУЄ. Власник на знімках 443/11–443/20: «Тут взагалі не
 * зрозуміло що це чекбокси поки я не натиснув!» На `/routes` фільтри
 * були пігулками з `aria-pressed` — бордер однакової товщини до й після
 * вибору, різниця лише в кольорі тла. Нічого не каже читачеві, що це
 * можна перемкнути. І власник додав: «Правило наскрізне, не лише тут».
 *
 * 🔴 ВИГЛЯД ВЗЯТО З ТЕМИ, А НЕ ВИГАДАНО. `assets/main.build.css` архіву
 * Fuse (читано 09.11.2026) — `.checkbox-label`:
 *
 *   .checkbox-label{display:flex;gap:12px;font-weight:600;align-items:center}
 *   .checkbox-label__box{display:inline-flex;justify-content:center;
 *       align-items:center;width:24px;height:24px;flex-shrink:0;
 *       border:1px solid var(--color-border-primary);
 *       border-radius:calc(var(--global-border-radius)/2);
 *       background-color:var(--color-background)}
 *   .checkbox-label__box .icon{opacity:0}
 *   .checkbox:checked + .checkbox-label .checkbox-label__box{
 *       border-color:var(--color-accent);background-color:var(--color-accent)}
 *   .checkbox:checked + .checkbox-label .checkbox-label__box .icon{opacity:1}
 *
 * Тобто КВАДРАТ ВИДНО ЗАВЖДИ, а галочка в ньому зʼявляється лише при
 * виборі — рівно те, чого бракувало. Радіус 8px — це `var(--r)/2` при
 * наших 16px, той самий поділ, що й у теми.
 *
 * 🔴 ОДНЕ ВІДХИЛЕННЯ ВІД ТЕМИ, І ВОНО ЗАМІРЯНЕ. Тема малює рамку
 * `--color-border-primary`; наш аналог `--color-line` (#cacaca світла,
 * #39435a темна) дає проти тла 1.64 / 1.46 / 1.54 і 1.49 / 1.71 / 1.30.
 * WCAG 1.4.11 вимагає від елемента КЕРУВАННЯ 3:1, і жодне з цих чисел
 * туди не дістає — тобто «квадрат видно завжди» був би обіцянкою, якої
 * рамка не виконує. Тому окремий токен `--control-line`, підібраний по
 * найгіршому тлу своєї теми:
 *
 *   світла #828282: 3.84 / 3.42 / 3.62   (--surface / --bg / --surface-2)
 *   темна  #7b879c: 4.07 / 4.66 / 3.54
 *
 * 🔴 ФОКУС — НАШ, А НЕ ТЕМИ. Тема пише `outline: 2px solid black`, що в
 * темній темі невидиме. Беремо `--color-heading`, як решта
 * `:focus-visible` у globals.css.
 *
 * 🔴 НАТИВНИЙ `<input type="checkbox">`, схований `sr-only`, а не
 * `role="checkbox"` на `<div>`. Клавіатура, читач екрана, форма без JS і
 * `:checked` у CSS — усе це дає браузер; переписування цього вручну
 * лише множить способи помилитись.
 */

/** Не експортується: тест має читати віддану розмітку, а не цю константу. */
const CHECKBOX_CSS = `
.ct-cb{display:inline-flex;gap:12px;align-items:center;font-weight:600;cursor:pointer}
.ct-cb--start{align-items:flex-start}
.ct-cb--plain{font-weight:400}
.ct-cb__box{position:relative;display:inline-flex;justify-content:center;align-items:center;width:24px;height:24px;flex-shrink:0;border:1px solid var(--color-control-line);border-radius:calc(var(--r,16px) / 2);background-color:var(--color-surface);transition:background-color .15s,border-color .15s}
.ct-cb__box svg{opacity:0;transition:opacity .15s}
.ct-cb__input:checked + .ct-cb__box{border-color:var(--color-btn);background-color:var(--color-btn)}
.ct-cb__input:checked + .ct-cb__box svg{opacity:1;color:var(--color-btn-ink)}
.ct-cb__input:focus-visible + .ct-cb__box{outline:2px solid var(--color-heading);outline-offset:2px}
.ct-cb__input:disabled + .ct-cb__box{background-color:var(--color-surface-2)}
.ct-cb:has(.ct-cb__input:disabled){opacity:.4;cursor:default}
@media(hover:hover),(pointer:fine){.ct-cb:hover .ct-cb__input:not(:checked):not(:disabled) + .ct-cb__box{border-color:var(--color-heading)}}
`;

export default function Checkbox({
  checked,
  onChange,
  children,
  disabled = false,
  testId,
  name,
  align = 'center',
  weight = 'bold',
  data,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  testId?: string;
  name?: string;
  /**
   * 🔴 `start` — для багаторядкового напису. Тема центрує квадрат, бо її
   * написи однорядкові; на абзаці згоди центрований квадрат їде на
   * середину тексту й перестає читатись як «початок рядка».
   */
  align?: 'center' | 'start';
  /** `plain` — там, де напис є реченням, а не підписом до фільтра. */
  weight?: 'bold' | 'plain';
  /**
   * 🔴 Атрибути згоди (`data-wording`, `data-wording-version`) їдуть
   * НАСКРІЗЬ, а не переписуються тут. Вони привʼязують галочку до
   * ВЕРСІЇ формулювання — це доказ згоди за GDPR, і загубити його,
   * міняючи вигляд контрола, було б дорожче за будь-який вигляд.
   */
  data?: Record<`data-${string}`, string>;
}) {
  const cls = [
    'ct-cb',
    align === 'start' ? 'ct-cb--start' : '',
    weight === 'plain' ? 'ct-cb--plain' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    // 🔴 `data-testid` НА МІТЦІ, а не на інпуті: інпут схований
    // (`sr-only`), і Playwright відмовляється клікати невидиме. Тест,
    // який шукає контрол, має знаходити те, що справді клікають.
    <label className={cls} data-testid={testId}>
      <style href="ct-cb" precedence="ct-components">
        {CHECKBOX_CSS}
      </style>
      <input
        type="checkbox"
        className="ct-cb__input sr-only"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        {...data}
      />
      {/* 🔴 `aria-hidden`: квадрат — це картинка стану, який уже
          оголошує сам `<input>`. Без цього читач екрана вимовляє його
          двічі. */}
      <span className="ct-cb__box" aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2 7.5 L5.5 11 L12 3.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span>{children}</span>
    </label>
  );
}
