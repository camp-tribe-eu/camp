'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  budget,
  euros,
  FUEL,
  longDate,
  priceFor,
  ranked,
  VEHICLES,
  vehicle,
  type FuelType,
} from '@/lib/fuel';

// CAMP-55 — the camper trip cost calculator.
//
// 🔴 The layout carries the argument, so it is not free to rearrange.
//
// The result is split into two boxes that never merge: what we measured
// (the price of a litre, with the week and the source) and what the
// reader told us (consumption, nights, what a pitch costs). Every other
// calculator on this subject presents one confident number built mostly
// out of guesses. Ours shows the same total and says which half of it we
// are standing behind.
//
// 🔴 It degrades to something useful without JavaScript. The server
// renders the country table — this week's real prices for all 27 member
// states — and the form enhances it. A tool that is a blank box until a
// bundle loads is a blank box for every crawler and every reader on a
// slow train, which is most of our readers by definition.

export interface CalculatorProps {
  /** Preselected country, for the per-country pages. */
  country?: string;
}

interface State {
  country: string;
  fuel: FuetTypeSafe;
  litresPer100: string;
  km: string;
  nights: string;
  people: string;
  pitch: string;
  extras: string;
  vehicleId: string;
}

// Local alias so a typo in the union cannot silently widen to string.
type FuetTypeSafe = FuelType;

const DEFAULTS: State = {
  country: 'DE',
  fuel: 'diesel',
  litresPer100: String(VEHICLES[1].start),
  km: '1500',
  nights: '7',
  people: '2',
  pitch: '',
  extras: '',
  vehicleId: VEHICLES[1].id,
};

/** Query-string keys, kept short because these links get pasted around. */
const KEYS: Record<keyof State, string> = {
  country: 'c',
  fuel: 'f',
  litresPer100: 'l',
  km: 'km',
  nights: 'n',
  people: 'p',
  pitch: 'pitch',
  extras: 'x',
  vehicleId: 'v',
};

/**
 * 🔴 Read from the URL, not from storage.
 *
 * The card's acceptance criterion is that a result can be shared with a
 * link. localStorage would make the tool feel stateful for one person
 * and be invisible to everyone they send it to.
 */
function fromSearch(search: string, base: State): State {
  const q = new URLSearchParams(search);
  const next = { ...base };
  for (const [field, key] of Object.entries(KEYS) as [keyof State, string][]) {
    const v = q.get(key);
    if (v === null || v === '') continue;
    if (field === 'fuel') {
      if (v === 'petrol' || v === 'diesel') next.fuel = v;
      continue;
    }
    if (field === 'country') {
      const code = v.toUpperCase();
      if (FUEL.countries[code]) next.country = code;
      continue;
    }
    next[field] = v as never;
  }
  return next;
}

function toSearch(s: State): string {
  const q = new URLSearchParams();
  for (const [field, key] of Object.entries(KEYS) as [keyof State, string][]) {
    const v = s[field];
    if (v !== '' && v !== DEFAULTS[field]) q.set(key, String(v));
  }
  const str = q.toString();
  return str ? `?${str}` : '';
}

