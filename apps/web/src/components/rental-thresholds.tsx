import { SHAPES, THRESHOLDS } from '@/data/rental/thresholds';

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
    <section
      data-testid="rental-thresholds"
      aria-labelledby="thresholds-heading"
      className="mt-12"
    >
      <h2 id="thresholds-heading" className="text-2xl font-bold text-heading">
        The four numbers on the contract that decide the trip
      </h2>
      <p className="mt-3 max-w-prose text-ink-2">
        We cannot tell you what a particular camper weighs or measures — we
        hold no vehicles and no fleet data, and we are not going to guess.
        The rental company can, and the figures are on the paperwork. What
        follows is what each of those figures costs you if you do not read
        it, and who decided the limit.
      </p>

      <ul className="mt-6 space-y-6">
        {THRESHOLDS.map((t) => (
          <li
            key={t.id}
            className="rounded-card border border-line-2 bg-surface p-5"
          >
            <h3 className="font-narrow text-2xl font-bold text-heading">
              {t.value}
            </h3>
            <p className="mt-1 max-w-prose font-semibold text-ink">{t.what}</p>
            <ul className="mt-3 max-w-prose list-disc space-y-2 pl-5 text-ink-2">
              {t.decides.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
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
    </section>
  );
}

export function RentalShapes() {
  return (
    <section
      data-testid="rental-shapes"
      aria-labelledby="shapes-heading"
      className="mt-12"
    >
      <h2 id="shapes-heading" className="text-2xl font-bold text-heading">
        The shapes you will be offered
      </h2>
      <p className="mt-3 max-w-prose text-ink-2">
        Each of these is defined by how it is built, which is the only thing
        about a camper that is true of every example of it. Dimensions and
        masses vary between builds and between model years, so they are on
        the contract rather than here — the column that matters is which of
        the four numbers above to read first.
      </p>

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {SHAPES.map((s) => (
          <li
            key={s.id}
            className="rounded-card border border-line-2 bg-surface p-5"
          >
            <h3 className="font-semibold text-heading">{s.name}</h3>
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
    </section>
  );
}
