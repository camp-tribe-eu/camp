import Link from 'next/link';
import { CODE_LENGTH, type ClaimOutcome } from '@/lib/spot-claim';
import { Button } from '@/components/button';

// CAMP-51 — те, що малює сторінка заявки на володіння кемпінгом.
//
// 🔴 Лише розмітка: жодного стану, жодного запиту. Та сама межа, що в
// `account-view.tsx`, і з тієї ж причини — ці функції перевіряються на
// ВИДАНОМУ HTML, а не на константі.

const LABEL = 'block text-sm font-medium text-ink-2';
const HINT = 'mt-1 text-sm text-ink-2';
const FIELD =
  'mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue';
const PANEL = 'mt-6 max-w-md rounded-card border border-line-2 bg-surface-2 p-5';

export const CLAIM_TITLE = 'Claim a campsite listing';

/** Що саме сказати людині про цю відповідь. */
export function messageFor(o: ClaimOutcome | null): string | null {
  if (!o) return null;
  switch (o.kind) {
    case 'refused':
      // 🔴 Ніколи порожнє. `explain()` уже має запасний текст, але якщо
      // колись хтось збере `refused` руками з порожнім `message`,
      // сторінка покаже порожній абзац — тобто мовчання замість відмови.
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

export function ClaimIntro({ spot }: { spot: string }) {
  return (
    <>
      <h1 className="text-2xl font-semibold text-ink">{CLAIM_TITLE}</h1>
      {/* 🔴 СКАЗАНО, КУДИ ПІДЕ ЛИСТ І ЧОМУ, ДО того як людина натисне.
          Інакше вона натискає, не знаючи, що ми пишемо третій стороні —
          і дізнається про це з чужої скарги. */}
      <p className={HINT}>
        We send a code to the email address that is in the public
        OpenStreetMap tags for <strong>{spot}</strong>. We do not show you
        that address, and we do not take it from anywhere else.
      </p>
      <p className={HINT}>
        Whoever reads that inbox passes you the code. Typing it here is what
        proves the listing is yours.
      </p>
    </>
  );
}

export function AskView({
  spot,
  busy,
  ready,
  onSend,
  message,
}: {
  spot: string;
  busy: boolean;
  ready: boolean;
  onSend: () => void;
  message: string | null;
}) {
  return (
    <section className={PANEL}>
      <ClaimIntro spot={spot} />
      {message && (
        <p className="mt-4 text-sm text-ink" role="alert">
          {message}
        </p>
      )}
      <div className="mt-5">
        <Button onClick={onSend} disabled={busy || !ready}>
          {busy ? 'Sending…' : 'Send the code'}
        </Button>
      </div>
    </section>
  );
}

export function CodeView({
  spot,
  sentTo,
  code,
  busy,
  ready,
  canSend,
  onCode,
  onConfirm,
  onSend,
  message,
}: {
  spot: string;
  sentTo: string;
  code: string;
  busy: boolean;
  ready: boolean;
  canSend: boolean;
  onCode: (v: string) => void;
  onConfirm: () => void;
  onSend: () => void;
  message: string | null;
}) {
  return (
    <section className={PANEL}>
      <h1 className="text-2xl font-semibold text-ink">{CLAIM_TITLE}</h1>
      {/* 🔴 МАСКА, А НЕ АДРЕСА. Її дає API і більше нічого не дає:
          сторінка не може показати те, чого не отримала. */}
      <p className={HINT}>
        A code is on its way to <strong>{sentTo}</strong> for{' '}
        <strong>{spot}</strong>.
      </p>
      <label className={`${LABEL} mt-5`} htmlFor="claim-code">
        The code from the letter
      </label>
      <input
        id="claim-code"
        className={FIELD}
        value={code}
        disabled={!ready || busy}
        autoComplete="one-time-code"
        inputMode="text"
        onChange={(e) => onCode(e.target.value)}
        placeholder={'X'.repeat(CODE_LENGTH)}
      />
      <p className={HINT}>
        {CODE_LENGTH} characters. Spaces, dashes and lower case do not matter.
      </p>
      {message && (
        <p className="mt-4 text-sm text-ink" role="alert">
          {message}
        </p>
      )}
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={onConfirm} disabled={busy || !ready || !canSend}>
          {busy ? 'Checking…' : 'Confirm'}
        </Button>
        <button
          type="button"
          className="text-sm underline text-ink-2"
          disabled={busy || !ready}
          onClick={onSend}
        >
          Send a new code
        </button>
      </div>
    </section>
  );
}

export function DoneView({ spot }: { spot: string }) {
  return (
    <section className={PANEL}>
      <h1 className="text-2xl font-semibold text-ink">
        {spot} is yours to manage
      </h1>
      <p className={HINT}>
        {/* 🔴 Сказано ЧЕСНО, що саме це дає, і що ще ні. Фото — окрема
            картка (CAMP-52), і обіцяти їх зараз означало б збрехати
            людині, яка щойно нам довірилась. */}
        You can now correct what the page says — the name and what the site
        has. Photographs come later.
      </p>
      <p className={HINT}>
        <Link className="underline" href="/account/listings">
          Correct this listing
        </Link>
      </p>
    </section>
  );
}

export function NoSpotView() {
  return (
    <section className={PANEL}>
      <h1 className="text-2xl font-semibold text-ink">{CLAIM_TITLE}</h1>
      <p className={HINT}>
        Open this page from a campsite, so we know which listing you mean.
      </p>
      <p className={HINT}>
        <Link className="underline" href="/camping">
          Find a campsite
        </Link>
      </p>
    </section>
  );
}
