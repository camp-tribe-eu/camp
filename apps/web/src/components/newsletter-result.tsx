import Link from "next/link";
import { Block } from "@/components/layout";
import { Shell } from "@/components/account-view";
import { CONTACT_EMAIL, PRIVACY_EMAIL } from "@/lib/legal";

// Де закінчується посилання з листа підписки: API перенаправляє сюди після
// `GET /newsletter/confirm` та `/unsubscribe` (apps/api/src/newsletter).
//
// 🔴 ТРИ СТОРІНКИ, А НЕ ОДНА СО СТАНОМ У АДРЕСІ: сайт статичний, і сторінка,
// що читає `?status=` у браузері, у виданому HTML нічого б не казала —
// а правду про результат читач має побачити навіть без скрипта.
//
// 🔴 КОЖЕН ТЕКСТ ГОВОРИТЬ ЛИШЕ ТЕ, ЩО ЗРОБИЛО ПОСИЛАННЯ. «Link-invalid» не каже
// «вас відписано» й не каже «вас не підписано»: токен не підійшов, і більше ми
// про адресу не знаємо — і не можемо знати, бо в посиланні адреси немає.

export type NewsletterResult = "confirmed" | "unsubscribed" | "link-invalid";

export const RESULTS: Record<
  NewsletterResult,
  { title: string; description: string }
> = {
  confirmed: {
    title: "You are subscribed",
    description: "Your email address is confirmed for CampTribe letters.",
  },
  unsubscribed: {
    title: "You are unsubscribed",
    description: "Your email address is unsubscribed from CampTribe letters.",
  },
  "link-invalid": {
    title: "This link does not work",
    description: "The link from a CampTribe letter could not be used.",
  },
};

const LINK = "underline";

export function NewsletterResultView({ state }: { state: NewsletterResult }) {
  return (
    <Shell title={RESULTS[state].title}>
      {state === "confirmed" && (
        <>
          <Block as="p" measure="read" className="mt-4 text-ink-2">
            Thank you, your address is confirmed. From now on we may send you occasional news
            about CampTribe, and every letter carries a link to unsubscribe with one click.
          </Block>
          <Block as="p" measure="read" className="mt-3 text-ink-2">
            What we keep, and why, is in the{" "}
            <Link className={LINK} href="/legal/privacy#newsletter">
              privacy policy
            </Link>
            .
          </Block>
        </>
      )}
      {state === "unsubscribed" && (
        <>
          <Block as="p" measure="read" className="mt-4 text-ink-2">
            Your address is marked as unsubscribed, and we will not write to you again. We keep
            the address, with that mark, only so that we do not write to you by mistake. If you
            would rather it were deleted completely, write to{" "}
            <a className={LINK} href={`mailto:${PRIVACY_EMAIL}`}>
              {PRIVACY_EMAIL}
            </a>
            .
          </Block>
          <Block as="p" measure="read" className="mt-3 text-ink-2">
            Changed your mind? The form at the bottom of any page starts again, with a new
            confirmation letter.
          </Block>
        </>
      )}
      {state === "link-invalid" && (
        <>
          <Block as="p" measure="read" className="mt-4 text-ink-2">
            The link has expired (a confirmation link works for 48 hours), has already been used,
            or was not copied in full. Nothing was changed.
          </Block>
          <Block as="p" measure="read" className="mt-3 text-ink-2">
            To subscribe, use the form at the bottom of any page: you get a new letter. To be
            removed from our list, write to{" "}
            <a className={LINK} href={`mailto:${PRIVACY_EMAIL}`}>
              {PRIVACY_EMAIL}
            </a>{" "}
            or to{" "}
            <a className={LINK} href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            .
          </Block>
        </>
      )}
      <p className="mt-6">
        <Link className={LINK} href="/">
          Continue to the site
        </Link>
      </p>
    </Shell>
  );
}
