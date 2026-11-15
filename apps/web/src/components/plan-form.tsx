'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import {
  checkDraft,
  initialState,
  planReducer,
  planTrip,
  type PlanField,
} from '@/lib/plan';
import {
  addSaved,
  decodeShare,
  defaultName,
  encodeShare,
  parseSaved,
  removeSaved,
  serializeSaved,
  type SavedTrip,
} from '@/lib/plan-save';
import { resolveCampsite } from '@/lib/place-source';
import { planRoute } from '@/lib/plan-source';
import {
  fieldId,
  PlanFormView,
  PlanKeepView,
  PlanOutcomePanel,
} from '@/components/plan-view';

// CAMP-205 — стан /plan. Тонка обгортка: усі правила в lib/plan.ts,
// уся розмітка в plan-view.tsx, а це лише з'єднує їх із React, із джерелом,
// із адресою сторінки й зі сховищем браузера.
//
// 🔴 `planRoute` імпортовано тут і ніде більше. Щоб підмінити джерело,
// не треба чіпати ні форму, ні її стани.
//
// CAMP-456 — три речі, які приходять ззовні і всі недовірені:
//
//   · `#t=…` — поїздка з посилання «поділитися» (`decodeShare`);
//   · `?to=<slug>` — кемпінг-фініш із кнопки «Route to here» на сторінці
//     кемпінгу (CAMP-320). Параметр читається, нічого більше: сторінки
//     кемпінгу цей файл не знає;
//   · `camptribe.trips` у `localStorage` — збережені поїздки (`parseSaved`).
//
// 🔴 КЛЮЧ ТУТ ЛІТЕРАЛОМ, А НЕ ІМПОРТОВАНИЙ — ВИМОГА СТОРОЖА правових сторінок
// (`legal-claims.ts` читає кожен `.setItem(` у `apps/web/src` і звіряє ключі зі
// сторінками «Cookies» і «Privacy»; той самий порядок, що в `persona-toggle`).
// Запис робиться лише тоді, коли людина сама натиснула «Save this trip», і
// видаляється, коли вона видалила останню поїздку.
const TRIPS_KEY = 'camptribe.trips';

function readTrips(): { trips: SavedTrip[]; dropped: number; blocked: boolean } {
  try {
    const parsed = parseSaved(window.localStorage.getItem(TRIPS_KEY));
    return { ...parsed, blocked: false };
  } catch {
    return { trips: [], dropped: 0, blocked: true };
  }
}

