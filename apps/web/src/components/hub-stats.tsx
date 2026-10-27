import type { HubFaqItem, HubTile } from '@/lib/hub-stats';

// The stat tiles and the FAQ of the hub pages. What is printed is decided
// in lib/hub-stats.ts; this only lays it out. Both render NOTHING when
// handed nothing — no empty grid, no heading over no questions — so a
// region whose counts failed to arrive looks like today's page, not like
// a broken one.

export function HubStatTiles({
  tiles,
  asOf,
}: {
  tiles: readonly HubTile[];
  /** The "Counted from our listings as of …" line, or null without a day. */
  asOf: string | null;
}) {
  if (tiles.length === 0) return null;
  // As many columns as tiles, never an empty cell: the mock-up's four
  // are three on most pages today (lib/hub-stats.ts), and a fourth cell
  // with nothing in it reads as a figure that failed to load.
  const cols =
    tiles.length >= 4
      ? 'md:grid-cols-4'
      : tiles.length === 3
        ? 'md:grid-cols-3'
        : tiles.length === 2
          ? 'md:grid-cols-2'
          : 'md:grid-cols-1';
  return (
    <section aria-label="Key figures" className="mt-6">
      <dl
        className={`grid grid-cols-2 gap-px overflow-hidden rounded border border-line-2 bg-line-2 ${cols}`}
      >
        {tiles.map((t) => (
          <div
            key={t.key}
            // On two columns an odd last tile takes the whole row, for
            // the same reason: no empty cell.
            className="grid gap-0.5 bg-surface px-4 py-3.5 odd:last:col-span-2 md:odd:last:col-span-1"
          >
            <dt className="text-xs text-ink-2">{t.label}</dt>
            <dd>
              <strong className="text-xl font-bold tabular-nums text-heading">
                {t.value}
              </strong>
              {/* A block, not a span: the note is its own line for a reader
                  and its own token for a test that reads the HTML. */}
              {t.note && <p className="mt-0.5 text-xs text-ink-2">{t.note}</p>}
            </dd>
          </div>
        ))}
      </dl>
      {asOf && <p className="mt-2 text-xs text-ink-2">{asOf}</p>}
    </section>
  );
}

export function HubFaq({
  items,
  region,
}: {
  items: readonly HubFaqItem[];
  region: string;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="hub-faq-heading" className="mt-10 max-w-prose">
      <h2 id="hub-faq-heading" className="text-xl font-bold md:text-[25px]">
        Questions about camping in {region}
      </h2>
      <div className="mt-3 grid gap-2">
        {items.map((f) => (
          <details
            key={f.key}
            className="rounded border border-line-2 bg-surface-2 px-3.5 py-3"
          >
            <summary className="cursor-pointer font-semibold text-heading">
              {f.question}
            </summary>
            <p className="mt-2 text-sm text-ink-2">{f.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
