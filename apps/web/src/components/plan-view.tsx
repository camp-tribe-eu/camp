import type { ReactNode, Ref } from 'react';
import { VEHICLES } from '@/lib/fuel';
import {
  FIELD_ORDER,
  MAX_DAYS,
  type PlanDraft,
  type PlanErrors,
  type PlanField,
  type PlanOutcome,
  type PlanRequest,
  type PlanRun,
} from '@/lib/plan';

// CAMP-205 — те, що /plan малює: форма й панель відповіді.
//
// 🔴 Лише розмітка. Жодного стану, жодного запиту, жодного імпорту
// plan-source.ts: ці функції беруть значення і повертають HTML, тому їх
// можна прочитати на виданому HTML (tests/unit/plan-view.spec.tsx), а не
// на константі чи класі. Стан живе в plan-form.tsx, правила — в
// lib/plan.ts.
//
// 🔴 Мова верстки — наявних сторінок, а не нова. Двоколонка «форма +
// відповідь» і поля — з калькулятора вартості (CAMP-55); червона рамка
// помилки — з тієї ж ідіоми, що попередження на сторінці кемпінга
// (`border-warn/40 bg-warn/5`); жовта рамка «ще не працює» — з
// повідомлення про застарілі ціни пального. Макета (`Design/05-planner`),
// на який посилається картка, в репозиторії немає, і нічого з нього тут
// не вгадано.
//
// 🔴 Два відхилення від калькулятора, обидва заради доступності, обидва
// заміряні, а не «так гарніше»:
//
//   · підказки під полями — `text-ink-2`, а не `text-ink-3`. `ink-3`
//     (#a1a1a1) на тлі форми (#f8f8f9) дає ≈2.4:1 проти 4.5 для
//     звичайного тексту, і axe це не пропустить;
//   · поля не гасять контур фокуса (`focus:outline-hidden`) — глобальний
//     `:focus-visible` з globals.css лишається, бо одна лише зміна
//     кольору рамки — це слабка ознака фокуса для людини з клавіатури.

/** Ідентифікатори полів. Підсумок помилок веде на них, `aria-describedby` посилається на похідні. */
export const FIELD_ID: Record<PlanField, string> = {
  from: 'plan-from',
  to: 'plan-to',
  days: 'plan-days',
  vehicleId: 'plan-vehicle',
};

const PLACES_HINT_ID = 'plan-places-hint';
const DAYS_HINT_ID = 'plan-days-hint';
const VEHICLE_HINT_ID = 'plan-vehicle-hint';
const errorId = (f: PlanField) => `${FIELD_ID[f]}-error`;

const LABEL = 'block text-sm font-medium text-ink-2';
const HINT = 'mt-1 text-sm text-ink-2';
const FIELD =
  'mt-1 w-full rounded border bg-surface px-3 py-2 text-ink focus:border-line-blue';
const border = (bad: boolean) => (bad ? 'border-warn' : 'border-line-2');

/** Ідентифікатори через пробіл, без порожніх і без тих, на які немає на що посилатись. */
const describedBy = (...ids: (string | false | undefined)[]) =>
  ids.filter(Boolean).join(' ') || undefined;

function ErrorLine({ field, errors }: { field: PlanField; errors: PlanErrors }) {
  const message = errors[field];
  if (!message) return null;
  // 🔴 «Error:» словом, а не лише кольором: червоне не читається ні без
  // зору, ні без розрізнення кольорів.
  return (
    <p id={errorId(field)} className="mt-1 text-sm text-ink">
      <span className="font-semibold">Error:</span> {message}
    </p>
  );
}

export interface PlanFormViewProps {
  draft: PlanDraft;
  errors: PlanErrors;
  /**
   * `false`, поки сторінку не оживив React.
   *
   * 🔴 Без цього форма в виданому HTML виглядала б робочою, а без
   * JavaScript нічого не робила б, — і все, що людина встигла ввести до
   * гідратації, мовчки зникало б. Калькулятор вирішує це так само.
   */
  ready: boolean;
  /** Куди React кладе посилання на підсумок помилок, щоб перенести на нього фокус. */
  summaryRef?: Ref<HTMLDivElement>;
  onEdit: (field: PlanField, value: string) => void;
  onSubmit: () => void;
  /** Клік по помилці в підсумку: фокус на полі, яке треба виправити. */
  onJump: (field: PlanField) => void;
}