/** `true`, якщо записалось. Приватне вікно чи повне сховище кидають — і це не має ламати сторінку. */
function writeTrips(trips: SavedTrip[]): boolean {
  try {
    if (trips.length === 0) window.localStorage.removeItem(TRIPS_KEY);
    else window.localStorage.setItem(TRIPS_KEY, serializeSaved(trips));
    return true;
  } catch {
    return false;
  }
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function PlanForm() {
  const [state, dispatch] = useReducer(planReducer, undefined, initialState);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedTrip[]>([]);
  const [dropped, setDropped] = useState(0);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const summary = useRef<HTMLDivElement>(null);

  // Один раз після гідратації: що лежить у сховищі, у посиланні й в адресі.
  useEffect(() => {
    const stored = readTrips();
    setSaved(stored.trips);
    setDropped(stored.dropped);
    if (stored.blocked) {
      setMessage('This browser does not let the page keep anything, so trips cannot be saved here.');
    }

    let restored = false;
    const hash = window.location.hash;
    if (hash.length > 1) {
      const draft = decodeShare(hash);
      if (draft) {
        dispatch({ type: 'load', draft });
        restored = true;
      } else {
        setNotice('This link could not be read, so the form is empty. Ask for the link again.');
      }
    }

    const to = new URLSearchParams(window.location.search).get('to');
    let cancelled = false;
    if (to !== null && to !== '') {
      resolveCampsite(to).then((outcome) => {
        if (cancelled) return;
        if (outcome.status === 'found') {
          dispatch({ type: 'pick', field: 'to', place: outcome.place });
          setNotice(`Destination set to ${outcome.place.name}. Choose where you start and how many days.`);
        } else if (outcome.status === 'unknown') {
          setNotice('We could not find the campsite named in this link. Choose the destination below.');
        } else {
          setNotice('The campsite from this link could not be looked up right now. Choose the destination below.');
        }
      });
    } else if (restored) {
      setNotice('Trip opened from a link. Change anything you like, then press Check my trip.');
    }
    setReady(true);
    return () => {
      cancelled = true;
    };
  }, []);

  // Запит до джерела, коли є що запитувати. Відповідь на запит, якого вже
  // немає (людина виправила поле, відправила знову), відкидає редюсер —
  // за номером запиту, а не за прапорцем у цьому ефекті. Одне місце для
  // правила, а не два, що тримають одне одного: див. `planReducer`.
  const { run } = state;
  useEffect(() => {
    if (run.phase !== 'pending') return;
    planTrip(planRoute, run.request).then((legs) => {
      dispatch({ type: 'settled', id: run.id, legs });
    });
  }, [run]);

  // 🔴 Після невдалої відправки фокус іде на підсумок помилок: людина з
  // клавіатури чи екранним читачем інакше лишилась би на кнопці й
  // не дізналась би, що щось не так, поки не пройшла б усю форму.
  useEffect(() => {
    if (state.rejected > 0) summary.current?.focus();
  }, [state.rejected]);

  const jump = (field: PlanField) => document.getElementById(fieldId(field))?.focus();

  /** Зберігати й ділитись можна лише поїздку, яка пройшла перевірку: інакше в посиланні лежала б зламана форма. */
  const valid = () => {
    if (checkDraft(state.draft).ok) return true;
    dispatch({ type: 'validate' });
    setMessage('Fix the problems listed above first.');
    return false;
  };

  const save = () => {
    if (!valid()) return;
    const result = addSaved(saved, name || defaultName(state.draft), state.draft, Date.now(), newId());
    if (result.ok === false) {
      setMessage(
        result.reason === 'full'
          ? 'This browser already holds 10 saved trips. Delete one to save another.'
          : 'Give the trip a name first.',
      );
      return;
    }
    if (!writeTrips(result.trips)) {
      setMessage('This browser would not let the page keep the trip (a private window, or the storage is full).');
      return;
    }
    setSaved(result.trips);
    setName('');
    setMessage(`Saved “${result.trips[0].name}” in this browser.`);
  };

  const share = () => {
    if (!valid()) return;
    const url = `${window.location.origin}${window.location.pathname}#${encodeShare(state.draft)}`;
    setShareUrl(url);
    const copy = navigator.clipboard?.writeText(url);
    if (copy) {
      copy.then(
        () => setMessage('Link copied. Anyone who opens it sees the places you entered.'),
        () => setMessage('Select the link below and copy it. Anyone who opens it sees the places you entered.'),
      );
    } else {
      setMessage('Select the link below and copy it. Anyone who opens it sees the places you entered.');
    }
  };

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:items-start">
      {/* 🔴 Форма липка, а результат скролиться (як картка товару в темі). Висота
          липкої колонки обмежена вікном, а лишок прокручується всередині: форма
          з проміжними точками вища за екран, і без межі її низ був би
          недосяжний. */}
      <div
        data-testid="plan-sticky"
        className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto"
      >
        <PlanFormView
          draft={state.draft}
          errors={state.errors}
          ready={ready}
          summaryRef={summary}
          notice={notice}
          onEdit={(field, value) => dispatch({ type: 'edit', field, value })}
          onPick={(field, place) => dispatch({ type: 'pick', field, place })}
          onVehicleType={(value) => dispatch({ type: 'vehicle-type', value })}
          onRoundTrip={(value) => dispatch({ type: 'round-trip', value })}
          onAddVia={() => dispatch({ type: 'add-via' })}
          onRemoveVia={(id) => dispatch({ type: 'remove-via', id })}
          onMoveVia={(id, to) => dispatch({ type: 'move-via', id, to })}
          onSubmit={() => dispatch({ type: 'submit' })}
          onJump={jump}
        />
        <PlanKeepView
          ready={ready}
          name={name}
          saved={saved}
          dropped={dropped}
          message={message}
          shareUrl={shareUrl}
          onName={setName}
          onSave={save}
          onShare={share}
          onOpen={(id) => {
            const trip = saved.find((t) => t.id === id);
            if (!trip) return;
            dispatch({ type: 'load', draft: trip.draft });
            setShareUrl(null);
            setMessage(`Opened “${trip.name}”. Press Check my trip to plan it.`);
          }}
          onDelete={(id) => {
            const next = removeSaved(saved, id);
            if (writeTrips(next)) {
              setSaved(next);
              setMessage('Deleted.');
            } else {
              setMessage('This browser would not let the page change the saved trips.');
            }
          }}
        />
      </div>
      <PlanOutcomePanel run={state.run} />
    </div>
  );
}
