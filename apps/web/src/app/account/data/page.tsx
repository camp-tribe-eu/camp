import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { AccountData } from '@/components/account-data';
import { DATA_TITLE } from '@/components/account-data-view';

// CAMP-229 (3/3) — /account/data: вивантаження даних (ст. 15 і 20 GDPR) і вхід у
// видалення акаунта (ст. 17).
//
// 🔴 `noindex, nofollow` метатегом і лише ним — як і /account: у robots.txt шлях НЕ
// закрито, бо закритий там робот не прочитає й `noindex` (макет: «noindex — так,
// robots.txt — ні»). Сторінки немає в карті сайту й у llms.txt.
//
// 🔴 ПОВНІСТЮ КЛІЄНТСЬКА, як і кабінет: видана сторінка однакова для всіх і не знає, хто
// її відкрив. Хто ввійшов, вирішує `GET /auth/me` у браузері; до того — лише заголовок і
// «Checking your sign-in…» (components/account-cabinet.tsx, `AccountGate`).

export const metadata: Metadata = {
  title: DATA_TITLE,
  description: 'Download a copy of your CampTribe data, or delete your account.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <AccountPage name={DATA_TITLE} path="/account/data">
      <AccountData />
    </AccountPage>
  );
}