export function PlanFormView({
  draft,
  errors,
  ready,
  summaryRef,
  onEdit,
  onSubmit,
  onJump,
}: PlanFormViewProps) {
  const failing = FIELD_ORDER.filter((f) => errors[f]);
  const chosen = VEHICLES.find((v) => v.id === draft.vehicleId);

  return (
    <form
      // 🔴 `noValidate`: власні повідомлення, з підсумком і фокусом, а не
      // браузерна бульбашка, яка зникає за секунди й озвучується як
      // завгодно. `required` лишається на полях — він каже екранному
      // читачеві, що поле обовʼязкове.
      noValidate
      aria-labelledby="plan-form-heading"
      className="rounded-card border border-line-2 bg-surface-2 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <h2 id="plan-form-heading" className="text-lg font-semibold text-heading">
        Your trip
      </h2>

      {!ready && (
        <p data-testid="plan-loading" className="mt-2 text-sm text-ink-2">
          The form comes alive when the page finishes loading. The note above
          needs nothing.
        </p>
      )}

      {failing.length > 0 && (
        <div
          ref={summaryRef}
          role="alert"
          tabIndex={-1}
          data-testid="plan-errors"
          className="mt-4 rounded border border-warn/40 bg-warn/5 p-4 text-sm text-ink"
        >
          <h3 className="font-semibold text-heading">There is a problem</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {failing.map((f) => (
              <li key={f}>
                <a
                  href={`#${FIELD_ID[f]}`}
                  className="underline"
                  onClick={(e) => {
                    e.preventDefault();
                    onJump(f);
                  }}
                >
                  {errors[f]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={FIELD_ID.from}>
            Starting point
          </label>
          <input
            id={FIELD_ID.from}
            name="from"
            type="text"
            autoComplete="off"
            required
            disabled={!ready}
            value={draft.from}
            onChange={(e) => onEdit('from', e.target.value)}
            aria-invalid={errors.from ? true : undefined}
            aria-describedby={describedBy(PLACES_HINT_ID, errors.from && errorId('from'))}
            className={`${FIELD} ${border(!!errors.from)}`}
          />
          <ErrorLine field="from" errors={errors} />
        </div>

        <div>
          <label className={LABEL} htmlFor={FIELD_ID.to}>
            Destination
          </label>
          <input
            id={FIELD_ID.to}
            name="to"
            type="text"
            autoComplete="off"
            required
            disabled={!ready}
            value={draft.to}
            onChange={(e) => onEdit('to', e.target.value)}
            aria-invalid={errors.to ? true : undefined}
            aria-describedby={describedBy(PLACES_HINT_ID, errors.to && errorId('to'))}
            className={`${FIELD} ${border(!!errors.to)}`}
          />
          <ErrorLine field="to" errors={errors} />
        </div>

        {/* 🔴 Одна підказка на обидва поля, і вона каже правду про те, чого
            форма не робить: назви ніде не шукаються. Підказка, яка
            натякала б на пошук, обіцяла б те, чого немає. */}
        <p id={PLACES_HINT_ID} className={`${HINT} sm:col-span-2`}>
          Place names, typed as you know them. Nothing looks them up yet, so a
          misspelling is not caught.
        </p>

        <div>
          <label className={LABEL} htmlFor={FIELD_ID.days}>
            Number of days
          </label>
          <input
            id={FIELD_ID.days}
            name="days"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            disabled={!ready}
            value={draft.days}
            onChange={(e) => onEdit('days', e.target.value)}
            aria-invalid={errors.days ? true : undefined}
            aria-describedby={describedBy(DAYS_HINT_ID, errors.days && errorId('days'))}
            className={`${FIELD} ${border(!!errors.days)}`}
          />
          <p id={DAYS_HINT_ID} className={HINT}>
            Whole days, 1 to {MAX_DAYS}.
          </p>
          <ErrorLine field="days" errors={errors} />
        </div>

        <div>
          <label className={LABEL} htmlFor={FIELD_ID.vehicleId}>
            Vehicle
          </label>
          <select
            id={FIELD_ID.vehicleId}
            name="vehicle"
            required
            disabled={!ready}
            value={draft.vehicleId}
            onChange={(e) => onEdit('vehicleId', e.target.value)}
            aria-invalid={errors.vehicleId ? true : undefined}
            aria-describedby={describedBy(
              chosen && VEHICLE_HINT_ID,
              errors.vehicleId && errorId('vehicleId'),
            )}
            className={`${FIELD} ${border(!!errors.vehicleId)}`}
          >
            <option value="">Choose your vehicle</option>
            {VEHICLES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
          {chosen && (
            <p id={VEHICLE_HINT_ID} className={HINT}>
              {chosen.note}
            </p>
          )}
          <ErrorLine field="vehicleId" errors={errors} />
        </div>
      </div>

      <button
        type="submit"
        disabled={!ready}
        className="mt-5 inline-flex h-11 items-center rounded-sm border border-line-blue bg-accent-surface px-4 text-sm font-semibold text-heading hover:border-line-2 disabled:opacity-60"
      >
        Check my trip
      </button>
    </form>
  );
}

// ── Панель відповіді ──────────────────────────────────────────────────

// 🔴 `wrap-anywhere` (overflow-wrap: anywhere), а не `break-words`: лише
// `anywhere` зменшує МІНІМАЛЬНУ ширину блока, а `break-word` її лишає.
// Елемент сітки не стискається менше за мінімальну ширину свого вмісту,
// тож 120 літер «W» без пробілу розтягнули сторінку до 1890px на екрані
// в 375px — заміряно e2e-тестом першої ж версії. Мутація ізолювала
// причину: без `wrap-anywhere` — 1869px; `min-w-0` на панелі, додане
// «про всяк випадок», без нього нічого не міняло, тому його тут немає.
const VALUE = 'wrap-anywhere font-semibold text-heading';

function Echo({ request }: { request: PlanRequest }) {
  const vehicleLabel = VEHICLES.find((v) => v.id === request.vehicleId)?.label ?? request.vehicleId;
  const rows: [string, ReactNode][] = [
    ['From', request.from],
    ['To', request.to],
    ['Days', request.days],
    ['Vehicle', vehicleLabel],
  ];
  return (
    <>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        What you asked for
      </h3>
      {/* 🔴 Стовпчиком, а не рядками «ліворуч — праворуч»: назва місця може
          бути до 120 символів без пробілу, і в рядку вона розсунула б
          панель завширшки 360px. */}
      <dl className="mt-2 space-y-2">
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt className="text-sm text-ink-2">{name}</dt>
            <dd className={VALUE}>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/**
 * Що сказало джерело.
 *
 * 🔴 Вичерпний `switch`: гілка `default` присвоює `never`. Коли CAMP-46
 * додасть у `PlanOutcome` варіант із маршрутом, ця функція перестане
 * компілюватись — і зупинить збірку саме тут, у єдиному місці, де цей
 * варіант треба намалювати.
 */
function OutcomeBody({ request, outcome }: { request: PlanRequest; outcome: PlanOutcome }) {
  switch (outcome.status) {
    case 'unavailable':
      return (
        <>
          <p className="text-ink">
            <strong>No route to show.</strong> The planner does not calculate
            routes yet, so nothing was worked out for this trip.
          </p>
          <Echo request={request} />
          {/* 🔴 Твердження про те, що з даними сталося. Воно істинне, бо
              plan-source.ts не робить запитів, а e2e-тест дивиться в мережу
              й у сховища браузера. Коли джерело стане справжнім, цей рядок
              зникає разом із варіантом `unavailable`. */}
          <p className="mt-4 text-sm text-ink-2">
            Your details were valid. They were not saved, and they were not
            sent anywhere.
          </p>
        </>
      );
    case 'failed':
      return (
        <p className="text-ink">
          <strong>The planner did not answer.</strong> Nothing was lost: your
          details are still in the form. Press <strong>Check my trip</strong>{' '}
          to try again.
        </p>
      );
    default: {
      const unhandled: never = outcome;
      return unhandled;
    }
  }
}

function RunBody({ run }: { run: PlanRun }) {
  switch (run.phase) {
    case 'idle':
      return (
        <p>
          Nothing asked yet. Fill in the form and press{' '}
          <strong className="text-ink">Check my trip</strong>; the answer
          appears here.
        </p>
      );
    case 'pending':
      return <p>Asking the planner…</p>;
    case 'done':
      return <OutcomeBody request={run.request} outcome={run.outcome} />;
  }
}

export function PlanOutcomePanel({ run }: { run: PlanRun }) {
  return (
    <aside
      aria-labelledby="plan-result-heading"
      className="rounded-card border border-line-2 bg-surface p-5"
    >
      <h2 id="plan-result-heading" className="text-lg font-semibold text-heading">
        Your route
      </h2>
      {/* 🔴 Ділянка оголошень існує завжди, ще до першої відповіді:
          екранний читач озвучує зміну вмісту лише тієї `aria-live`-області,
          яку бачив у документі раніше. Створена разом із відповіддю, вона
          змовчала б. */}
      <div aria-live="polite" data-testid="plan-result" className="mt-4 text-ink-2">
        <RunBody run={run} />
      </div>
    </aside>
  );
}
