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
      <Group legend="Type">
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

      <Group legend="Facilities">
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
      <Group legend="Accessibility">
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
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mt-3 first:mt-0 sm:mt-0">
      <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-2">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
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
