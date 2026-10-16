import type { Metadata } from 'next';
import { AccountPage } from '@/components/account-page';
import { AccountDelete } from '@/components/account-delete';
import { DELETE_TITLE } from '@/components/account-delete-view';

// CAMP-229 (3/3) — /account/delete: видалення акаунта (ст. 17 GDPR).
//
// 🔴 `noindex, nofollow` метатегом, а не в robots.txt, і сторінки немає в карті сайту — з
// тих самих причин, що в /account (див. app/account/page.tsx). Екран свідомо лежить
// ОКРЕМО від «Ваших даних»: його відкривають лише навмисно, а не прокручуючи повз.

export const metadata: Metadata = {
  title: DELETE_TITLE,
  description: 'Delete your CampTribe account.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <AccountPage name={DELETE_TITLE} path="/account/delete">
      <AccountDelete />
    </AccountPage>
  );
}
