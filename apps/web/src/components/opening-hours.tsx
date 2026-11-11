import { humanOpeningHours } from '@/lib/opening-hours';

// CAMP-463 — opening hours for a reader. See lib/opening-hours.ts for the
// grammar and for why anything outside it is NOT rewritten.
//
// 🔴 TWO SHAPES, AND NEITHER IS THE RAW STRING IN THE BODY OF THE PAGE.
//
//   · read in full  → words ("Mon–Fri 09:00–18:00; Sat 09:00–13:00");
//   · not read      → «Opening hours as recorded» under a spoiler, with
//                     the original line inside, because the original is
//                     the only thing we can show without guessing, and a
//                     reader who wants it can open it.
//
// The JSON-LD (which has its own all-or-nothing translation in
// lib/jsonld.ts) is untouched: this changes what the reader sees, not what
// the crawler is given.

export default function OpeningHours({
  value,
  testId,
  className,
}: {
  value: string;
  testId?: string;
  className?: string;
}) {
  const words = humanOpeningHours(value);
  if (words) {
    return (
      <span className={className} data-testid={testId} data-hours="read">
        {words}
      </span>
    );
  }
  return (
    <details className={className} data-testid={testId} data-hours="as-recorded">
      <summary className="cursor-pointer underline underline-offset-2">
        Opening hours as recorded
      </summary>
      <span className="mt-1 block">{value}</span>
    </details>
  );
}
