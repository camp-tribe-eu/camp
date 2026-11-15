import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { OwnerConfirm } from '@/components/owner-verify-form';
import { OWNER_CONFIRM_TITLE } from '@/components/owner-verify-view';

// CAMP-505 — /account/claim/confirm, куди веде лист власника.
//
// 🔴 `noindex, nofollow` лише метатегом, як усі сторінки акаунта: закритий у
// robots.txt шлях робот не читає й не побачить `noindex`.
//
// 🔴 `referrer: no-referrer`. Токен у адресі; без цього він іде в `Referer`
// на кожен ресурс, який сторінка підтягне. Посилання одноразове й живе
// годину, але цей виток нічого не коштує закрити (так само на /verify-email).
//
// 🔴 ВІДКРИТТЯ СТОРІНКИ НІЧОГО НЕ РОБИТЬ. Запит іде лише після кліку на
// кнопку: поштові сканери й попередній перегляд відкривають посилання самі.
export const metadata: Metadata = {
  title: OWNER_CONFIRM_TITLE,
  description: 'Confirm that you manage a campsite listing.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return (
    <AccountPage name={OWNER_CONFIRM_TITLE} path="/account/claim/confirm">
      <Suspense fallback={null}>
        <OwnerConfirm />
      </Suspense>
    </AccountPage>
  );
}
