import Link from 'next/link';

// CAMP-56 item 4 — the warning where it is worth something.
//
// 🔴 The card is explicit that a footer link is legally weaker and that
// the notice must be visible AT THE MOMENT OF ACTION. The moment of
// action for a campsite page is the moment somebody decides to drive
// there, which happens on the page, not at the bottom of it.
//
// So this is small, plain and in the flow of the page rather than a
// dismissible banner: a notice a reader can close is a notice half the
// readers never see, and the one thing it has to do is be seen.
//
// 🔴 Deliberately NOT alarming. It states two facts — nobody from here
// has visited, and rules differ — because a warning people learn to skip
// protects nobody. The full version is one link away.

export default function TravelNotice({
  className = '',
}: {
  className?: string;
}) {
  return (
    <aside
      data-testid="travel-notice"
      // Same reasoning as the attribution block: word-for-word identical
      // on every campsite page, so it carries no signal about duplication.
      data-boilerplate="travel-notice"
      className={`rounded-card border border-line-2 bg-surface-2 p-3 text-xs leading-5 text-ink-2 ${className}`}
    >
      <p>
        <strong className="font-semibold text-heading">
          Check before you go.
        </strong>{' '}
        This information comes from OpenStreetMap and is re-imported weekly;
        nobody from CampTribe has visited. Opening dates, prices and
        facilities change, and whether camping is permitted at a given place
        is a matter of local law and the landowner&rsquo;s permission —
        finding it on this map is not permission to camp there.{' '}
        <Link href="/legal/disclaimer" className="underline">
          What we do and do not know
        </Link>
      </p>
    </aside>
  );
}
