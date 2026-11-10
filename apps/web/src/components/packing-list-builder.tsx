'use client';

import { useEffect, useState } from 'react';
import Checkbox from '@/components/checkbox';
import { buttonClasses } from '@/components/button';
import {
  asText,
  countItems,
  packingList,
  SEASONS,
  VEHICLE_KINDS,
  type PackingInput,
  type Season,
  type VehicleKind,
  OWN_MAX_ITEMS,
  OWN_MAX_LEN,
  cleanOwnItems,
  withOwnItems,
} from '@/lib/packing';

// CAMP-55 — the packing list, built from a handful of answers.
//
// 🔴 Checked boxes live in the URL, not in storage. The card asks for a
// result that can be shared with a link, and a list whose ticks only
// exist in one browser is a list you cannot hand to the person doing the
// actual packing.

const KEYS = {
  vehicle: 'v',
  nights: 'n',
  people: 'p',
  season: 's',
  cooking: 'cook',
  electricity: 'ehu',
  children: 'kids',
  dog: 'dog',
  done: 'done',
  own: 'own',
} as const;

const DEFAULTS: PackingInput = {
  vehicle: 'motorhome',
  nights: 7,
  people: 2,
  season: 'warm',
  cooking: true,
  electricity: true,
  children: false,
  dog: false,
};

function fromSearch(search: string): {
  input: PackingInput;
  done: Set<string>;
  own: string[];
} {
  const q = new URLSearchParams(search);
  const input = { ...DEFAULTS };
  const v = q.get(KEYS.vehicle);
  if (VEHICLE_KINDS.some((k) => k.id === v)) input.vehicle = v as VehicleKind;
  const s = q.get(KEYS.season);
  if (SEASONS.some((k) => k.id === s)) input.season = s as Season;
  const n = Number(q.get(KEYS.nights));
  if (Number.isFinite(n) && n > 0) input.nights = n;
  const p = Number(q.get(KEYS.people));
  if (Number.isFinite(p) && p > 0) input.people = p;
  for (const flag of ['cooking', 'electricity', 'children', 'dog'] as const) {
    const raw = q.get(KEYS[flag]);
    if (raw !== null) input[flag] = raw === '1';
  }
  // 🔴 Роздільник — переведення рядка, а не кома: кома в пункті
  // («socks, thick») розрізала б його надвоє. `URLSearchParams` кодує
  // перенос сам, тож адреса лишається коректною.
  const own = cleanOwnItems((q.get(KEYS.own) ?? '').split('\n'));
  return {
    input,
    done: new Set((q.get(KEYS.done) ?? '').split(',').filter(Boolean)),
    own,
  };
}

function toSearch(
  input: PackingInput,
  done: Set<string>,
  own: readonly string[],
): string {
  const q = new URLSearchParams();
  q.set(KEYS.vehicle, input.vehicle);
  q.set(KEYS.season, input.season);
  q.set(KEYS.nights, String(input.nights));
  q.set(KEYS.people, String(input.people));
  for (const flag of ['cooking', 'electricity', 'children', 'dog'] as const) {
    q.set(KEYS[flag], input[flag] ? '1' : '0');
  }
  if (done.size > 0) q.set(KEYS.done, [...done].join(','));
  const ownClean = cleanOwnItems(own);
  if (ownClean.length > 0) q.set(KEYS.own, ownClean.join('\n'));
  return `?${q.toString()}`;
}

/**
 * 🔴 Nights and people are held as the RAW STRING the reader typed.
 *
 * The first version stored `Number(e.target.value)` while rendering
 * `String(input.nights)`. One stray character on a field that accepts
 * letters made the state NaN, the input then rendered the literal text
 * "NaN", and every later keystroke appended to it — the field could not
 * be recovered without select-all or a reload, and the shared link
 * carried `n=NaN`. Found by review.
 *
 * The rule the trip-cost calculator already followed: keep the text,
 * coerce when computing.
 */
interface Draft {
  nights: string;
  people: string;
}

