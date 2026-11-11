import { AffiliateLink, AffiliateNotice } from '@/components/affiliate-notice';
import type { Offer } from '@/lib/affiliate';
import { Block } from '@/components/layout';

// CAMP-4 — where a commission link goes, and what stands there until one
// exists.
//
// 🔴 CAMP-463: ПОРОЖНІЙ СТАН БІЛЬШЕ НЕ МАЛЮЄТЬСЯ. Раніше «порожній слот
// — це фіча»: блок розповідав, що партнера немає, і що ми не вигадуватимемо
// пропозицій. Власник: на публічних сторінках не має бути нашої кухні й
// переговорної позиції. Коли пропозицій немає, слот не існує; вигаданої
// пропозиції від цього не зʼявляється — її не було й раніше, а `offers`
// читається з конфігурації (lib/affiliate.ts), не з цього файла.

export default function RentalOfferSlot({
  offers,
  where,
}: {
  offers: Offer[];
  /** Named in the empty state, so the reader knows what is missing. */
  where: string;
}) {
  // 🔴 CAMP-463: ПОРОЖНЄ НЕ МАЛЮЄМО. Тут був блок «We have no rental
  // partner for {where}, so there is nothing here to click…» — розповідь
  // читачеві про те, що в нас немає партнера й чого ми не робитимемо.
  // Коротка відповідь, що читач може зробити сьогодні (пошук, мапа,
  // калькулятор), вже живе в інших секціях цієї сторінки.
  if (offers.length === 0) return null;

  return (
    <section
      data-testid="rental-offer-slot"
      data-state="filled"
      aria-labelledby="rental-offers-heading"
      className="mt-10 rounded-card border border-line-2 bg-surface p-5"
    >
      <h2
        id="rental-offers-heading"
        className="text-xl text-heading"
      >
        Where to rent one in {where}
      </h2>
      {/* 🔴 The group notice, above the links rather than under them. See
          components/affiliate-notice.tsx for why proximity rather than
          existence is the rule that matters. */}
      <AffiliateNotice>
        <ul className="mt-3 space-y-4">
          {offers.map((offer) => (
            <li
              key={`${offer.network.id}-${offer.programme}`}
              className="border-t border-line-2 pt-4 first:border-0 first:pt-0"
            >
              <h3 className="text-heading">
                <AffiliateLink href={offer.href}>{offer.programme}</AffiliateLink>
              </h3>
              {/* Our sentence about the partner, never theirs — see the
                  `note` field in lib/affiliate.ts. */}
              <Block as="p" measure="read" className="mt-1 text-ink-2">{offer.note}</Block>
            </li>
          ))}
        </ul>
      </AffiliateNotice>
    </section>
  );
}
