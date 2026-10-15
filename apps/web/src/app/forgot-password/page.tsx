import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { ForgotForm } from '@/components/account-forms';

// CAMP-228 — /forgot-password.
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
const TITLE = 'Reset your password';

export const metadata: Metadata = {
  title: TITLE,
  description: 'Ask for a link to set a new CampTribe password.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <AccountPage name={TITLE} path="/forgot-password">
      <ForgotForm />
    </AccountPage>
  );
}
