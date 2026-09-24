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
  /** Campsites currently drawn. */
  shown: number;
  /** Total in the dataset, for "12 of 1079". */
  total: number;
  /** Dropped only for want of data — the honesty number. */
  unknownExcluded: number;
}

export default function MapFilters({
  state,
  onChange,
  shown,
  total,
  unknownExcluded,
}: Props) {
  const setTypes = (t: SpotType) =>
    onChange({ ...state, types: toggle(state.types, t, SPOT_TYPES) });

  const setAmenity = (a: AmenityKey) =>
    onChange({
      ...state,
      amenities: toggle(state.amenities, a, [
        ...GENERAL_AMENITY_KEYS,
        ...ACCESSIBILITY_KEYS,
      ]),
    });

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
          demands a campsite recorded as having all ten, and measured on
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
        onAll={() =>
          onChange({ ...state, amenities: [...GENERAL_AMENITY_KEYS] })
        }
        onNone={() =>
          onChange({
            ...state,
            amenities: state.amenities.filter((a) =>
              ACCESSIBILITY_KEYS.includes(a),
            ),
          })
        }
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
          onChange({
            ...state,
            amenities: [
              ...state.amenities.filter((a) => !ACCESSIBILITY_KEYS.includes(a)),
              ...ACCESSIBILITY_KEYS,
            ],
          })
        }
        onNone={() =>
          onChange({
            ...state,
            amenities: state.amenities.filter(
              (a) => !ACCESSIBILITY_KEYS.includes(a),
            ),
          })
        }
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
        <p data-testid="filter-count" className="text-ink-2">
          <strong className="font-semibold text-heading">{shown}</strong>
          {filtering ? ` of ${total} campsites` : ' campsites'}
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
