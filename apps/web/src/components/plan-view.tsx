import Link from 'next/link';
import type { ReactNode, Ref } from 'react';
import { AMENITY_LABEL, countryName } from '@/lib/api';
import {
  EXAMPLE,
  fieldOrder,
  MAX_DAYS,
  MAX_VIA,
  viaField,
  VEHICLE_TYPES,
  type ChosenPlace,
  type LegRequest,
  type LegResult,
  type PlanDraft,
  type PlanErrors,
  type PlanField,
  type PlanOutcome,
  type PlannedDay,
  type PlannedNight,
  type PlannedSource,
  type PlannedTrip,
  type PlanRun,
  type TripRequest,
  type VehicleType,
} from '@/lib/plan';
import type { SavedTrip } from '@/lib/plan-save';
import { SOURCES, formatUpdated } from '@/lib/sources';
import { Button } from '@/components/button';
import Checkbox from '@/components/checkbox';
import PlaceField from '@/components/place-field';

// CAMP-205 — те, що /plan малює: форма й панель відповіді.
// CAMP-456 — з назвами місць, проміжними точками, зворотним шляхом, даними
// авто, збереженням і посиланням.
//
// 🔴 Лише розмітка. Жодного запиту, жодного імпорту plan-source.ts:
// ці функції беруть значення і повертають HTML, тому їх можна прочитати на
// виданому HTML (tests/unit/plan-view.spec.tsx), а не на константі чи класі.
// Стан живе в plan-form.tsx, правила — в lib/plan.ts. (Поле місця —
// `PlaceField` — само питає підказки, але в виданому HTML воно просто поле.)
//
// 🔴 Мова верстки — наявних сторінок, а не нова. Двоколонка «форма +
// відповідь» і поля — з калькулятора вартості (CAMP-55); червона рамка
// помилки — з тієї ж ідіоми, що попередження на сторінці кемпінга
// (`border-warn/40 bg-warn/5`); жовта рамка «ще не працює» — з
// повідомлення про застарілі ціни пального.
//
// 🔴 Два відхилення від калькулятора, обидва заради доступності, обидва
// заміряні, а не «так гарніше»:
//
//   · підказки під полями — `text-ink-2`. Колись тут стояв `ink-3`:
//     #a1a1a1 на тлі форми #f8f8f9 дає 2.43:1 проти 4.5 для звичайного
//     тексту, і axe це не пропускав. CAMP-471 прибрав `text-ink-3` з
//     проєкту цілком — токена більше немає, тож повернути його сюди
//     нема чим;
//   · поля не гасять контур фокуса (`focus:outline-hidden`) — глобальний
//     `:focus-visible` з globals.css лишається, бо одна лише зміна
//     кольору рамки — це слабка ознака фокуса для людини з клавіатури.

/** Ідентифікатор поля. Підсумок помилок веде на нього, `aria-describedby` посилається на похідні. */
export const fieldId = (f: PlanField): string => `plan-${f}`;

const PLACES_HINT_ID = 'plan-places-hint';
const DAYS_HINT_ID = 'plan-days-hint';
const VEHICLE_HINT_ID = 'plan-vehicle-hint';
const errorId = (f: PlanField) => `${fieldId(f)}-error`;

const LABEL = 'block text-sm font-medium text-ink-2';
const HINT = 'mt-1 text-sm text-ink-2';
const FIELD =
  'mt-1 w-full rounded border bg-surface px-3 py-2 text-ink focus:border-line-blue';
const border = (bad: boolean) => (bad ? 'border-warn' : 'border-line-2');

/**
 * 🔴 СЕЛЕКТ ЗА ТЕМОЮ (docs/design-system-from-theme.md, «Поля вводу й
 * селекти»): `appearance: none` і ВЛАСНИЙ шеврон, а справа відступ 40px
 * (`padding-inline-end`) — тема тримає його втричі більшим за лівий, і
 * саме тому шеврон не торкається краю. Ці дві речі ходять парою: без
 * власного шеврона `appearance: none` зробив би селект схожим на звичайне
 * поле. Висота 56px і відступи 18px — теж із теми.
 */
