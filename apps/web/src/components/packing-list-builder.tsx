'use client';

import { useEffect, useState } from 'react';
import {
  asText,
  countItems,
  packingList,
  SEASONS,
  VEHICLE_KINDS,
  type PackingInput,
  type Season,
  type VehicleKind,
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

function fromSearch(search: string): { input: PackingInput; done: Set<string> } {
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
  return { input, done: new Set((q.get(KEYS.done) ?? '').split(',').filter(Boolean)) };
}

function toSearch(input: PackingInput, done: Set<string>): string {
  const q = new URLSearchParams();
  q.set(KEYS.vehicle, input.vehicle);
  q.set(KEYS.season, input.season);
  q.set(KEYS.nights, String(input.nights));
  q.set(KEYS.people, String(input.people));
  for (const flag of ['cooking', 'electricity', 'children', 'dog'] as const) {
    q.set(KEYS[flag], input[flag] ? '1' : '0');
  }
  if (done.size > 0) q.set(KEYS.done, [...done].join(','));
  return `?${q.toString()}`;
}

export default function PackingListBuilder() {
  const [input, setInput] = useState<PackingInput>(DEFAULTS);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<'link' | 'text' | null>(null);

  useEffect(() => {
    const parsed = fromSearch(window.location.search);
    setInput(parsed.input);
    setDone(parsed.done);
  }, []);

  const groups = packingList(input);
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
        ? `${window.location.origin}${window.location.pathname}${toSearch(input, done)}`
        : asText(groups);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      if (what === 'link') {
        window.history.replaceState(null, '', toSearch(input, done));
      }
      setCopied(null);
    }
  };

  const field =
    'mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue focus:outline-none';
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
              className={field}
              inputMode="numeric"
              value={String(input.nights)}
              onChange={(e) => set('nights', Number(e.target.value))}
            />
          </div>
          <div>
            <label className={label} htmlFor="pk-people">
              People
            </label>
            <input
              id="pk-people"
              className={field}
              inputMode="numeric"
              value={String(input.people)}
              onChange={(e) => set('people', Number(e.target.value))}
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
              <label key={key} className="flex items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={input[key]}
                  onChange={(e) => set(key, e.target.checked)}
                />
                {text}
              </label>
            ))}
          </div>
        </fieldset>
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

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        {groups.map((group) => (
          <section
            key={group.id}
            data-group={group.id}
            className="rounded-card border border-line-2 bg-surface p-5"
          >
            <h2 className="text-lg font-semibold text-heading">{group.title}</h2>
            <ul className="mt-3 space-y-2">
              {group.items.map((item) => (
                <li key={item.id}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={done.has(item.id)}
                      onChange={() => toggle(item.id)}
                    />
                    <span>
                      <span
                        className={done.has(item.id) ? 'text-ink-3 line-through' : 'text-ink'}
                      >
                        {item.label}
                      </span>
                      {item.qty && (
                        <span className="text-ink-2"> — {item.qty}</span>
                      )}
                      {item.note && (
                        <span className="block text-sm text-ink-3">{item.note}</span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
