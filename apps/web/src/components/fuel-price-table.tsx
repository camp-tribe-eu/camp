import { euros, FUEL, longDate, ranked } from '@/lib/fuel';

// CAMP-55 — this week's road-fuel prices, all 27 member states.
//
// 🔴 Rendered on the server, on purpose. It is the part of the page that
// is worth indexing and the part that still works with the calculator's
// JavaScript switched off or still loading: twenty-seven real prices with
// a date on them. The calculator above it is the enhancement.

export default function FuelPriceTable({
  highlight,
}: {
  /** ISO code to mark as "you are here", on the per-country pages. */
  highlight?: string;
}) {
  const diesel = ranked('diesel');
  const petrol = new Map(ranked('petrol').map((c) => [c.code, c.price]));
  const here = highlight?.toUpperCase();

  return (
    <section className="mt-12" aria-labelledby="prices-heading">
      <h2 id="prices-heading" className="text-2xl font-bold text-heading">
        What a litre costs across the EU
      </h2>
      <p className="mt-2 max-w-prose text-ink-2">
        Consumer prices including taxes, for the week of{' '}
        {longDate(FUEL.bulletinDate)}, cheapest diesel first. Crossing one
        border can move the fuel line of a long trip by a third, which is why
        this table is here rather than a single European average.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <caption className="sr-only">
            Diesel and petrol prices per litre in the 27 EU member states
          </caption>
          <thead>
            <tr className="border-b border-line-2 text-left text-ink-2">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Country
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Diesel
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Petrol
              </th>
            </tr>
          </thead>
          <tbody>
            {diesel.map((c) => {
              const p = petrol.get(c.code);
              return (
                <tr
                  key={c.code}
                  data-country={c.code}
                  className={`border-b border-line ${
                    c.code === here ? 'bg-accent-surface font-semibold' : ''
                  }`}
                >
                  <th scope="row" className="py-2 pr-3 text-left font-normal">
                    {c.name}
                  </th>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {euros(c.price, 3)}
                  </td>
                  {/* A country with no petrol figure gets an em dash, not a
                      copy of its diesel price. */}
                  <td className="py-2 text-right tabular-nums">
                    {p === undefined ? '—' : euros(p, 3)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-sm text-ink-3">
        Source: {FUEL.attribution}.{' '}
        <a className="underline" href={FUEL.source}>
          Weekly Oil Bulletin
        </a>
        , published every Thursday.
      </p>
    </section>
  );
}
