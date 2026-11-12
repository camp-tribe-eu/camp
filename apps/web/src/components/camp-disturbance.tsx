import type { DisturbanceView } from '@/lib/disturbance';

// CAMP-502 — «Possible disturbance». Every word comes from `view` (the CMS page
// camp-disturbance). `null` renders NOTHING. The caveat sits NEXT TO the
// numbers, in the same section, and is visible text (not sr-only).

export default function CampDisturbance({ view }: { view: DisturbanceView | null }) {
  if (!view) return null;
  return (
    <section
      data-testid="camp-disturbance"
      aria-labelledby="camp-disturbance-heading"
      className="mt-8"
    >
      <h2 id="camp-disturbance-heading" className="text-xl md:text-[25px]">
        {view.heading}
      </h2>
      <p className="mt-2 max-w-read text-sm text-ink-2">{view.intro}</p>
      <dl className="mt-3 grid max-w-read grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {view.rows.map((r) => (
          <div key={r.kind} className="contents" data-kind={r.kind}>
            <dt className="text-ink-2">{r.label}</dt>
            <dd>{r.distance}</dd>
          </div>
        ))}
      </dl>
      <p data-testid="disturbance-caveat" className="mt-3 max-w-read text-sm text-ink-2">
        <strong className="font-medium text-ink">{view.caveatHeading}. </strong>
        {view.caveat}
      </p>
    </section>
  );
}
