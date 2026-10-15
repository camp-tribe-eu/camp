import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  LINK_MINUTES,
  MIN_PASSWORD,
  clock,
  type Outcome,
} from '@/lib/account';

// CAMP-228 — те, що малюють сторінки акаунта: форми й стани «Перевірте
// пошту», «Підтвердьте пошту», «Посилання застаріло».
//
// 🔴 Лише розмітка. Жодного стану, жодного запиту, жодного `fetch`: ці
// функції беруть значення й повертають HTML, тому їх читають на
// ВИДАНОМУ HTML (tests/unit/account-view.spec.tsx), а не на константі,
// класі чи `data-testid`. Стан живе в account-forms.tsx, мережа — в
// lib/account.ts.
//
// 🔴 Мова верстки — наявних сторінок (/plan, /contact), а не нова:
// ті самі поля, та сама кнопка, той самий підсумок помилки. Звірка з
// `Design/07-account.html` — у docs/design-audit.md §6.6, разом зі
// списком того, що з макета свідомо НЕ взято і чому.

const LABEL = 'block text-sm font-medium text-ink-2';
const HINT = 'mt-1 text-sm text-ink-2';
const FIELD =
  'mt-1 w-full rounded border border-line-2 bg-surface px-3 py-2 text-ink focus:border-line-blue';
const BUTTON =
  'mt-5 inline-flex h-11 items-center rounded-sm border border-line-blue bg-accent-surface px-4 text-sm font-semibold text-heading hover:border-line-2 disabled:opacity-60';
const LINK = 'underline';
const PANEL = 'mt-6 max-w-md rounded-card border border-line-2 bg-surface-2 p-5';

/** Що кожен стан каже людині. Одне місце, щоб тести й сторінки читали те саме. */
export function messageFor(o: Outcome): string | null {
  switch (o.kind) {
    case 'invalid':
      return o.message || 'Check the form and try again.';
    case 'refused':
      return 'Email or password is wrong.';
    case 'taken':
      return 'An account with this email already exists.';
    case 'stale':
      return 'This link has expired or has already been used.';
    case 'too-soon':
      return 'A letter was sent a moment ago. Please wait before asking again.';
    case 'throttled':
      return 'Too many attempts from this connection. Try again in a few minutes.';
    case 'unavailable':
      return 'Accounts are not available right now. Nothing was saved.';
    case 'failed':
      return 'We could not complete that. Nothing was saved — try again.';
    case 'ok':
      return null;
  }
}

/** Підсумок помилки: словом «Error», бо колір без слова не читають усі. */
function ErrorBox({ outcome, children }: { outcome: Outcome | null; children?: ReactNode }) {
  const message = outcome ? messageFor(outcome) : null;
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mt-4 rounded border border-warn/40 bg-warn/5 p-4 text-sm text-ink"
    >
      <p>
        <span className="font-semibold">Error:</span> {message}
      </p>
      {children}
    </div>
  );
}

/** `false` до гідратації: до того форма не робить нічого, і це сказано. */
function ReadyNote({ ready }: { ready: boolean }) {
  if (ready) return null;
  return (
    <p className="mt-2 text-sm text-ink-2">
      The form comes alive when the page finishes loading.
    </p>
  );
}

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-wrap px-4 py-10 xl:px-6">
      <h1 className="text-3xl font-bold leading-tight md:text-[42px]">{title}</h1>
      {children}
    </main>
  );
}

// ── Реєстрація ───────────────────────────────────────────────────────

export type SignupDraft = { email: string; password: string; newsletter: boolean };
export const EMPTY_SIGNUP: SignupDraft = { email: '', password: '', newsletter: false };

