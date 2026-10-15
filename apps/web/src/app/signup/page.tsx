import type { Metadata } from 'next';
import { SignupForm } from '@/components/account-forms';

// CAMP-228 — /signup.
//
// 🔴 `noindex, nofollow`, і ЛИШЕ метатегом: у robots.txt цей шлях НЕ
// закрито. Закритий у robots.txt шлях робот не читає, а отже ніколи не
// побачить сам `noindex`; така сторінка могла б лишитись у видачі голим
// URL. Заборона сканувати й заборона індексувати — різні речі
// (Design/07-account.html, «noindex — так, robots.txt — ні»). За цим
// екраном немає нічого, що потрібно пошуку.
//
// Так само сторінки немає в карті сайту й у llms.txt.

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create a CampTribe account.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SignupForm />;
}
