import Link from 'next/link';
import type { ReactNode, Ref } from 'react';
import { AMENITY_LABEL, countryName } from '@/lib/api';
import {
  EXAMPLE,
  FIELD_ORDER,
  MAX_DAYS,
  type PlanDraft,
  type PlanErrors,
  type PlanField,
  type PlanOutcome,
  type PlannedDay,
  type PlannedNight,
  type PlannedSource,
  type PlannedTrip,
  type PlanRequest,
  type PlanRun,
} from '@/lib/plan';
import { SOURCES, formatUpdated } from '@/lib/sources';
import { Button } from '@/components/button';

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
};

const PLACES_HINT_ID = 'plan-places-hint';
const DAYS_HINT_ID = 'plan-days-hint';
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
            Starting point (latitude, longitude)
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
            Destination (latitude, longitude)
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
            натякала б на пошук, обіцяла б те, чого немає. Приклад —
            справжні координати Любляни, а не «XX.XXXX». */}
        <p id={PLACES_HINT_ID} className={`${HINT} sm:col-span-2`}>
          Latitude first, then longitude, in degrees: Ljubljana is{' '}
          {EXAMPLE.from}. Copy the numbers from a map. Place names are not
          looked up yet, so a name will not work.
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
      </div>

      <Button
        type="submit"
        disabled={!ready} variant="accent" className="mt-5">
        Check my trip
      </Button>
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
//
// CAMP-391: назва ТЕПЕР приходить з бази (OSM: довільний текст до сотень
// символів), а не з поля, яке людина ввела сама, тож те саме правило
// стосується назви кемпінгу, і тест на неї є.
const VALUE = 'wrap-anywhere font-semibold text-heading';

/** Ті самі слова, що на сторінках маршрутів (`STRAIGHT_LINE_LABEL` у lib/routes.ts); тест звіряє. */
export const STRAIGHT_LINE = 'in a straight line';

/**
 * Відстань словами, які можна показати: до кілометра — метри, до десяти —
 * кілометр із десятою, далі — цілі кілометри.
 *
 * 🔴 НЕ `formatKm` з маршрутів: той округлює до кілометра, і «8 км» від точки,
 * де мав закінчитись день, тут часто 90 м — «0 km» було б неправдою про
 * найважливіше число пояснення.
 */
