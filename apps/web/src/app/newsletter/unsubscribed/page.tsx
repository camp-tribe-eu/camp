import type { Metadata } from "next";
import { AccountPage } from "@/components/account-page";
import { NewsletterResultView, RESULTS } from "@/components/newsletter-result";

// CAMP-441/7 — де закінчується посилання з листа підписки.
//
// 🔴 `noindex, nofollow`, і ЛИШЕ метатегом (див. app/verify-email/page.tsx:
// закритий у robots.txt шлях робот не читає, тож не побачить і `noindex`).
// Сторінки немає в карті сайту й у llms.txt: за нею немає нічого для пошуку.
//
// 🔴 `Referrer-Policy: no-referrer`: посилання з листа несе токен, і хоч сюди
// API веде вже БЕЗ токена, звичка закривати витік нічого не коштує.

const STATE = "unsubscribed" as const;

export const metadata: Metadata = {
  title: RESULTS[STATE].title,
  description: RESULTS[STATE].description,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return (
    <AccountPage name={RESULTS[STATE].title} path="/newsletter/unsubscribed">
      <NewsletterResultView state={STATE} />
    </AccountPage>
  );
}