const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export default function TripCostCalculator({ country }: CalculatorProps) {
  const initial = useMemo<State>(
    () => ({ ...DEFAULTS, ...(country ? { country: country.toUpperCase() } : {}) }),
    [country],
  );
  const [s, setS] = useState<State>(initial);
  const [copied, setCopied] = useState(false);

  // 🔴 In an effect rather than useSearchParams. This site is a static
  // export; useSearchParams forces the page into a client bailout and
  // needs a Suspense boundary around it, which buys nothing here — there
  // is no server render of these values to hydrate against, because the
  // server does not know the query string either.
  useEffect(() => {
    setS((prev) => fromSearch(window.location.search, prev));
  }, []);

  const set = <K extends keyof State>(key: K, value: State[K]) => {
    setCopied(false);
    setS((prev) => ({ ...prev, [key]: value }));
  };

  const price = priceFor(s.country, s.fuel);
  const shape = vehicle(s.vehicleId);

  const result = budget({
    km: num(s.km),
    litresPer100: num(s.litresPer100),
    pricePerLitre: price ?? 0,
    nights: num(s.nights),
    campsitePerNight: num(s.pitch),
    people: num(s.people),
    extras: num(s.extras),
  });

  const list = ranked(s.fuel);
  const countryName = FUEL.countries[s.country]?.name ?? s.country;
  const pitchGiven = num(s.pitch) > 0;

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}${toSearch(s)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard is permissioned and can simply say no. Put the link in
      // the address bar instead of claiming a copy that did not happen.
      window.history.replaceState(null, '', toSearch(s) || window.location.pathname);
      setCopied(false);
    }
  };

  const field =
    'mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue focus:outline-none';
  const label = 'block text-sm font-medium text-ink-2';

  return (
    <div data-testid="trip-cost" className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px]">
      <form
        className="rounded-card border border-line-2 bg-surface-2 p-5"
        onSubmit={(e) => e.preventDefault()}
      >
        <h2 className="text-lg font-semibold text-heading">Your trip</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="tc-country">
              Country you are driving in
            </label>
            <select
              id="tc-country"
              className={field}
              value={s.country}
              onChange={(e) => set('country', e.target.value)}
            >
              {list.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label} htmlFor="tc-fuel">
              Fuel
            </label>
            <select
              id="tc-fuel"
              className={field}
              value={s.fuel}
              onChange={(e) => set('fuel', e.target.value as FuelType)}
            >
              <option value="diesel">Diesel</option>
              <option value="petrol">Petrol (Euro-super 95)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className={label} htmlFor="tc-vehicle">
              Vehicle
            </label>
            <select
              id="tc-vehicle"
              className={field}
              value={s.vehicleId}
              onChange={(e) => {
                const v = vehicle(e.target.value);
                setCopied(false);
                setS((prev) => ({
                  ...prev,
                  vehicleId: v.id,
                  litresPer100: String(v.start),
                }));
              }}
            >
              {VEHICLES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-ink-3">{shape.note}</p>
          </div>

          <div>
            <label className={label} htmlFor="tc-consumption">
              Consumption, litres per 100 km
            </label>
            <input
              id="tc-consumption"
              className={field}
              inputMode="decimal"
              value={s.litresPer100}
              onChange={(e) => set('litresPer100', e.target.value)}
            />
            <p className="mt-1 text-sm text-ink-3">
              Typically {shape.min}–{shape.max}. This is your number, not ours —
              change it to what your vehicle actually does.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="tc-km">
              Distance, km
            </label>
            <input
              id="tc-km"
              className={field}
              inputMode="numeric"
              value={s.km}
              onChange={(e) => set('km', e.target.value)}
            />
          </div>

          <div>
            <label className={label} htmlFor="tc-nights">
              Nights
            </label>
            <input
              id="tc-nights"
              className={field}
              inputMode="numeric"
              value={s.nights}
              onChange={(e) => set('nights', e.target.value)}
            />
          </div>

          <div>
            <label className={label} htmlFor="tc-people">
              People
            </label>
            <input
              id="tc-people"
              className={field}
              inputMode="numeric"
              value={s.people}
              onChange={(e) => set('people', e.target.value)}
            />
          </div>

          <div>
            <label className={label} htmlFor="tc-pitch">
              Pitch per night, €
            </label>
            <input
              id="tc-pitch"
              className={field}
              inputMode="decimal"
              placeholder="what you expect to pay"
              value={s.pitch}
              onChange={(e) => set('pitch', e.target.value)}
            />
            {/* 🔴 The most important sentence in this form. */}
            <p className="mt-1 text-sm text-ink-3">
              We hold no campsite prices, so we cannot fill this in. Leave it
              empty and the total is fuel only.
            </p>
          </div>

          <div>
            <label className={label} htmlFor="tc-extras">
              Anything else for the whole trip, €
            </label>
            <input
              id="tc-extras"
              className={field}
              inputMode="decimal"
              placeholder="tolls, ferries, food"
              value={s.extras}
              onChange={(e) => set('extras', e.target.value)}
            />
          </div>
        </div>
      </form>

      <aside className="rounded-card border border-line-2 bg-surface p-5">
        <h2 className="text-lg font-semibold text-heading">What that costs</h2>

        <section
          data-testid="measured"
          className="mt-4 rounded border border-line-blue bg-accent-surface p-4"
        >
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
            Measured
          </h3>
          {price === null ? (
            <p className="mt-2 text-ink-2">
              The bulletin reports no {s.fuel} price for {countryName} this week,
              so we are not going to estimate one.
            </p>
          ) : (
            <>
              <p className="mt-2 text-ink">
                {s.fuel === 'diesel' ? 'Diesel' : 'Petrol'} in {countryName}:{' '}
                <strong>{euros(price, 3)}</strong> a litre.
              </p>
              <p className="mt-2 text-2xl font-bold text-heading">
                {euros(result.fuel)}
              </p>
              <p className="text-sm text-ink-2">
                {result.litres.toLocaleString('en-GB')} litres for{' '}
                {num(s.km).toLocaleString('en-GB')} km
              </p>
            </>
          )}
          <p className="mt-3 text-xs text-ink-3">
            Prices for the week of {longDate(FUEL.bulletinDate)}.
          </p>
        </section>

        <section
          data-testid="assumed"
          className="mt-4 rounded border border-line-2 bg-surface-2 p-4"
        >
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-2">
            Your numbers
          </h3>
          {pitchGiven ? (
            <p className="mt-2 text-ink">
              Pitches: <strong>{euros(result.campsites)}</strong>{' '}
              <span className="text-ink-2">
                ({num(s.nights)} × {euros(num(s.pitch))})
              </span>
            </p>
          ) : (
            <p className="mt-2 text-ink-2">
              No pitch price entered, so nothing for campsites is counted.
            </p>
          )}
          {result.extras > 0 && (
            <p className="mt-1 text-ink">
              Other: <strong>{euros(result.extras)}</strong>
            </p>
          )}
        </section>

        <dl className="mt-4 space-y-1 border-t border-line-2 pt-4">
          <div className="flex justify-between">
            <dt className="font-semibold text-heading">Total</dt>
            <dd data-testid="total" className="font-bold text-heading">
              {euros(result.total)}
            </dd>
          </div>
          <div className="flex justify-between text-sm text-ink-2">
            <dt>Per person</dt>
            <dd>{euros(result.perPerson)}</dd>
          </div>
          <div className="flex justify-between text-sm text-ink-2">
            <dt>Per night</dt>
            <dd>{euros(result.perNight)}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={share}
          className="mt-4 w-full rounded bg-btn px-4 py-2 font-medium text-btn-ink hover:bg-btn-hover"
        >
          {copied ? 'Link copied' : 'Copy a link to this'}
        </button>
      </aside>
    </div>
  );
}
