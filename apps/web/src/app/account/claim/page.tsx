import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { ClaimForm } from '@/components/claim-form';
import { CLAIM_TITLE } from '@/components/claim-view';

// CAMP-51 — /account/claim, заявка на володіння кемпінгом.
//
// 🔴 `noindex, nofollow`, і ЛИШЕ метатегом — те саме рішення, що й для
// /account: закритий у robots.txt шлях робот не читає, а отже ніколи не
// побачить сам `noindex`, і сторінка могла б лишитись у видачі голим URL.
//
// 🔴 ПОВНІСТЮ КЛІЄНТСЬКА. Сервер сайту не тримає сесії й не бачить
// токена; хто саме подає заявку, вирішує API за `Authorization`, який
// сторінка прикладає сама.
export const metadata: Metadata = {
  title: CLAIM_TITLE,
  description: 'Prove that a campsite listing is yours.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <AccountPage name={CLAIM_TITLE} path="/account/claim">
      {/* `useSearchParams` вимагає межі Suspense у статичній збірці. */}
      <Suspense fallback={null}>
        <ClaimForm />
      </Suspense>
    </AccountPage>
  );
}
