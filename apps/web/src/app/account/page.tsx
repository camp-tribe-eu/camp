import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { AccountCabinet } from '@/components/account-cabinet';
import { CABINET_TITLE } from '@/components/account-cabinet-view';

// CAMP-229 — /account, кабінет.
//
// 🔴 `noindex, nofollow`, і ЛИШЕ метатегом: у robots.txt цей шлях НЕ закрито.
// Закритий у robots.txt шлях робот не читає, а отже ніколи не побачить сам
// `noindex`; така сторінка могла б лишитись у видачі голим URL
// (Design/07-account.html, «noindex — так, robots.txt — ні»). За цим екраном
// немає нічого, що потрібно пошуку: це приватні списки однієї людини.
//
// Так само сторінки немає в карті сайту й у llms.txt, а посилання на неї немає
// в шапці — вона зʼявиться там разом зі сторінкою налаштувань.
//
// 🔴 ПОВНІСТЮ КЛІЄНТСЬКА. Сторінка видається однаковою всім і не знає, хто її
// відкрив: хто ввійшов, вирішує `GET /auth/me` у браузері, з токеном із
// сховища. Сервер сайту не тримає сесії й не бачить токена (cookie немає), тож
// захист сторінки — це не редірект у middleware, а те, що кабінет НЕ МАЛЮЄ
// нічого, доки API не назвало людину; див. components/account-cabinet.tsx.

export const metadata: Metadata = {
  title: CABINET_TITLE,
  description: 'Your CampTribe account.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <AccountPage name={CABINET_TITLE} path="/account">
      <AccountCabinet />
    </AccountPage>
  );
}
