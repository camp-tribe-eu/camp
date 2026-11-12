import type { ServicesView } from '@/lib/camp-services';

// CAMP-503/506 — services grouped by need (before you arrive / at the campsite /
// if something goes wrong): the nearest point of each kind, on site and nearby,
// with the distance and the day OpenStreetMap was imported.
//
// 🔴 EVERY WORD COMES FROM `view`, which is built from the CMS page
// (lib/camp-services.ts). Nothing readable is typed here.
// 🔴 `null` renders NOTHING: no point in range, no CMS page, a missing slot.

export default function CampServices({ view }: { view: ServicesView | null }) {
  if (!view) return null;
  return (
    <section
      data-testid="camp-services"
      aria-labelledby="camp-services-heading"
      className="mt-8"
    >
      <h2 id="camp-services-heading" className="text-xl md:text-[25px]">
        {view.heading}
      </h2>
      <p className="mt-2 max-w-read text-sm text-ink-2">{view.intro}</p>
      {view.groups.map((g) => (
        <div key={g.group} data-group={g.group} className="mt-5">
          <h3 className="text-lg">{g.heading}</h3>
          <ul className="mt-2 grid gap-4 sm:grid-cols-2">
            {g.rows.map((row) => (
              <li key={row.kind} data-kind={row.kind} className="border-t border-line pt-3">
                <h4 className="text-base">{row.heading}</h4>
                {row.note ? <p className="mt-1 text-sm text-ink-2">{row.note}</p> : null}
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {row.lines.map((l) => (
                    <div key={l.where} className="contents" data-where={l.where}>
                      <dt className="text-ink-2">{l.label}</dt>
                      <dd>
                        {l.name}, {l.distance}
                        {l.source ? (
                          <span className="block text-xs text-ink-2">{l.source}</span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {view.hookup ? (
        <div className="mt-4" data-testid="camp-hookup">
          <h3 className="text-lg">{view.hookup.heading}</h3>
          {view.hookup.note ? (
            <p className="mt-1 text-sm text-ink-2">{view.hookup.note}</p>
          ) : null}
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {view.hookup.facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-ink-2">{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
