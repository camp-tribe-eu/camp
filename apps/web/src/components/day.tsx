import { isoDay, readableDay } from '@/lib/rental-providers';

// CAMP-463 — a day for a reader, with the machine's form kept for the
// machine. The text is `3 November 2026`; `datetime` carries `2026-11-03`.
// A value that is not a date prints as it came (see `readableDay`).

export default function Day({ value }: { value: string }) {
  return <time dateTime={isoDay(value)}>{readableDay(value)}</time>;
}