export function distance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString('en-GB')} km`;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

function Echo({ request }: { request: PlanRequest }) {
  const rows: [string, ReactNode][] = [
    ['From', `${request.from.lat}, ${request.from.lon}`],
    ['To', `${request.to.lat}, ${request.to.lon}`],
    ['Days', request.days],
  ];
  return (
    <>
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
        What you asked for
      </h3>
      {/* 🔴 Стовпчиком, а не рядками «ліворуч — праворуч»: панель завширшки
          360px, а координати з багатьма знаками не стискаються. */}
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

// ── План ──────────────────────────────────────────────────────────────

/**
 * Чим ранжується, і його назва для людини.
 *
 * 🔴 Слова тут, а ВАГИ — з відповіді (`plan.ranking`): число, надруковане в
 * цьому файлі, було б копією, що старіє, а сервер уже знає справжнє. Цей
 * перелік — з того, що scoring.ts каже, чим ранжує: близькість до місця,
 * де день мав закінчитись, і невеликий підйом за записану електрику, записане
 * зливання сірої води й офіційну класифікацію зірками. Доданок, якого тут
 * немає, друкується під власним ідентифікатором, а не зникає: пояснення, що
 * мовчить про щось із зваженого, — не пояснення.
 */
const RANKING_LABEL: Record<string, string> = {
  distance_fit: 'How close it is to where the day should end',
  electricity: 'A recorded electric hook-up',
  greyWater: 'A recorded grey-water disposal point',
  stars: 'An official star classification',
};

function Sources({ sources }: { sources: PlannedSource[] }) {
  if (sources.length === 0) {
    return <p className="mt-1 text-xs text-ink-2">No source is recorded for this campsite.</p>;
  }
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
      {sources.map((s, i) => {
        const info = SOURCES[s.id];
        const when = formatUpdated(s.updatedAt);
        return (
          <li key={`${s.id}-${i}`}>
            {/* 🔴 Невпізнаний id друкується, а не відкидається: відкинути
                його означало б тихо зняти атрибуцію (так само в SourceNote). */}
            <strong className="font-semibold">{info?.name ?? s.id}</strong>
            {info && when ? (
              <>
                {'. '}
                {info.dateLabel} <time dateTime={s.updatedAt}>{when}</time>.
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Зручність словами сторінки кемпінгу.
 *
 * 🔴 Через крапку з комою, а не кому: у підписів є власні коми
 * («Wheelchair access, incl. limited»), і перелік через кому читався б як
 * два окремі пункти, один із яких — «incl. limited».
 */
const label = (k: string) => AMENITY_LABEL[k as keyof typeof AMENITY_LABEL].toLowerCase();

function NightBody({ day, night }: { day: number; night: PlannedNight }) {
  const name = night.name ?? 'Unnamed campsite';
  const weighed = night.reasons.filter((r) => r.weighed);
  const near = night.reasons.filter((r) => !r.weighed);
  const yes = Object.keys(AMENITY_LABEL).filter((k) => night.amenities[k] === 'yes');
  const no = Object.keys(AMENITY_LABEL).filter((k) => night.amenities[k] === 'no');
  return (
    <div className="mt-2">
      <p className="text-ink">
        A night at{' '}
        {night.path ? (
          <Link href={night.path} className={`${VALUE} underline`}>
            {name}
          </Link>
        ) : (
          <span className={VALUE}>{name}</span>
        )}{' '}
        <span className="text-ink-2">({countryName(night.country)})</span>
      </p>
      {/* 🔴 Головне — завжди, бо воно є в кожного запису (позиція): де цей
          день закінчився б при рівному розподілі, і скільки від лінії. Це
          ВИМІРЯНІ відстані, а не «найкраще підходить»: нічого тут не
          каже, що кожна ніч сама по собі найближча до свого місця, бо
          набір ночівель обирається разом (динамічне програмування), і
          ніч може бути ближчою за іншу, але не в тому наборі.
          Решта причин — лише те, що в записі справді є; порожній перелік
          читається «більше нічого не записано», а не «ми не знаємо, чому». */}
      <p className="mt-1 text-sm text-ink-2">
        On an even split of the trip, day {day} would end {distance(night.fromTargetM)} from this
        campsite. It lies {distance(night.offsetM)} to the side of the straight line from your
        start to your destination.
      </p>
      {weighed.length > 0 && (
        <>
          <p className="mt-2 text-sm text-ink-2">It also scored for:</p>
          <ul className="list-disc pl-5 text-sm text-ink-2">
            {weighed.map((r) => (
              <li key={r.field}>{r.text}</li>
            ))}
          </ul>
        </>
      )}
      {near.length > 0 && (
        <>
          <p className="mt-2 text-sm text-ink-2">Also nearby, not part of the score:</p>
          <ul className="list-disc pl-5 text-sm text-ink-2">
            {near.map((r) => (
              <li key={r.field}>{r.text}</li>
            ))}
          </ul>
        </>
      )}
      {night.reasons.length === 0 && (
        <p className="mt-2 text-sm text-ink-2">
          Our data holds nothing else about this campsite to add.
        </p>
      )}
      <p className="mt-2 text-sm text-ink-2">
        {yes.length + no.length === 0
          ? 'No facilities are recorded for it.'
          : [
              yes.length > 0 ? `Recorded: ${yes.map(label).join('; ')}.` : '',
              no.length > 0 ? `Recorded as not there: ${no.map(label).join('; ')}.` : '',
            ]
              .filter(Boolean)
              .join(' ')}{' '}
        Anything not listed is not recorded, which is not the same as not there.
      </p>
      <Sources sources={night.sources} />
    </div>
  );
}

function DayItem({ day, last }: { day: PlannedDay; last: boolean }) {
  return (
    <li className="border-t border-line-2 pt-3 first:border-t-0 first:pt-0">
      <h4 className="font-semibold text-heading">Day {day.day}</h4>
      <p className="mt-1 text-ink">
        {distance(day.runM)} {STRAIGHT_LINE}
        {last ? ', to your destination.' : '.'}
      </p>
      {day.night && <NightBody day={day.day} night={day.night} />}
    </li>
  );
}

function HowChosen({ plan }: { plan: PlannedTrip }) {
  return (
    <section className="mt-6" aria-labelledby="plan-how-heading">
      <h3 id="plan-how-heading" className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-2">
        How the nights were chosen
      </h3>
      <p className="mt-2 text-sm text-ink-2">
        The straight line from your start to your destination is cut into days, and each night
        is taken from {plural(plan.candidates, 'campsite')} near that line. The planner picks the
        set of nights that fits where the days should end, and lets a day run shorter or longer
        than an even share where the campsites make that fit better. Each campsite is scored on:
      </p>
      <ul className="mt-2 list-disc pl-5 text-sm text-ink-2">
        {plan.ranking.map((t) => (
          <li key={t.id}>
            {RANKING_LABEL[t.id] ?? t.id}: {Math.round(t.weight * 100)}%
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-ink-2">
        A campsite where something is not recorded is not marked down for it; it only earns no
        bonus. This is not a quality rating.
      </p>
    </section>
  );
}

function Licences({ plan }: { plan: PlannedTrip }) {
  const ids = [
    ...new Set(plan.days.flatMap((d) => (d.night ? d.night.sources.map((s) => s.id) : []))),
  ];
  if (ids.length === 0) return null;
  return (
    <p className="mt-4 text-xs leading-5 text-ink-2">
      Campsite records come from{' '}
      {ids.map((id, i) => {
        const info = SOURCES[id];
        return (
          <span key={id}>
            {i > 0 ? ', ' : ''}
            {info ? (
              <>
                {info.name} (
                <a href={info.licenceUrl} className="underline" rel="license noopener noreferrer" target="_blank">
                  {info.licence}
                </a>
                )
              </>
            ) : (
              id
            )}
          </span>
        );
      })}
      .
    </p>
  );
}

function PlannedBody({ request, plan }: { request: PlanRequest; plan: PlannedTrip }) {
  const nights = plan.days.filter((d) => d.night).length;
  return (
    <>
      <p className="text-ink">
        <strong>
          {plural(plan.days.length, 'day')}, {plural(nights, 'night')}.
        </strong>{' '}
        From your start to your destination is {distance(plan.lengthM)} {STRAIGHT_LINE}.
      </p>
      {/* 🔴 Перед списком днів, а не під ним: перше, що має прочитати людина,
          — що це не дорога. Метри в плані — по прямій, годин за кермом немає,
          бо немає маршрутизатора, і речення каже це словами. */}
      <p className="mt-3 text-sm text-ink-2">
        <strong className="text-ink">Every distance here is a straight line, not a road.</strong>{' '}
        The planner does not know the roads, so it cannot say how far a day&rsquo;s drive is or how
        long it takes. Check the real route in your navigation app before you set off.
      </p>
      <ol className="mt-4 space-y-4" aria-label="The days of the trip">
        {plan.days.map((d, i) => (
          <DayItem key={d.day} day={d} last={i === plan.days.length - 1} />
        ))}
      </ol>
      <HowChosen plan={plan} />
      <Echo request={request} />
      <Licences plan={plan} />
      {/* 🔴 Твердження про те, що з даними сталося. Воно істинне, бо запит
          іде в READ ONLY транзакцію (plan.service.ts: перший рядок, який
          бачить зʼєднання, — BEGIN … READ ONLY, і spec це читає), а тіло
          запиту ніде не логується. Слово «ми» — не про Cloudflare, через
          який іде будь-який запит до сайту. */}
      <p className="mt-4 text-sm text-ink-2">
        To make this plan, your two points and the number of days were sent to our server. We do
        not store them.
      </p>
    </>
  );
}

const WHERE: Record<'from' | 'to', string> = { from: 'start', to: 'destination' };

/**
 * Що сказало джерело.
 *
 * 🔴 Вичерпний `switch`: гілка `default` присвоює `never`. Коли `PlanOutcome`
 * отримає ще один варіант, ця функція перестане компілюватись — і зупинить
 * збірку саме тут, у єдиному місці, де цей варіант треба намалювати.
 */
function OutcomeBody({ request, outcome }: { request: PlanRequest; outcome: PlanOutcome }) {
  switch (outcome.status) {
    case 'planned':
      return <PlannedBody request={request} plan={outcome.plan} />;
    case 'refused':
      return outcome.reason === 'round-trip' ? (
        <>
          <p className="text-ink">
            <strong>No plan for a round trip.</strong> The start and the destination are the same
            point. The planner cuts a line between two different points into days; it does not plan
            loops. Change one of the two.
          </p>
          <Echo request={request} />
        </>
      ) : (
        <>
          <p className="text-ink">
            <strong>No plan found.</strong> Along this straight line our data does not hold enough
            campsites to chain one night to the next: it ran out after{' '}
            {outcome.reachedNights} of {outcome.daysAsked - 1} nights, with{' '}
            {plural(outcome.candidates, 'campsite')} near the line. Nothing was made up to fill the
            gap.
          </p>
          <p className="mt-3 text-sm text-ink-2">
            That happens when the line crosses open water, or when the days are too many for the
            distance. Try fewer days, or other points.
          </p>
          <Echo request={request} />
        </>
      );
    case 'outside-union': {
      const which = outcome.fields.map((f) => WHERE[f]);
      return (
        <>
          <p className="text-ink">
            <strong>
              The {which.join(' and the ')} {which.length > 1 ? 'are' : 'is'} outside the European
              Union.
            </strong>{' '}
            The planner works inside the 27 member states, and the point you gave is not in one of
            them.
          </p>
          <p className="mt-3 text-sm text-ink-2">
            Check the numbers: latitude comes first. Ljubljana is {EXAMPLE.from}; the same two
            numbers the other way round are somewhere in Africa.
          </p>
          <Echo request={request} />
        </>
      );
    }
    case 'throttled':
      return (
        <p className="text-ink">
          <strong>Too many plans in a minute.</strong> The planner limits how many trips one visitor
          can ask for at once. Nothing was lost: your details are still in the form. Press{' '}
          <strong>Check my trip</strong> again in a minute.
        </p>
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
