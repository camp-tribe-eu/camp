import type { AroundRow, SpotFact } from '@/lib/spot-facts';
import { SCALE_MAX_M } from '@/lib/spot-facts';
import { TrustMark } from '@/components/trust';

/**
 * The one line under a campsite's heading: what is recorded about THIS
 * campsite, and nothing about the ones that are not. `lib/spot-facts.ts`
 * says which facts exist and why; this only draws the list it is given.
 *
 * An empty list is no element — not an empty box with a border. On a phone
 * the cells are two to a row, and an odd last one takes the whole row
 * (`max-md:odd:last:col-span-2`) so the line never ends in a grey hole.
 *
 * Not a `<dl>`: the rows of "What's around it" and "Getting there" are
 * `<dt>`/`<dd>` and a reader (and a test) that looks for "the" `<dt>`
 * labelled "Nearest …" must find the one in the section it belongs to.
 */
/** "293 m" must not break between the number and its unit. */
export const glueUnit = (v: string): string => v.replace(/ (m|km)$/, '\u00A0$1');

export function SpotFactsLine({ facts }: { facts: readonly SpotFact[] }) {
  if (facts.length === 0) return null;
  return (
    <ul
      data-testid="spot-facts"
      aria-label="Key facts"
      className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-2 bg-line-2"
    >
      {facts.map((f) => (
        <li
          key={f.key}
          data-fact={f.key}
          className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3 max-md:odd:last:col-span-2"
        >
          {/* `div`, not `span`/`b`: two inline elements read as one word
              ("TypeCampsite") to anything that is not looking at the
              layout — copy and paste, a reader's text mode, a crawler. */}
          <div className="text-xs text-ink-2">{f.label}</div>
          <div className="break-words text-base font-bold tabular-nums text-heading">
            {glueUnit(f.value)}
          </div>
          {/* CAMP-521: where this value came from, in the cell that holds it. */}
          <div className="text-xs text-ink-2">
            <TrustMark status={f.trust} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * A distance drawn to a fixed scale: a track, a fill that is
 * `distance / end` of it, and three marks under it (0, the middle, the
 * end — each with its unit).
 *
 * The track is the theme's progress bar (Fuse `product-inventory-status`:
 * 12 px high, 8 px radius, diagonal 14 px stripes on the fill) so it is
 * read as the same control as everywhere else on the site.
 *
 * `role="meter"` rather than a bare `<div>`: it IS a measurement within
 * a known range, and `aria-valuemax` says which range, so the bar is
 * not only a picture. The value is clamped at the end of the scale; the
 * figure beside it is not.
 */
export function ScaleTrack({ row }: { row: AroundRow }) {
  if (!row.scale) return null;
  const key = row.key as keyof typeof SCALE_MAX_M;
  const max = SCALE_MAX_M[key];
  const ticks = row.scale.ticks;
  return (
    <div data-scale={row.key}>
      <div
        role="meter"
        aria-label={`${row.label}: distance`}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round((row.scale.fill / 100) * max)}
        aria-valuetext={row.value}
        className="relative h-3 overflow-hidden rounded-lg bg-surface-2 p-0.5 ring-1 ring-inset ring-line-2"
      >
        <span
          data-fill
          className="block h-full rounded-[6px] bg-heading bg-[linear-gradient(-45deg,rgb(255_255_255/0.15)_25%,transparent_25%,transparent_50%,rgb(255_255_255/0.15)_50%,rgb(255_255_255/0.15)_75%,transparent_75%)] bg-[length:14px_14px]"
          style={{ width: `${row.scale.fill}%` }}
        />
      </div>
      <div data-ticks className="relative mt-1 h-4 text-xs tabular-nums text-ink-2">
        {ticks.map((t) => (
          <div
            key={t.at}
            data-tick={t.at}
            className={
              t.at === 0
                ? 'absolute left-0'
                : t.at === 100
                  ? 'absolute right-0'
                  : 'absolute -translate-x-1/2'
            }
            style={t.at > 0 && t.at < 100 ? { left: `${t.at}%` } : undefined}
          >
            {t.label}
          </div>
        ))}
      </div>
    </div>
  );
}
