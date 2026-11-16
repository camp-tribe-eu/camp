'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { countryName } from '@/lib/api';
import { MIN_LETTERS, suggestPlaces, type SuggestOutcome } from '@/lib/place-source';
import { parsePoint, type ChosenPlace } from '@/lib/plan';

// CAMP-456 — поле місця з підказками: «Ant» → «Antwerpen, Belgium».
//
// 🔴 ARIA-КОМБОБОКС ПО ПЕРЕЛІКУ З APG: `role=combobox` на інпуті,
// `aria-controls` на список, `aria-activedescendant` на підсвічений
// рядок, стрілки / Enter / Escape. Екранний читач чує кількість підказок
// у ділянці `aria-live`, а не лише бачить їх.
//
// 🔴 КОЖЕН РЯДОК КАЖЕ ТРИ РЕЧІ: назву, ВИД (місто, містечко, село, регіон,
// кемпінг) і КРАЇНУ — бо «Ant» буває кількома різними місцями, і форма не
// вгадує, яке.
//
// 🔴 ПОКИ ЛЮДИНА ПИШЕ КООРДИНАТИ, ПОШУК НЕ ПИТАЄТЬСЯ: рядок, який уже є
// парою чисел, не назва, і слати його на сервер не треба. Це й чесніше:
// координати з поля не покидають браузер, поки не натиснуто «Check my trip».
//
// 🔴 УСІ ЧОТИРИ СТАНИ ПОШУКУ ВИДНО: шукаю, знайдено, нічого немає, пошук
// недоступний. «Нічого немає» і «не відповів» різні, бо в першому випадку
// людині треба змінити запит, а в другому — скористатись координатами.

const DEBOUNCE_MS = 220;

const KIND_LABEL: Record<ChosenPlace['kind'], string> = {
  city: 'city',
  town: 'town',
  village: 'village',
  region: 'region',
  campsite: 'campsite',
};

export interface PlaceFieldProps {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  /** Стиль поля: той самий, що в решти полів форми. */
  className: string;
  onType: (text: string) => void;
  onPick: (place: ChosenPlace) => void;
}

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; outcome: SuggestOutcome };

export default function PlaceField(props: PlaceFieldProps) {
  const { id, label, value, disabled, invalid, describedBy, className, onType, onPick } = props;
  const [state, setState] = useState<State>({ phase: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const statusId = useId();
  const abort = useRef<AbortController | null>(null);
  /** Рядок, для якого вже обрано місце: підказки на нього не питаються. */
  const picked = useRef<string | null>(null);

  const query = value.trim();
  const isNumbers = query !== '' && parsePoint(query).ok;
  const searchable = [...query].length >= MIN_LETTERS && !isNumbers && picked.current !== query;

  useEffect(() => {
    abort.current?.abort();
    if (!searchable) {
      setState({ phase: 'idle' });
      return;
    }
    setState({ phase: 'loading' });
    const ctl = new AbortController();
    abort.current = ctl;
    const timer = setTimeout(() => {
      suggestPlaces(query, ctl.signal).then((outcome) => {
        // Відповідь на запит, якого вже немає (людина дописала літеру),
        // відкидається — за сигналом, а не за прапорцем у стані.
        if (ctl.signal.aborted) return;
        setState({ phase: 'done', outcome });
        setActive(-1);
      });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [query, searchable]);

  const places = state.phase === 'done' && state.outcome.status === 'found' ? state.outcome.places : [];
  const showList = open && places.length > 0;

  const choose = (p: ChosenPlace) => {
    picked.current = p.label;
    setOpen(false);
    setActive(-1);
    onPick(p);
  };

  let status = '';
  if (searchable && state.phase === 'loading') status = 'Looking for places…';
  else if (state.phase === 'done' && searchable) {
    switch (state.outcome.status) {
      case 'found':
        status = `${state.outcome.places.length} ${state.outcome.places.length === 1 ? 'place' : 'places'} found. Use the arrow keys to choose one.`;
        break;
      case 'none':
        status =
          'Nothing in our data starts like that. Names are matched as spelled locally (München, not Munich). Try another spelling, or write latitude and longitude.';
        break;
      case 'unavailable':
        status = 'Place search is not available here. Write latitude and longitude instead.';
        break;
      case 'failed':
        status = 'The place search did not answer. Try again, or write latitude and longitude.';
        break;
    }
  }

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-ink-2" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        required
        disabled={disabled}
        value={value}
        onChange={(e) => {
          picked.current = null;
          setOpen(true);
          onType(e.target.value);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && places.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % places.length);
          } else if (e.key === 'ArrowUp' && places.length > 0) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a <= 0 ? places.length - 1 : a - 1));
          } else if (e.key === 'Enter' && showList && active >= 0) {
            // Enter на підсвіченій підказці обирає її, а не відправляє форму.
            e.preventDefault();
            choose(places[active]);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            setOpen(false);
          }
        }}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={`${describedBy ?? ''} ${statusId}`.trim()}
        className={className}
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label}: suggestions`}
          data-testid="place-suggestions"
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded border border-line-2 bg-surface py-1 shadow-lg"
        >
          {places.map((p, i) => (
            <li
              key={`${p.kind}-${p.label}-${p.lat}-${p.lon}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              data-testid="place-option"
              // `onMouseDown`, а не `onClick`: клік спершу відбирає фокус у
              // інпута (blur закрив би список раніше, ніж спрацює click).
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              className={`cursor-pointer px-3 py-2 ${i === active ? 'bg-surface-2' : ''}`}
            >
              <span className="wrap-anywhere font-semibold text-heading">{p.name}</span>
              <span className="block text-sm text-ink-2">
                {KIND_LABEL[p.kind]}, {countryName(p.country)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* Ділянка оголошень існує завжди (див. PlanOutcomePanel): створена
          разом із повідомленням, вона змовчала б для екранного читача. */}
      <p id={statusId} aria-live="polite" data-testid="place-status" className="mt-1 text-sm text-ink-2">
        {status}
      </p>
    </div>
  );
}
