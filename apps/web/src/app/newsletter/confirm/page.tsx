import type { Metadata } from "next";
import { AccountPage } from "@/components/account-page";
import NewsletterLinkAction, { LINK_TITLES } from "@/components/newsletter-link-action";

// CAMP-441/7 — сюди веде посилання з листа підписки.
//
// 🔴 ЦЯ СТОРІНКА НІЧОГО НЕ МІНЯЄ ПРИ ВІДКРИТТІ: поштові сканери відкривають
// посилання самі. Зміну робить кнопка (POST), див. components/newsletter-link-action.tsx.
//
// 🔴 `noindex, nofollow` ЛИШЕ МЕТАТЕГОМ (як app/verify-email) і
// `Referrer-Policy: no-referrer`: токен у адресі не мусить їхати
// в заголовку Referer на жоден ресурс. Сторінки немає в карті сайту.

const ACTION = "confirm" as const;

export const metadata: Metadata = {
  title: LINK_TITLES[ACTION],
  description: "A link from a CampTribe letter.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function Page() {
  return (
    <AccountPage name={LINK_TITLES[ACTION]} path="/newsletter/confirm">
      <NewsletterLinkAction action={ACTION} />
    </AccountPage>
  );
}
