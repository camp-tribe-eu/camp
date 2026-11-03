import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { OwnerListings } from '@/components/owner-listings';
import { LISTINGS_TITLE } from '@/components/owner-listings-view';

// CAMP-51 / CAMP-86 — /account/listings.
//
// 🔴 `noindex, nofollow` метатегом і НЕ в robots.txt — те саме рішення,
// що для /account і /account/claim: закритий у robots.txt шлях робот не
// читає, а отже ніколи не побачить сам `noindex`.
export const metadata: Metadata = {
  title: LISTINGS_TITLE,
  description: 'Correct what your campsite page says.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <AccountPage name={LISTINGS_TITLE} path="/account/listings">
      <OwnerListings />
    </AccountPage>
  );
}
