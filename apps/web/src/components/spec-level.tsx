/**
 * Шкала-рівень — секція каталогу CAMP-449, пункт 7 (знімок 441/16).
 * Власник позначив її 🔴 як «готовий формат під зручності кемпінгу і
 * характеристики кемпера».
 *
 * 🔴 РОЗМІРИ З ТЕМИ, читано `assets/specifications.build.css`
 * 09.11.2026:
 *
 *   .specifications__line{height:6px;margin-bottom:8px;
 *       border-radius:calc(var(--global-border-radius)*.25);
 *       background-color:var(--line_empty)}
 *   .specifications__line.is--active{background-color:var(--line_filled)}
 *   .specifications__line-dotted-wrapper{display:flex;gap:4px}
 *   .specifications__line-dotted{flex:1 0 0%}
 *   .specifications__line-label-wrapper{display:flex;
 *       justify-content:space-between}
 *
 * Радіус 4px — це наш `--r`/4 при 16px, той самий поділ, що в теми.
 *
 * 🔴 ЦЕ ШКАЛА ЗАМІРЯНОГО, А НЕ ОЦІНКИ. Тема малює нею «комфорт 4 з 5» —
 * чиюсь думку. У нас такої величини немає й не буде вигадано: шкала
 * показує лише те, що хтось порахував, наприклад «6 із 10 зручностей
 * записано». Саме тому `value` і `max` обовʼязкові обидва: підпис «6»
 * без знаменника — це число без заміру.
 *
 * 🔴 `role="meter"`, А НЕ КАРТИНКА. Смужка без ролі для читача екрана
 * не існує, і він чує лише підпис. `meter` із `aria-valuenow/min/max`
 * вимовляється як величина — те саме, що бачить око.
 */

const SPEC_CSS = `
.ct-spec{display:flex;flex-direction:column;gap:4px}
.ct-spec__labels{display:flex;justify-content:space-between;gap:12px;font-size:.75rem;line-height:1.4;color:var(--color-ink-2)}
.ct-spec__value{font-variant-numeric:tabular-nums;color:var(--color-heading);font-weight:600}
.ct-spec__track{display:flex;gap:4px}
.ct-spec__seg{height:6px;flex:1 0 0%;border-radius:calc(var(--r,16px) / 4);background-color:var(--color-line-2)}
.ct-spec__seg--on{background-color:var(--color-btn)}
`;

export default function SpecLevel({
  label,
  value,
  max,
  valueLabel,
  testId,
}: {
  label: string;
  /** Скільки з `max` заміряно. */
  value: number;
  max: number;
  /** Підпис праворуч; за замовчуванням «value of max». */
  valueLabel?: string;
  testId?: string;
}) {
  // 🔴 Порожня шкала — не шкала. `max <= 0` означає, що знаменника
  // немає, тобто й величини немає: краще нічого, ніж смужка, яку
  // неможливо прочитати.
  if (!Number.isFinite(max) || max <= 0) return null;
  const filled = Math.max(0, Math.min(max, Math.round(value)));
  return (
    <div className="ct-spec" data-testid={testId}>
      <style href="ct-spec" precedence="ct-components">
        {SPEC_CSS}
      </style>
      <div className="ct-spec__labels">
        <span>{label}</span>
        <span className="ct-spec__value">
          {valueLabel ?? `${filled} of ${max}`}
        </span>
      </div>
      <div
        className="ct-spec__track"
        role="meter"
        aria-label={label}
        aria-valuenow={filled}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        {Array.from({ length: max }, (_, i) => (
          <span
            key={i}
            className={i < filled ? 'ct-spec__seg ct-spec__seg--on' : 'ct-spec__seg'}
          />
        ))}
      </div>
    </div>
  );
}
