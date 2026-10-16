import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { ConfirmEmailChange } from '@/components/account-forms';

// CAMP-229 — /confirm-email-change.
//
// 🔴 `noindex, nofollow`, і ЛИШЕ метатегом: у robots.txt цей шлях НЕ
// закрито, з тієї ж причини, що й /verify-email. Закритий у robots.txt шлях
// робот не читає, а отже ніколи не побачить сам `noindex`.
//
// 🔴 ЦЯ СТОРІНКА ІСНУЄ ТОМУ, ЩО НА НЕЇ ВКАЗУЄ ЛИСТ. `mail.spec.ts` звіряє
// `LINK_PATH` з наявністю сторінки в `apps/web/src/app`: посилання в листі,
// що веде у 404, — зламаний потік, який нікому не видно.

const TITLE = 'Confirm your new email';

export const metadata: Metadata = {
  title: TITLE,
  description: 'Confirm the new email address for your CampTribe account.',
  robots: { index: false, follow: false },
  // Токен у адресі — той самий виток, що й на /verify-email, і закритий так само.
  referrer: 'no-referrer',
};

export default function Page() {
  return (
    <AccountPage name={TITLE} path="/confirm-email-change">
      <ConfirmEmailChange />
    </AccountPage>
  );
}
