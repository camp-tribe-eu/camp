'use client';

import {
  ACCESSIBILITY_KEYS,
  AMENITY_LABEL_SHORT,
  GENERAL_AMENITY_KEYS,
  SPOT_TYPES,
  SPOT_TYPE_LABEL_SHORT,
  type AmenityKey,
  type SpotType,
} from '@/lib/api';
import { isFiltering, toggle, type MapFilterState } from '@/lib/map-filter';
import { filterCountLabel, type MapDataState } from '@/lib/map-chunks';

// CAMP-35 / CAMP-25 — the filter panel.
//
// 🔴 Nothing here is hidden at any width, and that is the design rather
// than a shortcut. The card carries a lesson from UST-466: a new block
// silently disappeared in one display mode and nobody noticed. The usual
// answer — a drawer on mobile — is exactly that failure waiting to
// happen, because a filter behind a button that fails to open is a
// filter that does not exist.
//
// So every control is in the document at every width and simply wraps
// onto more rows. The e2e test asserts the count of controls is identical
// at 375, 768 and 1280 px, which is a claim this markup can keep.

interface Props {
  state: MapFilterState;
  onChange: (next: MapFilterState) => void;
  /** Dropped only for want of data, in the viewport — the honesty number. */
  unknownExcluded: number;
}

// 🔴 CAMP-297: `shown`, `total` і `dataState` звідси ПІШЛИ разом із
// лічильником. Вони описували результат, а не фільтри, і доки вони тут
// лежали, лічильник не міг жити деінде. `MapCount` нижче бере їх сам.

