import { SHAPES, THRESHOLDS } from '@/data/rental/thresholds';
import { Block } from '@/components/layout';

// CAMP-4 — the four numbers, and the shapes that run into them.
//
// 🔴 This is the table that replaces the one everybody else publishes.
// The conventional version lists camper models with lengths, masses and a
// price "from". We have no fleet, no partner and no prices, so every
// figure in that table would be invented — see src/data/rental/
// thresholds.ts for the full reasoning. What is knowable is the set of
// limits those figures get compared against, each of them written down by
// somebody with the authority to set it, and each of them cited here.

export function RentalThresholds() {
  return (
    <div data-testid="rental-thresholds">
      <Block as="p" measure="read" className="text-ink-2">
        What a particular camper weighs and measures is on the rental
        company&rsquo;s paperwork. These are the four figures to look for
        there, what each one costs you if you do not read it, and who set
        the limit.
      </Block>

      <ul className="mt-4 space-y-4">
        {THRESHOLDS.map((t) => (
          <li
            key={t.id}
            className="rounded-card border border-line-2 bg-surface p-5"
          >
            <h3 className="font-narrow text-2xl text-heading">
              {t.value}
            </h3>
            <Block as="p" measure="read" className="mt-1 font-semibold text-ink">{t.what}</Block>
            <Block as="ul" measure="read" className="mt-3 list-disc space-y-2 pl-5 text-ink-2">
              {t.decides.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </Block>
            <p className="mt-3 text-sm text-ink-2">
              Source:{' '}
              <a
                className="underline"
                href={t.source.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {t.source.name}
              </a>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RentalShapes() {
  return (
    <div data-testid="rental-shapes">
      <Block as="p" measure="read" className="text-ink-2">
        Each of these is defined by how it is built, which is the only thing
        about a camper that is true of every example of it. Dimensions and
        masses vary between builds and model years, so they are on the
        contract. The line to read is which of the four figures above to
        check first.
      </Block>

      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {SHAPES.map((s) => (
          <li
            key={s.id}
            className="rounded-card border border-line-2 bg-surface p-5"
          >
            <h3 className="text-heading">{s.name}</h3>
            <p className="mt-2 text-ink-2">{s.defined}</p>
            <p className="mt-2 text-ink-2">
              <span className="font-semibold text-ink">
                Read first: {THRESHOLDS.find((t) => t.id === s.checkFirst)?.value}
              </span>{' '}
              — {s.why}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
