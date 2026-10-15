import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { ResetForm } from '@/components/account-forms';

// CAMP-228 — /reset-password.
//
// 🔴 `noindex, nofollow`, і ЛИШЕ метатегом: у robots.txt цей шлях НЕ
// закрито. Закритий у robots.txt шлях робот не читає, а отже ніколи не
// побачить сам `noindex`; така сторінка могла б лишитись у видачі голим
// URL. Заборона сканувати й заборона індексувати — різні речі
// (Design/07-account.html, «noindex — так, robots.txt — ні»). За цим
// екраном немає нічого, що потрібно пошуку.
//
// Так само сторінки немає в карті сайту й у llms.txt.

// Один рядок на `<title>`, на назву хлібної крихти й на виданий `<h1>`.
const TITLE = 'Choose a new password';

export const metadata: Metadata = {
  title: TITLE,
  description: 'Set a new CampTribe password.',
  robots: { index: false, follow: false },
  // 🔴 Токен у адресі. Без `Referrer-Policy: no-referrer` він іде в
  // заголовку Referer на кожен ресурс, який сторінка підтягне, і в
  // аналітику, якщо вона колись зʼявиться. Посилання одноразове й живе
  // 60 хвилин, але цей виток нічого не коштує закрити.
  referrer: 'no-referrer',
};

export default function Page() {
  return (
    <AccountPage name={TITLE} path="/reset-password">
      <ResetForm />
    </AccountPage>
  );
}