export function SignupFormView({
  draft,
  error,
  busy,
  ready,
  onEdit,
  onSubmit,
}: {
  draft: SignupDraft;
  error: Outcome | null;
  busy: boolean;
  ready: boolean;
  onEdit: <K extends keyof SignupDraft>(field: K, value: SignupDraft[K]) => void;
  onSubmit: () => void;
}) {
  return (
    <Shell title="Create an account">
      <p className="mt-4 max-w-prose text-ink-2">
        One address and a password. Nothing else is required.
      </p>
      <form
        noValidate
        className={PANEL}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <ReadyNote ready={ready} />
        <ErrorBox outcome={error}>
          {error?.kind === 'taken' && (
            <p className="mt-2">
              <Link className={LINK} href="/login">
                Sign in
              </Link>{' '}
              or{' '}
              <Link className={LINK} href="/forgot-password">
                reset the password
              </Link>
              .
            </p>
          )}
        </ErrorBox>

        <div className="mt-4">
          <label className={LABEL} htmlFor="signup-email">
            Email
          </label>
          <input
            id="signup-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={!ready || busy}
            value={draft.email}
            onChange={(e) => onEdit('email', e.target.value)}
            className={FIELD}
          />
        </div>

        <div className="mt-4">
          <label className={LABEL} htmlFor="signup-password">
            Password
          </label>
          <input
            id="signup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby="signup-password-hint"
            disabled={!ready || busy}
            value={draft.password}
            onChange={(e) => onEdit('password', e.target.value)}
            className={FIELD}
          />
          {/* 🔴 Одна вимога — довжина, і сказано, що інших немає. Макет:
              «Ніяких „обовʼязково велика літера і цифра": це женить людей
              на Password1!». Список найпоширеніших відсіює сервер. */}
          <p id="signup-password-hint" className={HINT}>
            At least {MIN_PASSWORD} characters. That is the only rule; we turn
            away only the most common passwords.
          </p>
        </div>

        {/* 🔴 ГАЛОЧКА РОЗСИЛКИ — ПОРОЖНЯ, І НЕ `defaultChecked`. Заздалегідь
            поставлена галочка згодою не рахується (CJEU, Planet49,
            C-673/17). Значення береться зі стану, який починається з
            `false`; `checked` у виданому HTML відсутній, і тест читає саме
            його. */}
        <div className="mt-5 flex items-start gap-3">
          <input
            id="signup-newsletter"
            name="newsletter"
            type="checkbox"
            checked={draft.newsletter}
            disabled={!ready || busy}
            onChange={(e) => onEdit('newsletter', e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-line"
          />
          <label htmlFor="signup-newsletter" className="text-sm text-ink-2">
            I want emails about new routes and guides. No more than once a month.
          </label>
        </div>

        {/* 🔴 УМОВИ — РЯДОК ТЕКСТУ З ЛІНКАМИ, І ГАЛОЧКИ ТУТ НЕМАЄ НАВМИСНО.
            Підстава — не згода, а договір (GDPR ст. 6(1)(b)): без нього
            акаунта немає. Галочка на обовʼязковому створює ілюзію вибору
            там, де вибору нема. Це контрінтуїтивно, і саме тому записано. */}
        <p className="mt-5 text-sm text-ink-2">
          By creating an account you accept the{' '}
          <Link className={LINK} href="/legal/terms">
            Terms
          </Link>{' '}
          and the{' '}
          <Link className={LINK} href="/legal/privacy">
            Privacy Policy
          </Link>
          .
        </p>

        <button type="submit" disabled={!ready || busy} className={BUTTON}>
          Create account
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-2">
        Already have an account?{' '}
        <Link className={LINK} href="/login">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}

/** Кнопка «надіслати ще раз» і відлік. Спільна для всіх станів «лист пішов». */
function ResendRow({
  secondsLeft,
  busy,
  error,
  onResend,
}: {
  secondsLeft: number;
  busy: boolean;
  error: Outcome | null;
  onResend: () => void;
}) {
  return (
    <div className="mt-5 text-sm text-ink-2">
      <ErrorBox outcome={error} />
      {secondsLeft > 0 ? (
        <p>Not there? You can send it again in {clock(secondsLeft)}.</p>
      ) : (
        <p>
          Not there?{' '}
          <button
            type="button"
            disabled={busy}
            onClick={onResend}
            className="underline disabled:opacity-60"
          >
            Send it again
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * Після реєстрації: «Підтвердьте пошту».
 *
 * 🔴 ТЕКСТ ПРО МАРШРУТ СВІДОМО ВІДСУТНІЙ. Макет тут каже «Ваш маршрут уже
 * збережено», але зберігати поки нічого: ендпоінта збереження маршруту
 * немає (планувальник не рахує, `/plan`), чернеток теж. Фраза про
 * збережене без збереженого — це твердження про те, чого сторінка не
 * бачить. Лишилась та частина, що правдива завжди: людина вже ввійшла, і
 * підтвердження пошти її ні від чого не відсікає. Коли зʼявиться
 * збереження (CAMP-227), заголовок повертається, і лише за наявності
 * збереженого.
 */
export function SignupDoneView({
  email,
  secondsLeft,
  busy,
  error,
  onResend,
}: {
  email: string;
  secondsLeft: number;
  busy: boolean;
  error: Outcome | null;
  onResend: () => void;
}) {
  return (
    <Shell title="Confirm your email">
      <div className={PANEL}>
        <p>
          We sent a letter to <strong className="break-all text-heading">{email}</strong>.
          Open it and press the button. The link works once and for{' '}
          {LINK_MINUTES} minutes.
        </p>
        <ResendRow secondsLeft={secondsLeft} busy={busy} error={error} onResend={onResend} />
      </div>
      <div className="mt-4 max-w-md rounded-card border border-line-blue bg-accent-surface p-5 text-sm text-heading">
        <p className="font-semibold">You are signed in.</p>
        <p className="mt-1">
          Confirming your email does not stop you doing anything here. We will
          only ask for it before something you do becomes public.
        </p>
      </div>
      <p className="mt-4 text-sm text-ink-2">
        <Link className={LINK} href="/">
          Continue to the site
        </Link>
      </p>
    </Shell>
  );
}

// ── Вхід ──────────────────────────────────────────────────────────────

export function LoginFormView({
  draft,
  error,
  busy,
  ready,
  onEdit,
  onSubmit,
}: {
  draft: { email: string; password: string };
  error: Outcome | null;
  busy: boolean;
  ready: boolean;
  onEdit: (field: 'email' | 'password', value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Shell title="Sign in">
      <form
        noValidate
        className={PANEL}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <ReadyNote ready={ready} />
        <ErrorBox outcome={error} />
        <div className="mt-4">
          <label className={LABEL} htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={!ready || busy}
            value={draft.email}
            onChange={(e) => onEdit('email', e.target.value)}
            className={FIELD}
          />
        </div>
        <div className="mt-4">
          <label className={LABEL} htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={!ready || busy}
            value={draft.password}
            onChange={(e) => onEdit('password', e.target.value)}
            className={FIELD}
          />
        </div>
        <button type="submit" disabled={!ready || busy} className={BUTTON}>
          Sign in
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-2">
        <Link className={LINK} href="/forgot-password">
          Forgot your password?
        </Link>{' '}
        · No account?{' '}
        <Link className={LINK} href="/signup">
          Create one
        </Link>
      </p>
    </Shell>
  );
}

export function LoginDoneView() {
  return (
    <Shell title="You are signed in">
      <p className="mt-4 text-ink-2">
        <Link className={LINK} href="/">
          Continue to the site
        </Link>
      </p>
    </Shell>
  );
}

// ── Забули пароль ────────────────────────────────────────────────────

export function ForgotFormView({
  email,
  error,
  busy,
  ready,
  onEdit,
  onSubmit,
}: {
  email: string;
  error: Outcome | null;
  busy: boolean;
  ready: boolean;
  onEdit: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Shell title="Reset your password">
      <form
        noValidate
        className={PANEL}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <ReadyNote ready={ready} />
        <ErrorBox outcome={error} />
        <div className="mt-4">
          <label className={LABEL} htmlFor="forgot-email">
            Email
          </label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={!ready || busy}
            value={email}
            onChange={(e) => onEdit(e.target.value)}
            className={FIELD}
          />
        </div>
        <button type="submit" disabled={!ready || busy} className={BUTTON}>
          Send link
        </button>
      </form>
      <p className="mt-4 text-sm text-ink-2">
        Remembered it?{' '}
        <Link className={LINK} href="/login">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}

/**
 * «Перевірте пошту».
 *
 * 🔴 «ЯКЩО АКАУНТ ІЗ ТАКОЮ АДРЕСОЮ ІСНУЄ» — ФОРМУЛЮВАННЯ НАВМИСНЕ, і
 * єдине, що правдиве в обох випадках. «Такої пошти в нас немає»
 * перетворює форму на безкоштовний перелічувач користувачів. Тому цей
 * екран той самий для адреси, яку ми знаємо, і для вигаданої, і не
 * приймає жодного параметра, який міг би їх розрізнити.
 */
export function ForgotSentView({
  secondsLeft,
  busy,
  error,
  onResend,
}: {
  secondsLeft: number;
  busy: boolean;
  error: Outcome | null;
  onResend: () => void;
}) {
  return (
    <Shell title="Check your email">
      <div className={PANEL}>
        <p>
          If an account with that address exists, we have just sent a link to
          it. The link works once and for {LINK_MINUTES} minutes.
        </p>
        <ResendRow secondsLeft={secondsLeft} busy={busy} error={error} onResend={onResend} />
      </div>
    </Shell>
  );
}

// ── Нове значення пароля ─────────────────────────────────────────────

export function ResetFormView({
  password,
  error,
  busy,
  ready,
  onEdit,
  onSubmit,
}: {
  password: string;
  error: Outcome | null;
  busy: boolean;
  ready: boolean;
  onEdit: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Shell title="Choose a new password">
      <form
        noValidate
        className={PANEL}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <ReadyNote ready={ready} />
        <ErrorBox outcome={error} />
        <div className="mt-4">
          <label className={LABEL} htmlFor="reset-password">
            New password
          </label>
          <input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby="reset-password-hint"
            disabled={!ready || busy}
            value={password}
            onChange={(e) => onEdit(e.target.value)}
            className={FIELD}
          />
          <p id="reset-password-hint" className={HINT}>
            At least {MIN_PASSWORD} characters. Setting it signs you out
            everywhere else.
          </p>
        </div>
        <button type="submit" disabled={!ready || busy} className={BUTTON}>
          Set new password
        </button>
      </form>
    </Shell>
  );
}

export function ResetDoneView() {
  return (
    <Shell title="Password changed">
      <p className="mt-4 max-w-prose text-ink-2">
        Your password is changed, and every session of this account was signed
        out.{' '}
        <Link className={LINK} href="/login">
          Sign in with the new password
        </Link>
        .
      </p>
    </Shell>
  );
}

// ── «Посилання застаріло» ────────────────────────────────────────────

/**
 * Прострочене чи використане посилання.
 *
 * 🔴 ТЕКСТ — З МАКЕТА: «Це нормально й нічого не зламало». Людина, яка
 * клацнула другий раз, не зробила помилки, і сторінка не має її в цьому
 * переконувати. Дія — завжди одна: попросити новий лист.
 */
export function StaleLinkView({ children }: { children: ReactNode }) {
  return (
    <Shell title="This link has expired">
      <div className={PANEL}>
        <p>
          This letter is more than {LINK_MINUTES} minutes old, or the link has
          already been used. That is normal and nothing is broken.
        </p>
        {children}
      </div>
    </Shell>
  );
}

// ── Підтвердження пошти за посиланням ────────────────────────────────

export function VerifyingView() {
  return (
    <Shell title="Checking your link">
      <p className="mt-4 text-ink-2">One moment…</p>
    </Shell>
  );
}

export function VerifiedView() {
  return (
    <Shell title="Your email is confirmed">
      <p className="mt-4 text-ink-2">
        Thank you. <Link className={LINK} href="/">Continue to the site</Link>
      </p>
    </Shell>
  );
}

/** Не вдалось дістатись сервера: посилання НЕ витрачене, і це сказано. */
export function VerifyFailedView({ outcome }: { outcome: Outcome }) {
  return (
    <Shell title="We could not check your link">
      <ErrorBox outcome={outcome} />
      <p className="mt-4 max-w-prose text-ink-2">
        The link has not been used up. Reload this page to try again.
      </p>
    </Shell>
  );
}

/** Форма «надіслати новий лист» на сторінці застарілого посилання підтвердження. */
export function ResendVerificationView({
  email,
  sent,
  secondsLeft,
  busy,
  ready,
  error,
  onEdit,
  onSubmit,
}: {
  email: string;
  sent: boolean;
  secondsLeft: number;
  busy: boolean;
  ready: boolean;
  error: Outcome | null;
  onEdit: (value: string) => void;
  onSubmit: () => void;
}) {
  if (sent)
    return (
      <div className="mt-4 text-sm text-ink-2">
        {/* 🔴 Те саме речення, що й після «Забули пароль»: ця форма теж не
            каже, чи є акаунт. */}
        <p>
          If an account with that address is waiting to be confirmed, we have
          just sent it a new letter.
        </p>
        <ResendRow secondsLeft={secondsLeft} busy={busy} error={error} onResend={onSubmit} />
      </div>
    );
  return (
    <form
      noValidate
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <ErrorBox outcome={error} />
      <label className={LABEL} htmlFor="resend-email">
        Email
      </label>
      <input
        id="resend-email"
        name="email"
        type="email"
        autoComplete="email"
        required
        disabled={!ready || busy}
        value={email}
        onChange={(e) => onEdit(e.target.value)}
        className={FIELD}
      />
      <button type="submit" disabled={!ready || busy} className={BUTTON}>
        Send a new email
      </button>
    </form>
  );
}
