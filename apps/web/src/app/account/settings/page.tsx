import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { AccountSettings } from '@/components/account-settings';

// CAMP-229 — /account/settings.
//
// 🔴 `noindex, nofollow` метатегом, і ЛИШЕ ним: у robots.txt цей шлях НЕ
// закрито — як і решта сторінок кабінету. Закритий у robots.txt шлях робот
// не читає, а отже ніколи не побачить сам `noindex`; така сторінка могла б
// лишитись у видачі голим URL (Design/07-account.html, «noindex — так,
// robots.txt — ні»). Сторінки немає ні в карті сайту, ні в llms.txt.
//
// Токена в адресі тут немає, тож `referrer` не перевизначається: він
// потрібен там, де посилання з листа несе одноразовий токен.

const TITLE = 'Settings';

export const metadata: Metadata = {
  title: TITLE,
  description: 'Change the email, password and letters for your CampTribe account.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <AccountPage name={TITLE} path="/account/settings">
      <AccountSettings />
    </AccountPage>
  );
}