const SELECT = `${FIELD} min-h-14 appearance-none py-[18px] ps-4 pe-10 font-semibold`;

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

const VEHICLE_LABEL: Record<VehicleType, string> = {
  motorhome: 'Motorhome',
  campervan: 'Campervan',
  caravan: 'Car with a caravan',
  tent: 'Car with a tent',
};

/** Селект зі своїм шевроном: див. `SELECT`. Шеврон — вбудований SVG, а не `background-image`: так його не торкається CSP (`img-src`). */
function Select(props: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  children: ReactNode;
  describedBy?: string;
}) {
  return (
    <div>
      <label className={LABEL} htmlFor={props.id}>
        {props.label}
      </label>
      <div className="relative">
        <select
          id={props.id}
          name={props.id}
          disabled={props.disabled}
          value={props.value}
          aria-describedby={props.describedBy}
          onChange={(e) => props.onChange(e.target.value)}
          className={`${SELECT} border-line-2`}
        >
          {props.children}
        </select>
        <svg
          aria-hidden="true"
          data-testid="select-chevron"
          width="12"
          height="8"
          viewBox="0 0 12 8"
          fill="none"
          className="pointer-events-none absolute end-4 top-1/2 mt-0.5 -translate-y-1/2 text-heading"
        >
          <path d="M1 1.5 6 6.5 11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
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
  /** Що сталося з `?to=` чи посиланням: рядок над формою, або нічого. */
  notice?: string | null;
  onEdit: (field: PlanField, value: string) => void;
  onPick: (field: 'from' | 'to' | `via-${string}`, place: ChosenPlace) => void;
  onVehicleType: (value: '' | VehicleType) => void;
  onRoundTrip: (value: boolean) => void;
  onAddVia: () => void;
  onRemoveVia: (id: string) => void;
  onMoveVia: (id: string, to: number) => void;
  onSubmit: () => void;
  /** Клік по помилці в підсумку: фокус на полі, яке треба виправити. */
  onJump: (field: PlanField) => void;
}

export function PlanFormView(p: PlanFormViewProps) {
  const { draft, errors, ready } = p;
  const failing = fieldOrder(draft).filter((f) => errors[f]);
  const placeField = (
    field: 'from' | 'to' | `via-${string}`,
    label: string,
    text: string,
    hintId = PLACES_HINT_ID,
  ) => (
    <PlaceField
      id={fieldId(field)}
      label={label}
      value={text}
      disabled={!ready}
      invalid={!!errors[field]}
      describedBy={describedBy(hintId, errors[field] && errorId(field))}
      className={`${FIELD} ${border(!!errors[field])}`}
      onType={(value) => p.onEdit(field, value)}
      onPick={(place) => p.onPick(field, place)}
    />
  );

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
        p.onSubmit();
      }}
    >
      <h2 id="plan-form-heading" className="text-lg text-heading">
        Your trip
      </h2>

      {!ready && (
        <p data-testid="plan-loading" className="mt-2 text-sm text-ink-2">
          The form comes alive when the page finishes loading. The note above
          needs nothing.
        </p>
      )}

      {p.notice && (
        <p data-testid="plan-notice" role="status" className="mt-4 rounded border border-line-2 bg-surface p-3 text-sm text-ink">
          {p.notice}
        </p>
      )}

      {failing.length > 0 && (
        <div
          ref={p.summaryRef}
          role="alert"
          tabIndex={-1}
          data-testid="plan-errors"
          className="mt-4 rounded border border-warn/40 bg-warn/5 p-4 text-sm text-ink"
        >
          <h3 className="text-heading">There is a problem</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {failing.map((f) => (
              <li key={f}>
                <a
                  href={`#${fieldId(f)}`}
                  className="underline"
                  onClick={(e) => {
                    e.preventDefault();
                    p.onJump(f);
                  }}
                >
                  {errors[f]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 space-y-4">
        <div>
          {placeField('from', 'Starting point', draft.from)}
          <ErrorLine field="from" errors={errors} />
        </div>

        {/* Проміжні точки: у тому порядку, у якому проїжджаються. Перетягнути
            за ручку чи кнопками «Up / Down» — клавіатурою. */}
        {draft.via.length > 0 && (
          <ol aria-label="Stops on the way" className="space-y-3" data-testid="via-list">
            {draft.via.map((v, i) => {
              const f = viaField(v.id);
              return (
                <li
                  key={v.id}
                  data-testid="via-row"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/plain');
                    if (id !== '' && id !== v.id) p.onMoveVia(id, i);
                  }}
                  className="rounded border border-dashed border-line-2 p-3"
                >
                  <div className="flex items-start gap-2">
                    <span
                      draggable={ready}
                      data-testid="via-handle"
                      title="Drag to change the order"
                      aria-hidden="true"
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', v.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className="mt-9 cursor-grab select-none px-1 text-xl leading-none text-ink-2"
                    >
                      ⋮⋮
                    </span>
                    <div className="min-w-0 flex-1">
                      {placeField(f, `Stop ${i + 1}`, v.text)}
                      <ErrorLine field={f} errors={errors} />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!ready || i === 0}
                      aria-label={`Move stop ${i + 1} up`}
                      onClick={() => p.onMoveVia(v.id, i - 1)}
                    >
                      Up
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!ready || i === draft.via.length - 1}
                      aria-label={`Move stop ${i + 1} down`}
                      onClick={() => p.onMoveVia(v.id, i + 1)}
                    >
                      Down
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger-soft"
                      disabled={!ready}
                      aria-label={`Remove stop ${i + 1}`}
                      onClick={() => p.onRemoveVia(v.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div>
          <Button
            type="button"
            size="sm"
            data-testid="add-via"
            disabled={!ready || draft.via.length >= MAX_VIA}
            onClick={p.onAddVia}
          >
            Add a stop on the way
          </Button>
          {draft.via.length >= MAX_VIA && (
            <p className={HINT}>A trip can have up to {MAX_VIA} stops between the start and the destination.</p>
          )}
        </div>

        <div>
          {placeField('to', 'Destination', draft.to)}
          <ErrorLine field="to" errors={errors} />
        </div>

        <Checkbox
          checked={draft.roundTrip}
          onChange={p.onRoundTrip}
          disabled={!ready}
          testId="round-trip"
          weight="plain"
        >
          Return to the start
        </Checkbox>

        {/* 🔴 Одна підказка на всі поля місць, і вона каже правду про те, що
            форма вміє: назви шукаються лише в нашій базі й так, як їх
            пишуть на місці; координати теж годяться. Приклад — справжні
            координати Любляни, а не «XX.XXXX». */}
        <p id={PLACES_HINT_ID} className={HINT}>
          Type at least three letters of a city, town, village, region or
          campsite and pick it from the list. Names are matched as they are
          written locally (München, not Munich). Or write latitude, then
          longitude, in degrees: Ljubljana is {EXAMPLE.from}.
        </p>

        <div>
          <label className={LABEL} htmlFor={fieldId('days')}>
            Number of days
          </label>
          <input
            id={fieldId('days')}
            name="days"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required
            disabled={!ready}
            value={draft.days}
            onChange={(e) => p.onEdit('days', e.target.value)}
            aria-invalid={errors.days ? true : undefined}
            aria-describedby={describedBy(DAYS_HINT_ID, errors.days && errorId('days'))}
            className={`${FIELD} ${border(!!errors.days)}`}
          />
          <p id={DAYS_HINT_ID} className={HINT}>
            Whole days, 1 to {MAX_DAYS}, and at least one per leg of the trip.
          </p>
          <ErrorLine field="days" errors={errors} />
        </div>

        <fieldset className="rounded border border-line-2 p-3" aria-describedby={VEHICLE_HINT_ID}>
          <legend className="px-1 text-sm font-medium text-ink-2">Your vehicle (optional)</legend>
          <div className="space-y-3">
            <Select
              id="plan-vehicle-type"
              label="Vehicle type"
              value={draft.vehicle.type}
              disabled={!ready}
              onChange={(v) => p.onVehicleType(v as '' | VehicleType)}
            >
              <option value="">Not specified</option>
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VEHICLE_LABEL[t]}
                </option>
              ))}
            </Select>
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ['height', 'Height, m', draft.vehicle.height],
                  ['length', 'Length, m', draft.vehicle.length],
                  ['weight', 'Weight, t', draft.vehicle.weight],
                ] as const
              ).map(([f, label, value]) => (
                <div key={f}>
                  <label className={LABEL} htmlFor={fieldId(f)}>
                    {label}
                  </label>
                  <input
                    id={fieldId(f)}
                    name={f}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={!ready}
                    value={value}
                    onChange={(e) => p.onEdit(f, e.target.value)}
                    aria-invalid={errors[f] ? true : undefined}
                    aria-describedby={describedBy(VEHICLE_HINT_ID, errors[f] && errorId(f))}
                    className={`${FIELD} ${border(!!errors[f])}`}
                  />
                  <ErrorLine field={f} errors={errors} />
                </div>
              ))}
            </div>
            {/* 🔴 Правда про ці числа: зберігаються з поїздкою й попадають у
                посилання, а планувальник їх НЕ читає — він не знає ні доріг,
                ні розмірів майданчиків, тож план від них не залежить. */}
            <p id={VEHICLE_HINT_ID} data-testid="vehicle-hint" className={HINT}>
              Saved with your trip and kept in the link, but the planner does not use them yet: it does
              not know the roads or the size of the pitches, so the plan is the same whatever you enter
              here.
            </p>
          </div>
        </fieldset>
      </div>

      <Button type="submit" disabled={!ready} variant="accent" className="mt-5">
        Check my trip
      </Button>
    </form>
  );
}

// ── Збереження й посилання ────────────────────────────────────────────

export interface PlanKeepViewProps {
  ready: boolean;
  name: string;
  saved: SavedTrip[];
  /** Скільки записів у сховищі не вдалося прочитати. */
  dropped: number;
  /** Повідомлення про останню дію: збережено, повно, сховище недоступне. */
  message: string | null;
  /** Посилання, яке зараз можна скопіювати; `null` — його ще не створено. */
  shareUrl: string | null;
  onName: (value: string) => void;
  onSave: () => void;
  onShare: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function PlanKeepView(p: PlanKeepViewProps) {
  return (
    <section
      aria-labelledby="plan-keep-heading"
      data-testid="plan-keep"
      className="mt-6 rounded-card border border-line-2 bg-surface-2 p-5"
    >
      <h2 id="plan-keep-heading" className="text-lg text-heading">
        Save and share
      </h2>
      <p className={HINT}>
        A saved trip stays in this browser only. We do not keep it, and there is no account. The link
        carries the places you entered inside the address after the “#”, which your browser never
        sends to us; whoever you give it to will see those places.
      </p>

      <div className="mt-3">
        <label className={LABEL} htmlFor="plan-save-name">
          Name for this trip
        </label>
        <input
          id="plan-save-name"
          type="text"
          autoComplete="off"
          maxLength={60}
          disabled={!p.ready}
          value={p.name}
          onChange={(e) => p.onName(e.target.value)}
          className={`${FIELD} border-line-2`}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" data-testid="save-trip" disabled={!p.ready} onClick={p.onSave}>
          Save this trip
        </Button>
        <Button type="button" data-testid="share-trip" disabled={!p.ready} onClick={p.onShare}>
          Copy link
        </Button>
      </div>

      <p role="status" data-testid="keep-message" className="mt-3 text-sm text-ink">
        {p.message}
      </p>

      {p.shareUrl && (
        <div className="mt-2">
          <label className={LABEL} htmlFor="plan-share-url">
            Link to this trip
          </label>
          <input
            id="plan-share-url"
            data-testid="share-url"
            type="text"
            readOnly
            value={p.shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            className={`${FIELD} border-line-2`}
          />
        </div>
      )}

      {p.dropped > 0 && (
        <p data-testid="saved-dropped" className="mt-3 text-sm text-ink">
          {p.dropped === 1
            ? 'One saved record in this browser could not be read and was left out.'
            : `${p.dropped} saved records in this browser could not be read and were left out.`}
        </p>
      )}

      <h3 className="mt-5 text-sm uppercase tracking-[0.08em] text-ink-2">Saved in this browser</h3>
      {p.saved.length === 0 ? (
        <p data-testid="saved-empty" className={HINT}>
          No saved trips yet.
        </p>
      ) : (
        <ul className="mt-2 space-y-2" data-testid="saved-list">
          {p.saved.map((t) => (
            <li key={t.id} data-testid="saved-item" className="flex flex-wrap items-center gap-2">
              <span className="wrap-anywhere min-w-0 flex-1 font-semibold text-heading">{t.name}</span>
              <Button type="button" size="sm" disabled={!p.ready} onClick={() => p.onOpen(t.id)} aria-label={`Open ${t.name}`}>
                Open
              </Button>
              <Button type="button" size="sm" variant="danger-soft" disabled={!p.ready} onClick={() => p.onDelete(t.id)} aria-label={`Delete ${t.name}`}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
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


/** Що запитано: один перегін показується так, як було до CAMP-456. */
function Echo({ trip }: { trip: TripRequest }) {
  const first = trip.stops[0];
  const last = trip.stops[trip.stops.length - 1];
  const via = trip.stops.slice(1, trip.roundTrip ? -2 : -1);
  const v = trip.vehicle;
  const rows: [string, ReactNode][] = [
    ['From', first.label],
    ...via.map((s, i): [string, ReactNode] => [`Stop ${i + 1}`, s.label]),
    [trip.roundTrip ? 'To, then back to the start' : 'To', trip.roundTrip ? trip.stops[trip.stops.length - 2].label : last.label],
    ['Days', trip.days],
  ];
  const vehicle = [
    v.type ? VEHICLE_LABEL[v.type] : null,
    v.heightM !== null ? `${v.heightM} m high` : null,
    v.lengthM !== null ? `${v.lengthM} m long` : null,
    v.weightT !== null ? `${v.weightT} t` : null,
  ].filter(Boolean);
  if (vehicle.length > 0) rows.push(['Vehicle (not used by the planner)', vehicle.join(', ')]);
  return (
    <>
      <h3 className="mt-4 text-xs uppercase tracking-[0.08em] text-ink-2">
        What you asked for
      </h3>
      {/* 🔴 Стовпчиком, а не рядками «ліворуч — праворуч»: панель вузька, а
          підписи місць і координати з багатьма знаками не стискаються. */}
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

function NightBody({ day, night, multi }: { day: number; night: PlannedNight; multi: boolean }) {
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
        {multi
          ? `On an even split of this leg, its day ${day} would end `
          : `On an even split of the trip, day ${day} would end `}
        {distance(night.fromTargetM)} from this campsite. It lies {distance(night.offsetM)} to the
        side of the straight line from{' '}
        {multi ? 'the start of this leg to the end of it.' : 'your start to your destination.'}
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

function DayItem({
  day,
  last,
  offset,
  multi,
}: {
  day: PlannedDay;
  last: boolean;
  offset: number;
  multi: boolean;
}) {
  // Нумерація днів наскрізна по всій поїздці: у другому перегоні перший день — не «Day 1».
  const n = day.day + offset;
  return (
    <li className="border-t border-line-2 pt-3 first:border-t-0 first:pt-0">
      <h4 className="text-heading">Day {n}</h4>
      <p className="mt-1 text-ink">
        {distance(day.runM)} {STRAIGHT_LINE}
        {last ? (multi ? ', to the end of this leg.' : ', to your destination.') : '.'}
      </p>
      {day.night && <NightBody day={day.day} night={day.night} multi={multi} />}
    </li>
  );
}

function HowChosen({ plan, multi }: { plan: PlannedTrip; multi: boolean }) {
  return (
    <section className="mt-6" aria-labelledby="plan-how-heading">
      <h3 id="plan-how-heading" className="text-sm uppercase tracking-[0.08em] text-ink-2">
        How the nights were chosen
      </h3>
      <p className="mt-2 text-sm text-ink-2">
        {multi
          ? 'Each leg is a straight line from one place to the next, cut into days, and each night is taken from the campsites near that line. '
          : `The straight line from your start to your destination is cut into days, and each night is taken from ${plural(plan.candidates, 'campsite')} near that line. `}
        The planner picks the set of nights that fits where the days should end, and lets a day run
        shorter or longer than an even share where the campsites make that fit better. Each campsite
        is scored on:
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

function Licences({ plans }: { plans: PlannedTrip[] }) {
  const ids = [
    ...new Set(
      plans.flatMap((p) => p.days.flatMap((d) => (d.night ? d.night.sources.map((s) => s.id) : []))),
    ),
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

function PlanDays({ leg, plan, multi }: { leg: LegRequest; plan: PlannedTrip; multi: boolean }) {
  return (
    <ol className="mt-4 space-y-4" aria-label="The days of the trip">
      {plan.days.map((d, i) => (
        <DayItem key={d.day} day={d} last={i === plan.days.length - 1} offset={leg.offset} multi={multi} />
      ))}
    </ol>
  );
}

/** Твердження про те, що з даними сталося. Див. коментар перед ним у `TripBody`. */
function Stored() {
  return (
    <p className="mt-4 text-sm text-ink-2">
      To make this plan, the points of each leg of your trip and its number of days were sent to our
      server. We do not store them. The trip is kept in this browser only if you press{' '}
      <strong>Save this trip</strong>.
    </p>
  );
}

const WHERE: Record<'from' | 'to', string> = { from: 'start', to: 'destination' };

/**
 * Що сказало джерело про ОДИН перегін.
 *
 * 🔴 Вичерпний `switch`: гілка `default` присвоює `never`. Коли `PlanOutcome`
 * отримає ще один варіант, ця функція перестане компілюватись — і зупинить
 * збірку саме тут, у єдиному місці, де цей варіант треба намалювати.
 */
function OutcomeBody({
  leg,
  outcome,
  multi,
}: {
  leg: LegRequest;
  outcome: PlanOutcome;
  multi: boolean;
}) {
  switch (outcome.status) {
    case 'planned': {
      const nights = outcome.plan.days.filter((d) => d.night).length;
      return (
        <>
          <p className="text-ink">
            <strong>
              {plural(outcome.plan.days.length, 'day')}, {plural(nights, 'night')}.
            </strong>{' '}
            {multi ? 'This leg is' : 'From your start to your destination is'}{' '}
            {distance(outcome.plan.lengthM)} {STRAIGHT_LINE}.
          </p>
          <PlanDays leg={leg} plan={outcome.plan} multi={multi} />
        </>
      );
    }
    case 'refused':
      return outcome.reason === 'round-trip' ? (
        <p className="text-ink">
          <strong>No plan for a round trip.</strong> The start and the destination
          {multi ? ' of this leg' : ''} are the same point. The planner cuts a line between two
          different points into days; it does not plan loops. Change one of the two.
        </p>
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
        </>
      );
    case 'outside-union': {
      const which = outcome.fields.map((f) => (multi ? `${WHERE[f]} of this leg (${leg[f === 'from' ? 'from' : 'to'].label})` : WHERE[f]));
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
        </>
      );
    }
    case 'throttled':
      return (
        <p className="text-ink">
          <strong>Too many plans in a minute.</strong> The planner limits how many trips one visitor
          can ask for at once, and every leg of a trip counts as one. Nothing was lost: your details
          are still in the form. Press <strong>Check my trip</strong> again in a minute.
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

/** Поїздка з одного перегону — так само, як до CAMP-456; з кількох — перегін за перегоном. */
function TripBody({ request, legs }: { request: TripRequest; legs: LegResult[] }) {
  const multi = legs.length > 1;
  const plans = legs.flatMap((l) => (l.outcome.status === 'planned' ? [l.outcome.plan] : []));
  const nights = plans.reduce((s, p) => s + p.days.filter((d) => d.night).length, 0);

  return (
    <>
      {multi && (
        <p className="text-ink">
          <strong>
            {plural(request.days, 'day')} in {plural(legs.length, 'leg')}
            {plans.length === legs.length ? `, ${plural(nights, 'night')}` : ''}.
          </strong>{' '}
          Each leg is planned on its own, from one of your places to the next; the days are shared
          between the legs in proportion to their straight-line length, at least one each.
        </p>
      )}
      {/* 🔴 Перед списком днів, а не під ним: перше, що має прочитати людина,
          — що це не дорога. Метри в плані — по прямій, годин за кермом немає,
          бо немає маршрутизатора, і речення каже це словами. */}
      <p className={multi ? 'mt-3 text-sm text-ink-2' : 'text-sm text-ink-2'}>
        <strong className="text-ink">Every distance here is a straight line, not a road.</strong>{' '}
        The planner does not know the roads, so it cannot say how far a day&rsquo;s drive is or how
        long it takes. Check the real route in your navigation app before you set off.
      </p>
      {multi ? (
        <ol className="mt-4 space-y-6" aria-label="The legs of the trip">
          {legs.map((l, i) => (
            <li key={i} data-testid="leg" className="border-t border-line-2 pt-4 first:border-t-0 first:pt-0">
              <h3 className="wrap-anywhere text-heading">
                Leg {i + 1}: {l.leg.from.label} to {l.leg.to.label}{' '}
                <span className="font-normal text-ink-2">({plural(l.leg.days, 'day')})</span>
              </h3>
              <div className="mt-2">
                <OutcomeBody leg={l.leg} outcome={l.outcome} multi />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="mt-3">
          <OutcomeBody leg={legs[0].leg} outcome={legs[0].outcome} multi={false} />
        </div>
      )}
      {plans.length > 0 && <HowChosen plan={plans[0]} multi={multi} />}
      {/* Що запитано, друкується, коли планувальник ВІДПОВІВ (план чи відмова).
          Коли він мовчить чи ліміт вичерпано, форма поруч і так тримає все. */}
      {legs.some((l) => l.outcome.status !== 'failed' && l.outcome.status !== 'throttled') && (
        <Echo trip={request} />
      )}
      <Licences plans={plans} />
      {/* 🔴 Твердження про те, що з даними сталося. Воно істинне, бо кожен
          запит іде в READ ONLY транзакцію (plan.service.ts: перший рядок, який
          бачить зʼєднання, — BEGIN … READ ONLY, і spec це читає), а тіло
          запиту ніде не логується. Слово «ми» — не про Cloudflare, через
          який іде будь-який запит до сайту. Збереження в браузері — окреме
          твердження, і воно тут же: поїздка лишається в браузері, лише якщо
          натиснуто кнопку. */}
      {plans.length > 0 ? <Stored /> : null}
    </>
  );
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
      return <TripBody request={run.request} legs={run.legs} />;
  }
}

export function PlanOutcomePanel({ run }: { run: PlanRun }) {
  return (
    <aside
      aria-labelledby="plan-result-heading"
      className="rounded-card border border-line-2 bg-surface p-5"
    >
      <h2 id="plan-result-heading" className="text-lg text-heading">
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