export default function MapFilters({
  state,
  onChange,
  unknownExcluded,
}: Props) {
  const setTypes = (t: SpotType) =>
    onChange({ ...state, types: toggle(state.types, t, SPOT_TYPES) });

  /**
   * Apply a new amenity selection, and never leave `includeUnknown`
   * stranded behind it.
   *
   * 🔴 One function, because the bug came from having two.
   *
   * `includeUnknown` only means something while an amenity is filtered —
   * the checkbox renders only then, and `isFiltering` ignores the flag,
   * so "Clear filters" hides too. Leave it set with no amenities and the
   * reader is on `/map?unknown=1` with no control for it and no way back,
   * and it is silently re-applied to whatever they tick next.
   *
   * The first fix put the reset in the bulk "None" handler and left the
   * CHIP alone — and the chip is how people actually clear a filter.
   * Review walked it in three clicks: tick Toilets, tick "also show
   * where this is not recorded", untick Toilets. Same stranded flag, and
   * the new test passed over it because it drove the button, not a chip.
   *
   * So every path that changes the amenity list goes through here.
   */
  const applyAmenities = (amenities: AmenityKey[]) =>
    onChange({
      ...state,
      amenities,
      includeUnknown: amenities.length === 0 ? false : state.includeUnknown,
    });

  const setAmenity = (a: AmenityKey) =>
    applyAmenities(
      toggle(state.amenities, a, [
        ...GENERAL_AMENITY_KEYS,
        ...ACCESSIBILITY_KEYS,
      ]),
    );

  /**
   * Clear one group, and nothing else.
   *
   * 🔴 Through `applyAmenities`, so clearing the last amenity also
   * drops `includeUnknown` — there is nothing left to be unknown ABOUT.
   * Review walked it: tick Toilets, tick "also show where this is not
   * recorded", press "None" — and the reader was left on
   * `/map?unknown=1` with the checkbox gone (it only renders while an
   * amenity is filtered) and "Clear filters" hidden (nothing is being
   * filtered). A flag with no control, carried in a shareable URL, and
   * silently re-applied to the next amenity they ticked.
   *
   * The merge of CAMP-122 and CAMP-127 briefly had this function twice,
   * once each way. They agreed — which is exactly why it had to be one:
   * two copies of a rule agree until somebody edits one.
   */
  const clearGroup = (group: readonly AmenityKey[]) =>
    applyAmenities(state.amenities.filter((a) => !group.includes(a)));

  const filtering = isFiltering(state);

  return (
    <section
      aria-label="Filter campsites"
      data-testid="map-filters"
      // 🔴 The groups sit side by side from `sm` up, and the reason is a
      // measurement rather than taste. Stacked, this panel was 230 px
      // tall and pushed the map to y=540 in a 1280×720 window — far
      // enough that a campsite marker at the centre of the map landed 35
      // px BELOW the fold and could not be clicked without scrolling.
      // Found by the existing marker-click test, which is exactly the
      // kind of quiet breakage the card's UST-466 note is about.
      //
      // Still no media query hides anything: on a phone the groups stack
      // again and every control is present, just lower down.
      className="mb-3 rounded-card border border-line-2 bg-surface p-3 sm:flex sm:flex-wrap sm:items-start sm:gap-x-6 sm:p-4"
    >
      {/* 🔴 CAMP-122 asks for "all" and "none" on every group, and the
          two are NOT the same control with a different label.
          
          "All" on Type means every type is ticked, which shows exactly
          what "none ticked" already shows — so it is a convenience, not a
          new state. "All" on Facilities is a different thing entirely: it
          demands a campsite recorded as having all eight, and measured on
          our data that is a handful of sites. That is a legitimate and
          very narrow query, so the button says what it does rather than
          promising "everything". */}
      <Group
        legend="Type"
        onAll={() => onChange({ ...state, types: [...SPOT_TYPES] })}
        onNone={() => onChange({ ...state, types: [] })}
        allPressed={state.types.length === SPOT_TYPES.length}
        nonePressed={state.types.length === 0}
        testId="type"
      >
        {SPOT_TYPES.map((t) => (
          <Chip
            key={t}
            testId={`filter-type-${t}`}
            label={SPOT_TYPE_LABEL_SHORT[t]}
            pressed={state.types.includes(t)}
            onClick={() => setTypes(t)}
          />
        ))}
      </Group>

      <Group
        legend="Facilities"
        // 🔴 Keeps the accessibility side, and it did not.
        //
        // This replaced the whole amenities array, which holds BOTH
        // groups — so a reader who ticked "Step-free" and then pressed
        // "All" under Facilities had their wheelchair filter silently
        // untick, and the map started showing sites that are not
        // step-free. Found in review; the same commit's message claimed
        // this boundary was respected. It was, for "None", and forgotten
        // for "All".
        onAll={() =>
          applyAmenities([
            ...GENERAL_AMENITY_KEYS,
            ...state.amenities.filter((a) => ACCESSIBILITY_KEYS.includes(a)),
          ])
        }
        onNone={() => clearGroup(GENERAL_AMENITY_KEYS)}
        allPressed={GENERAL_AMENITY_KEYS.every((a) =>
          state.amenities.includes(a),
        )}
        nonePressed={
          !GENERAL_AMENITY_KEYS.some((a) => state.amenities.includes(a))
        }
        testId="amenity"
      >
        {GENERAL_AMENITY_KEYS.map((a) => (
          <Chip
            key={a}
            testId={`filter-amenity-${a}`}
            label={AMENITY_LABEL_SHORT[a]}
            pressed={state.amenities.includes(a)}
            onClick={() => setAmenity(a)}
          />
        ))}
      </Group>

      {/* 🔴 Its own group with its own heading, which is what CAMP-25
          asks for. The two entries say different things on purpose:
          43 of the 87 campsites that answer this question are tagged
          `limited`, so one combined "wheelchair access" tick would be
          wrong for half the people relying on it. */}
      <Group
        legend="Accessibility"
        onAll={() =>
          applyAmenities([
            ...state.amenities.filter((a) => !ACCESSIBILITY_KEYS.includes(a)),
            ...ACCESSIBILITY_KEYS,
          ])
        }
        onNone={() => clearGroup(ACCESSIBILITY_KEYS)}
        allPressed={ACCESSIBILITY_KEYS.every((a) => state.amenities.includes(a))}
        nonePressed={!ACCESSIBILITY_KEYS.some((a) => state.amenities.includes(a))}
        testId="access"
      >
        {ACCESSIBILITY_KEYS.map((a) => (
          <Chip
            key={a}
            testId={`filter-amenity-${a}`}
            label={AMENITY_LABEL_SHORT[a]}
            pressed={state.amenities.includes(a)}
            onClick={() => setAmenity(a)}
          />
        ))}
      </Group>

      <div className="mt-3 flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-2 pt-3 text-sm">
        {/* 🔴 "0 campsites" is a sentence about the world. This panel
            only knows about campsites it has LOADED, and above
            DETAIL_ZOOM it has loaded none — the map is drawing regions.
            So it printed a bold 0 directly above "3,116 campsites in
            view", and the two disagreed on the same screen.

            That is the CAMP-127 defect again, one component over: a
            reader reads 0 as "there are none here" and leaves. Found by
            opening the page and looking at it, not by a test — every
            test was green, because `shown` was correctly the number of
            things drawn.

            Zoomed out, the count says it has not counted. Filters apply
            to individual campsites, so while none are loaded there is no
            honest filtered number to give — and inventing one from the
            region totals would ignore the filters the reader just set. */}
        {/* 🔴 CAMP-133: the sentence gets the whole row, so the controls
            under it cannot be pushed sideways by it.

            This row is [count] [checkbox] [Clear filters], and the count
            changes width the whole time the map is settling. Measured on
            webkit against the production build: as the sentence went
            "Counting campsites…" → "526 of 2,459 campsites in view" →
            "2,356 of 2,459 campsites in view", the checkbox slid from
            x=239 to x=292 to x=304 — 65 px of travel, while a reader was
            reaching for it. With the sentence on its own row it stays at
            x=91 for all three. ("Clear filters" was already anchored by
            `ml-auto`; it sat at x=1101 throughout.)

            This is the rule the `Bulk` buttons below already state — a
            control that moves is a control that gets mis-tapped — and
            this row was the place that broke it. It is also why a
            Playwright `check()` here can report "clicking the checkbox
            did not change its state": the target moved out from under
            the click between the actionability check and the event. */}
        {/* 🔴 CAMP-255. «Wild camping» — це фільтр на 2 917 точок, і до
            цього рядка ЄДИНЕ застереження про законність ночівлі жило на
            сторінці окремого кемпінгу. Читач, який фільтрує на мапі,
            бачив піни й не бачив нічого.

            Заміряно 25.09.2026 по ЄС-27: на 48 970 місць ночівлі
            відкриті дані дають 651 ствердну відповідь «тут можна». Тобто
            питання «чи можна мені тут заночувати» у відкритих даних
            відповіді не має, і тип місця на неї теж не відповідає:
            `wild` приходить із `backcountry=yes` або `camp_site=basic`,
            а це про те, ЧИМ місце є, не про дозвіл.

            🔴 ЧОМУ ТУТ, А НЕ ПІД ЧИПАМИ «Type», де стояло спершу.
            Заміряно в Chromium на справжньому білді globals.css, за
            ШИРИНАМИ ВМІСТУ (сторінка — `max-w-wrap px-4`, тобто 1180
            мінус padding, а не ширина вікна). Висота цієї панелі:

              1156 px   без абзацу 207   під чипами 261   тут 255
               736 px               271               345      339
               358 px               371               485      479

            І це сходиться з еталонами `visual`, перезнятими в CI на
            справжній сторінці: ноутбук виріс на 48 px, телефон на 108 —
            рівно 255−207 і 479−371. Перший замір робив по ширині вікна
            й давав для телефона 88; різницю дає саме `px-4`, бо на
            358 px абзац лягає в пʼять рядків замість чотирьох.

            Різницю робить не текст, а місце. Групи від `sm` лежать
            поруч як flex-елементи й беруть ширину ЗА ВМІСТОМ, тож абзац
            усередині `fieldset` роздував «Type» із 432 до 1122 px —
            «Facilities» і «Accessibility» падали на новий ряд. У вже
            повноширокому нижньому ряду «Type» лишається 432 px, рівно
            як без абзацу.

            🔴 А 230 px із коментаря при `className` вище — це вже НЕ
            бюджет, і я це перевірив, а не успадкував. Тест, який тоді
            впав, із того часу робить `scrollIntoViewIfNeeded()` ДО
            читання координат (`tests/e2e/map.spec.ts:793`), і його ж
            коментар каже, що виправлення було в двох місцях. Панель
            більше не вирішує, чи клікається маркер.

            🔴 Видно ЗАВЖДИ, не лише коли обрано «Wild». Застереження, яке
            треба спершу викликати, половина читачів не побачить — те
            саме міркування записане в `travel-notice.tsx`, і воно тут
            важить більше, бо мапа це перше, що відкривають. */}
        <p
          data-testid="overnight-caveat"
          className="w-full text-xs leading-5 text-ink-2"
        >
          Being on this map is not permission to stay the night. Whether you
          may is decided by local law and the landowner, and open data
          answers that for almost none of these places — the type of a site
          describes what it is, not what you are allowed to do there.
        </p>

        {/* 🔴 The sentence the card is really asking for. OpenStreetMap
            not recording a shower is not a campsite without one, and a
            filter that quietly drops 820 sites would be stating something
            we do not know. It says so, and offers the choice.

            One checkbox, present for as long as an amenity is filtered —
            not one that appears and another that replaces it. Ticking it
            sends `unknownExcluded` to zero by design, so a control keyed
            off that number would vanish under the reader's cursor the
            moment they used it. */}
        {state.amenities.length > 0 && (
          <label
            data-testid="filter-include-unknown"
            className="flex cursor-pointer items-center gap-2 text-ink-2"
          >
            <input
              type="checkbox"
              checked={state.includeUnknown}
              onChange={(e) =>
                onChange({ ...state, includeUnknown: e.target.checked })
              }
              className="h-4 w-4 accent-line-blue"
            />
            <span>
              {state.includeUnknown ? (
                'Including campsites where this is not recorded'
              ) : (
                <>
                  Also show{' '}
                  <strong className="font-semibold text-heading">
                    {unknownExcluded}
                  </strong>{' '}
                  where this is not recorded
                </>
              )}
            </span>
          </label>
        )}

        {filtering && (
          <button
            type="button"
            data-testid="filter-clear"
            onClick={() =>
              onChange({ types: [], amenities: [], includeUnknown: false })
            }
            className="ml-auto rounded-sm border border-line-2 px-2 py-1 text-sm text-heading hover:border-line-blue"
          >
            Clear filters
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * «898 campsites in view» — головний зворотний звʼязок мапи.
 *
 * 🔴 CAMP-297: ЖИВЕ НАД ПАНЕЛЛЮ, А НЕ ВСЕРЕДИНІ НЕЇ. Заміряно на
 * 390×844: лічильник лежав на 756 px, бо над ним 74 px шапки й панель
 * фільтрів на 371 — а після CAMP-255 на 479. Читач, що прийшов із
 * пошуку, бачив фільтри й не бачив, скільки знайшлось.
 *
 * Картка сама питала, чи йому там місце. Ні: це не контроль, а
 * результат. Нижній відступ під банер (CAMP-264) цього вилікувати не
 * міг — він додає місце В КІНЦІ документа, а причина була на початку.
 *
 * 🔴 І це НЕ згортання фільтрів за кнопку. Згортання сховало б разом із
 * ними застереження про ночівлю, яке CAMP-255 навмисно тримає завжди
 * видимим.
 */
export function MapCount({
  shown,
  total,
  dataState,
  state,
}: {
  shown: number;
  total: number;
  dataState: MapDataState;
  state: MapFilterState;
}) {
  const count = filterCountLabel(dataState, {
    shown,
    total,
    filtering: isFiltering(state),
  });
  return (
    <p data-testid="filter-count" className="mt-3 text-sm text-ink-2">
      {count.value !== null && (
        <strong className="font-semibold text-heading">
          {count.value.toLocaleString('en-GB')}
        </strong>
      )}
      {count.text}
    </p>
  );
}

function Group({
  legend,
  children,
  onAll,
  onNone,
  allPressed,
  nonePressed,
  testId,
}: {
  legend: string;
  children: React.ReactNode;
  onAll?: () => void;
  onNone?: () => void;
  allPressed?: boolean;
  nonePressed?: boolean;
  testId?: string;
}) {
  return (
    <fieldset className="mt-3 first:mt-0 sm:mt-0">
      <legend className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-2">
        {legend}
        {/* 🔴 In the document at every width, like every other control
            here — CAMP-35's rule. A bulk action hidden behind a menu on a
            phone is a bulk action nobody uses, and this panel already
            carries the lesson that a filter behind a button that fails to
            open is a filter that does not exist. */}
        {onAll && onNone && (
          <span className="flex gap-1 normal-case tracking-normal">
            <Bulk
              testId={`filter-${testId}-all`}
              label="All"
              disabled={allPressed}
              onClick={onAll}
            />
            <Bulk
              testId={`filter-${testId}-none`}
              label="None"
              disabled={nonePressed}
              onClick={onNone}
            />
          </span>
        )}
      </legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

/** A bulk action, small but still a real target and still focusable. */
function Bulk({
  label,
  onClick,
  disabled,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      // 🔴 Disabled, not hidden. A control that disappears once it has
      // nothing to do moves every other control next to it, and on a
      // phone that means the thing under the reader's thumb changes
      // between one tap and the next.
      //
      // 🔴 Both attributes, and the test drives the FACT rather than the
      // claim: Playwright's toBeDisabled() is satisfied by aria-disabled
      // alone, so removing the real one left every test green while the
      // button stayed clickable. Review proved it by mutation.
      disabled={disabled}
      aria-disabled={disabled}
      className={
        'rounded-sm border px-1.5 py-0.5 text-xs font-medium transition-colors ' +
        (disabled
          ? 'cursor-default border-line-2 text-ink-2 opacity-50'
          : 'border-line-2 text-ink-2 hover:border-line-blue hover:text-heading')
      }
    >
      {label}
    </button>
  );
}

function Chip({
  label,
  pressed,
  onClick,
  testId,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onClick}
      // 🔴 h-9 and the padding are the same at every width. A control
      // that shrinks to save a row on a phone is a control that gets
      // mis-tapped; 36 px is the smallest that reliably does not.
      className={
        'inline-flex h-9 items-center rounded-sm border px-3 text-sm transition-colors ' +
        (pressed
          ? 'border-line-blue bg-accent-surface font-semibold text-heading'
          : 'border-line-2 bg-surface text-ink-2 hover:border-line-blue hover:text-heading')
      }
    >
      {label}
    </button>
  );
}
