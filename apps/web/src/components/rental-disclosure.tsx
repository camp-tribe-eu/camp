import Link from 'next/link';

// CAMP-4 — the commercial disclosure, in the template rather than in the
// footer, and on every page of this section from its first day.
//
// 🔴 WHY IT IS AT THE TOP AND NOT AT THE BOTTOM.
//
// The Unfair Commercial Practices Directive (2005/29/EC) treats failing
// to identify the commercial intent of a communication as a misleading
// omission — Article 7(2) — and the affiliate networks' own terms require
// the same thing. Both are about the moment of decision: a reader decides
// whether to trust a recommendation while reading it, and a notice below
// the fold is read after that decision or not at all.
//
// 🔴 ЧОМУ БЕЗ ПОСИЛАНЬ КОМПОНЕНТ НЕ ПОКАЗУЄ НІЧОГО.
//
// Обовʼязок — розкрити комерційний звʼязок ТАМ, ДЕ ВІН Є. Оголошувати
// його відсутність не вимагає ні UCPD, ні умови партнерських мереж, і
// користі читачеві від цього нуль: він не ухвалює рішення про довіру до
// посилання, якого немає.
//
// Тут раніше стояв абзац, який повідомляв світові, що партнерів у нас
// немає й на цій сторінці ми нічого не заробляємо. Це не чесність перед
// читачем — це наша переговорна позиція, викладена конкурентам і
// майбутнім партнерам. Прибрано 08.11.2026 за рішенням власника.
//
// Механіка лишається: щойно зʼявиться перше посилання, розкриття
// зʼявиться саме, і його не треба буде комусь згадати.

export default function RentalDisclosure({ offers }: { offers: number }) {
  // Немає посилань — немає про що розкривати.
  if (offers <= 0) return null;

  return (
    <aside
      data-testid="rental-disclosure"
      aria-label="How this section is funded"
      className="mt-6 rounded-card border border-line-blue bg-accent-surface p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-heading">
        How this page is paid for
      </h2>

        <p className="mt-2 max-w-prose text-sm leading-6 text-ink">
          <strong className="text-heading">
            Some links on this page are affiliate links.
          </strong>{' '}
          If you book through one, the provider may pay us a commission. It
          costs you nothing, it does not change the price, and it does not
          change anything else on this page — commission buys no place in our
          listings and no sentence in our writing. Every such link is marked
          before you click it.{' '}
          <Link href="/legal/terms#links" className="underline">
            How this works
          </Link>
          .
        </p>
    </aside>

  );
}
