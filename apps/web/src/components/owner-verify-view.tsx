import Link from 'next/link';
import { Button } from '@/components/button';
import { CLAIM_TITLE } from '@/components/claim-view';
import { HELP_ADDRESS, type OwnerOutcome } from '@/lib/owner-verify';

// CAMP-505 — те, що малює «Це мій кемпінг». Лише розмітка: жодного стану й
// жодного запиту, і з тієї ж причини, що в `claim-view.tsx` — ці функції
// перевіряються на ВИДАНОМУ HTML, а не на константі.

const LABEL = 'block text-sm font-medium text-ink-2';
const HINT = 'mt-1 text-sm text-ink-2';
const FIELD =
  'mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue';
const PANEL = 'mt-6 max-w-md rounded-card border border-line-2 bg-surface-2 p-5';

export const OWNER_TITLE = 'This is my campsite';
export const OWNER_CONFIRM_TITLE = 'Confirm that you manage this campsite';

/** Що сказати про відповідь, яка не «прийнято» й не «підтверджено». */
export function ownerMessage(o: OwnerOutcome | null): string | null {
  if (!o) return null;
  switch (o.kind) {
    case 'refused':
      return o.message || 'That did not work.';
    case 'signed-out':
      return 'Sign in first — a claim belongs to an account.';
    case 'unavailable':
      return 'The site is not connected to its API here.';
    case 'failed':
      return 'The request did not go through. Try again.';
    default:
      return null;
  }
}

export function OwnerEmailView({
  spot,
  email,
  busy,
  ready,
  onEmail,
  onSend,
  message,
}: {
  spot: string;
  email: string;
  busy: boolean;
  ready: boolean;
  onEmail: (v: string) => void;
  onSend: () => void;
  message: string | null;
}) {
  return (
    <section className={PANEL}>
      {/* Той самий рядок, що `<title>` сторінки й назва хлібної крихти. */}
      <h1 className="text-2xl text-ink">{CLAIM_TITLE}</h1>
      {/* 🔴 СКАЗАНО, ЯКА АДРЕСА ПІДІЙДЕ, ДО того як людина її введе. Інакше
          вона вводить особисту пошту, чекає листа, якого не буде, і
          дізнається причину лише з відповіді, яка навмисно не каже «ні». */}
      <p className={HINT}>
        Enter an email address on your campsite’s own website domain, for{' '}
        <strong>{spot}</strong>. If it matches, we send a one-time link to it —
        no one reviews anything by hand.
      </p>
      <p className={HINT}>
        Free mail (Gmail, Outlook, GMX, Orange and the like) does not work for
        this, even if it is the address shown on the page.
      </p>
      <label className={`${LABEL} mt-5`} htmlFor="owner-email">
        Your email address at the campsite
      </label>
      <input
        id="owner-email"
        className={FIELD}
        type="email"
        value={email}
        disabled={!ready || busy}
        autoComplete="email"
        inputMode="email"
        onChange={(e) => onEmail(e.target.value)}
        placeholder="you@your-campsite.com"
      />
      {message && (
        <p className="mt-4 text-sm text-ink" role="alert">
          {message}
        </p>
      )}
      <div className="mt-5">
        <Button onClick={onSend} disabled={busy || !ready || email.trim() === ''}>
          {busy ? 'Sending…' : 'Send the link'}
        </Button>
      </div>
      <p className={`${HINT} mt-4`}>
        No address on your own domain?{' '}
        <Link className="underline" href={`/account/claim?spot=${spot}&via=osm`}>
          Use the address published in OpenStreetMap instead
        </Link>
        , or write to {HELP_ADDRESS}.
      </p>
    </section>
  );
}

export function OwnerSentView({ spot }: { spot: string }) {
  return (
    <section className={PANEL}>
      <h1 className="text-2xl text-ink">Check your inbox</h1>
      {/* 🔴 ЧЕСНО ПРО ОБИДВА КІНЦІ. Сервер не каже, чи збігся домен, тож
          і сторінка не каже: «якщо підійшла» і «якщо листа немає — не
          вдалося». Фраза «лист надіслано» тут була б неправдою для кожного,
          чия адреса не збіглась. */}
      <p className={HINT} role="status">
        If that address belongs to <strong>{spot}</strong>, a letter with a
        link is on its way and works for one hour, once.
      </p>
      <p className={HINT}>
        If nothing arrives within a few minutes, we could not confirm you
        automatically — write to{' '}
        <a className="underline" href={`mailto:${HELP_ADDRESS}`}>
          {HELP_ADDRESS}
        </a>
        .
      </p>
      <p className={HINT}>
        Open the link in this browser, where you are signed in: it works only
        in the account that asked.
      </p>
    </section>
  );
}

/** Сторінка з листа. Відкриття НІЧОГО не підтверджує — потрібен клік. */
export function OwnerConfirmView({
  busy,
  ready,
  onConfirm,
  message,
}: {
  busy: boolean;
  ready: boolean;
  onConfirm: () => void;
  message: string | null;
}) {
  return (
    <section className={PANEL}>
      <h1 className="text-2xl text-ink">{OWNER_CONFIRM_TITLE}</h1>
      <p className={HINT}>
        You opened a link from a CampTribe letter. Opening it changed nothing:
        press the button to confirm that you or your team manage the campsite
        you asked about, from the account you are signed in to.
      </p>
      <p className={HINT}>
        If you did not ask for this, close the page — nothing has been
        confirmed.
      </p>
      {message && (
        <p className="mt-4 text-sm text-ink" role="alert">
          {message}
        </p>
      )}
      <div className="mt-5">
        <Button onClick={onConfirm} disabled={busy || !ready}>
          {busy ? 'Confirming…' : 'Yes, I manage this campsite'}
        </Button>
      </div>
    </section>
  );
}

export function OwnerDoneView({ name }: { name: string | null }) {
  return (
    <section className={PANEL}>
      <h1 className="text-2xl text-ink">
        {name ? `${name} is confirmed as yours` : 'Campsite confirmed as yours'}
      </h1>
      {/* 🔴 ЛИШЕ СТАТУС. Що власник може правити — окрема картка; тут не
          обіцяно нічого, чого ще немає. */}
      <p className={HINT}>
        Your account is now marked as the manager of this listing.
      </p>
      <p className={HINT}>
        <Link className="underline" href="/account/listings">
          Your listings
        </Link>
      </p>
    </section>
  );
}

export function OwnerNoTokenView() {
  return (
    <section className={PANEL}>
      <h1 className="text-2xl text-ink">{OWNER_CONFIRM_TITLE}</h1>
      <p className={HINT}>
        This page needs the link from the letter. Open the campsite page and
        press “{OWNER_TITLE}” to get a new one.
      </p>
      <p className={HINT}>
        <Link className="underline" href="/camping">
          Find a campsite
        </Link>
      </p>
    </section>
  );
}
