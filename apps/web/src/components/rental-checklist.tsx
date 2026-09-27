// CAMP-4 — what to settle before signing, and the one place where the law
// and the contract say different things.
//
// 🔴 No numbers anywhere in this file, and that is deliberate rather than
// lazy. Excesses, one-way fees, mileage caps and minimum hires are set per
// company and per season; a figure here would be invented, would date
// within a month, and would be quoted back at us by a reader who paid
// something else. What does not vary is WHICH questions decide the bill,
// and that is a genuinely useful thing to publish because the rental
// company has no reason to volunteer it.

interface Item {
  q: string;
  why: string;
  source?: { name: string; url: string };
}

const ITEMS: Item[] = [
  {
    q: 'What is the excess, and what reduces it?',
    why: 'The damage waiver in the headline price almost never takes the excess to zero. Ask for the figure, ask what it applies to per incident rather than per hire, and ask specifically about the roof, the awning, the tyres and the underside — the parts most often excluded, and the parts a camper actually damages.',
  },
  {
    q: 'May the vehicle leave the country, and which countries?',
    why: 'Two different things are being confused here, and the difference costs money. Compulsory third-party motor insurance is valid throughout the Union by law — that is the Motor Insurance Directive, and it does not depend on your contract. Whether the rental company PERMITS you to take the vehicle across a border is a contractual matter and is often restricted. Get the permitted countries written down.',
    source: {
      name: 'Directive 2009/103/EC on motor insurance',
      url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32009L0103',
    },
  },
  {
    q: 'Is there a mileage cap, and what is the rate beyond it?',
    why: 'A cap that looks generous for a week in one country is not generous for a loop through four. Work out the route first and compare it with the included distance, not the other way round.',
  },
  {
    q: 'What does a one-way hire cost, and is it even offered?',
    why: 'Picking up in one city and dropping off in another is priced separately, and on some routes it is simply not available. It is also the item most likely to be quoted only after the rest of the booking is agreed.',
  },
  {
    q: 'What is the minimum hire in this season?',
    why: 'Minimum hire lengths rise in high season, and in some places the summer minimum is a week or more. A three-night trip in August may not be bookable at any price.',
  },
  {
    q: 'Who pays tolls, congestion charges and fines, and with what fee added?',
    why: 'Camera-enforced charges — Italian limited traffic zones, the Dublin M50, Swedish congestion tax — reach the registered keeper, which is the rental company. They pass it on, usually with an administration fee. Ask what that fee is before you drive into a historic centre, not after.',
  },
  {
    q: 'What winter equipment is fitted, and what does the contract require?',
    why: 'Winter tyre rules are national and differ in shape: some are tied to dates, some to conditions, some to the road sign in front of you. A rental agreement can also impose its own requirement that binds you even where the law does not. Both have to be satisfied.',
  },
  {
    q: 'What is the plated maximum authorised mass, and what is left for payload?',
    why: 'The single most expensive number on the document. It decides whether your licence covers the vehicle at all, which toll system you are in across much of central Europe, and how much water, gas and luggage you may legally carry. Ask for both the plated mass and the mass in running order, and subtract.',
    source: {
      name: 'Directive 2006/126/EC on driving licences',
      url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02006L0126-20220101',
    },
  },
];

export default function RentalChecklist() {
  return (
    <section
      data-testid="rental-checklist"
      aria-labelledby="checklist-heading"
      className="mt-12"
    >
      <h2 id="checklist-heading" className="text-2xl font-bold text-heading">
        Eight questions to ask before you sign
      </h2>
      <p className="mt-3 max-w-prose text-ink-2">
        None of these has a number we can give you, because none of them has
        a number that is the same twice. What they have in common is that the
        answer is cheap to obtain before the booking and expensive to
        discover after it.
      </p>

      <ol className="mt-6 space-y-5">
        {ITEMS.map((item, i) => (
          <li
            key={item.q}
            className="rounded-card border border-line-2 bg-surface p-5"
          >
            <h3 className="font-semibold text-heading">
              <span className="text-ink-3">{i + 1}.</span> {item.q}
            </h3>
            <p className="mt-2 max-w-prose text-ink-2">{item.why}</p>
            {item.source && (
              <p className="mt-2 text-sm text-ink-2">
                Source:{' '}
                <a
                  className="underline"
                  href={item.source.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {item.source.name}
                </a>
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