const clampNum = (s: string, fallback: number) => {
  const n = Number(s.replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export default function PackingListBuilder() {
  const [input, setInput] = useState<PackingInput>(DEFAULTS);
  const [draft, setDraft] = useState<Draft>({
    nights: String(DEFAULTS.nights),
    people: String(DEFAULTS.people),
  });
  const [done, setDone] = useState<Set<string>>(new Set());
  /**
   * 🔴 Пункти, які людина дописала сама. Живуть ТІЛЬКИ тут і в
   * посиланні — у нашу базу не їдуть ніколи (вимога власника: «люди
   * понаписують гадості — тому їх не беремо собі нотатки»). У цьому
   * компоненті немає жодного `fetch`, і сторож
   * `tests/unit/packing-own-items.spec.ts` це тримає.
   */
  const [own, setOwn] = useState<string[]>([]);
  const [ownDraft, setOwnDraft] = useState('');
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);
  // 🔴 The controls are inert until React has attached, so they say so.
  //
  // This page is prerendered: the form is in the served HTML and looks
  // usable before any JavaScript runs. A reader who changes the vehicle
  // in that window has their choice silently discarded — React then
  // rewrites every controlled value from its own state. It surfaced as a
  // flaky test on WebKit, which is the honest way an intermittent real
  // fault appears, and the retry that went green is exactly what would
  // have hidden it.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const parsed = fromSearch(window.location.search);
    setReady(true);
    setInput(parsed.input);
    setDraft({
      nights: String(parsed.input.nights),
      people: String(parsed.input.people),
    });
    setDone(parsed.done);
    setOwn(parsed.own);
  }, []);

  const groups = withOwnItems(packingList(input), own);
  const total = countItems(groups);
  const packed = groups
    .flatMap((g) => g.items)
    .filter((i) => done.has(i.id)).length;

  const set = <K extends keyof PackingInput>(key: K, value: PackingInput[K]) => {
    setCopied(null);
    setInput((prev) => ({ ...prev, [key]: value }));
  };

  const toggle = (id: string) => {
    setCopied(null);
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copy = async (what: 'link' | 'text') => {
    const value =
      what === 'link'
        ? `${window.location.origin}${window.location.pathname}${toSearch(input, done, own)}`
        : asText(groups);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      if (what === 'link') {
        window.history.replaceState(null, '', toSearch(input, done, own));
      }
      setCopied(null);
    }
  };

  const addOwn = () => {
    const next = cleanOwnItems([...own, ownDraft]);
    // 🔴 Нічого не змінилось — значить, пункт порожній, повторний або
    // межу вже вибрано. Мовчки чистити поле в такому разі означало б
    // «зникло, і незрозуміло чому», тож текст лишається на місці.
    if (next.length === own.length) return;
    setOwn(next);
    setOwnDraft('');
    setCopied(null);
  };

  const removeOwn = (label: string) => {
    setOwn((prev) => prev.filter((l) => l !== label));
    setCopied(null);
  };

  const field =
    'mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue focus:outline-hidden';
  const label = 'block text-sm font-medium text-ink-2';

  return (
    <div data-testid="packing" className="mt-8">
      <form
        className="rounded-card border border-line-2 bg-surface-2 p-5"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={label} htmlFor="pk-vehicle">
              Travelling in
            </label>
            <select
              id="pk-vehicle"
              disabled={!ready}
              className={field}
              value={input.vehicle}
              onChange={(e) => set('vehicle', e.target.value as VehicleKind)}
            >
              {VEHICLE_KINDS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="pk-season">
              Time of year
            </label>
            <select
              id="pk-season"
              disabled={!ready}
              className={field}
              value={input.season}
              onChange={(e) => set('season', e.target.value as Season)}
            >
              {SEASONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label} htmlFor="pk-nights">
              Nights
            </label>
            <input
              id="pk-nights"
              disabled={!ready}
              className={field}
              inputMode="numeric"
              value={draft.nights}
              onChange={(e) => {
                setDraft((d) => ({ ...d, nights: e.target.value }));
                set('nights', clampNum(e.target.value, DEFAULTS.nights));
              }}
            />
          </div>
          <div>
            <label className={label} htmlFor="pk-people">
              People
            </label>
            <input
              id="pk-people"
              disabled={!ready}
              className={field}
              inputMode="numeric"
              value={draft.people}
              onChange={(e) => {
                setDraft((d) => ({ ...d, people: e.target.value }));
                set('people', clampNum(e.target.value, DEFAULTS.people));
              }}
            />
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-ink-2">Also</legend>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ['cooking', 'Cooking at the pitch'],
                ['electricity', 'Pitch has electricity'],
                ['children', 'Travelling with children'],
                ['dog', 'Travelling with a dog'],
              ] as const
            ).map(([key, text]) => (
              <Checkbox
                key={key}
                checked={input[key]}
                disabled={!ready}
                onChange={(next) => set(key, next)}
                weight="plain"
              >
                {text}
              </Checkbox>
            ))}
          </div>
        </fieldset>

        {!ready && (
          <p data-testid="packing-loading" className="mt-4 text-sm text-ink-2">
            The list below is the usual one for a week in a motorhome. The
            controls come alive as soon as the page finishes loading.
          </p>
        )}
      </form>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <p data-testid="packing-count" className="text-ink-2">
          {packed} of {total} packed
        </p>
        <button
          type="button"
          onClick={() => copy('link')}
          className="rounded bg-btn px-4 py-2 text-sm font-medium text-btn-ink hover:bg-btn-hover"
        >
          {copied === 'link' ? 'Link copied' : 'Copy a link to this list'}
        </button>
        <button
          type="button"
          onClick={() => copy('text')}
          className="rounded border border-line-2 px-4 py-2 text-sm font-medium text-ink hover:border-line-blue"
        >
          {copied === 'text' ? 'List copied' : 'Copy as text'}
        </button>
      </div>

      {/* 🔴 CAMP-458: свої пункти. Власник: «дати людині додавати СВОЇ
          пункти, копіювати і ділитися списком», і одразу межа — «люди
          понаписують гадості — тому їх не беремо собі нотатки».
          Тому поле нижче не має ані форми, ані запиту: доданий текст
          лишається в стані сторінки й у посиланні, яким ділиться сама
          людина. */}
      <div className="mt-6 rounded-card border border-line-2 bg-surface p-5">
        <h2 className="text-lg text-heading">Add your own</h2>
        <p className="mt-1 text-sm text-ink-2">
          Yours stay in this page and in the link you copy. They are not sent
          to us and we do not keep them.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            id="pl-own"
            type="text"
            value={ownDraft}
            maxLength={OWN_MAX_LEN}
            disabled={!ready || own.length >= OWN_MAX_ITEMS}
            placeholder="Head torch"
            aria-label="Add your own item"
            data-testid="own-input"
            className={`${field} mt-0 max-w-xs flex-1`}
            onChange={(e) => setOwnDraft(e.target.value)}
            onKeyDown={(e) => {
              // 🔴 Enter додає пункт, а НЕ надсилає форму: форми тут
              // немає саме тому, що надсилати нема куди й нікому.
              if (e.key === 'Enter') {
                e.preventDefault();
                addOwn();
              }
            }}
          />
          <button
            type="button"
            data-testid="own-add"
            disabled={!ready || own.length >= OWN_MAX_ITEMS}
            className={buttonClasses('secondary', 'md')}
            onClick={addOwn}
          >
            Add
          </button>
          <span className="text-sm text-ink-2" data-testid="own-count">
            {own.length} of {OWN_MAX_ITEMS}
          </span>
        </div>
        {own.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" data-testid="own-list">
            {own.map((label) => (
              <li
                key={label}
                className="flex items-center gap-2 rounded-sm border border-line-2 px-2 py-1 text-sm"
              >
                <span>{label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  className="text-ink-2 underline"
                  onClick={() => removeOwn(label)}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 🔴 КОЛОНКИ, А НЕ СІТКА (CAMP-458). Власник: «розкласти
          колонками». Сітка з двох стовпців вирівнює ряди по найвищій
          групі, тож поруч із «Кухня» на 14 пунктів «Документи» на три
          лишали півекрана порожнім — саме те «багато повітря», яке він
          називає окремо. CSS-колонки пакують групи щільно, а
          `break-inside-avoid` не дає розірвати групу між колонками.

          Три колонки лише з 1280 px: на 1024 третя робить рядок
          спорядження завузьким, і назва на кшталт «Carbon monoxide
          alarm» ламається на три рядки. */}
      <div className="mt-6 gap-6 md:columns-2 xl:columns-3">
        {groups.map((group) => (
          <section
            key={group.id}
            data-group={group.id}
            className="mb-6 break-inside-avoid rounded-card border border-line-2 bg-surface p-5"
          >
            <h2 className="text-lg text-heading">{group.title}</h2>
            <ul className="mt-3 space-y-2">
              {group.items.map((item) => (
                <li key={item.id}>
                  {/* 🔴 ТОЙ САМИЙ КОНТРОЛ, ЩО Й УСЮДИ (CAMP-459). Тут
                      лишався голий `<input type="checkbox">` — єдиний на
                      сторінці, де решта галочок уже наші. Саме це
                      власник і назвав «стилі не ті». */}
                  <Checkbox
                    align="start"
                    weight="plain"
                    disabled={!ready}
                    checked={done.has(item.id)}
                    onChange={() => toggle(item.id)}
                  >
                    <span
                      className={done.has(item.id) ? 'text-ink-2 line-through' : 'text-ink'}
                    >
                      {item.label}
                    </span>
                    {item.qty && (
                      <span className="text-ink-2"> — {item.qty}</span>
                    )}
                    {item.note && (
                      <span className="block text-sm text-ink-2">{item.note}</span>
                    )}
                  </Checkbox>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
