'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  RESEND_SECONDS,
  logIn,
  requestReset,
  resendVerification,
  resetPassword,
  resetStep,
  secondsLeft,
  sentOrWaiting,
  signUp,
  tokenFrom,
  verifyEmail,
  verifyPhase,
  waitUntil,
  type Outcome,
} from '@/lib/account';
import { clearSession, saveSession } from '@/lib/session-store';
import {
  EMPTY_SIGNUP,
  ForgotFormView,
  ForgotSentView,
  LoginDoneView,
  LoginFormView,
  ResendVerificationView,
  ResetDoneView,
  ResetFormView,
  SignupDoneView,
  SignupFormView,
  StaleLinkView,
  VerifiedView,
  VerifyFailedView,
  VerifyingView,
  type SignupDraft,
} from '@/components/account-view';

// CAMP-228 — стан сторінок акаунта. Тонкі обгортки: правила — в
// lib/account.ts, розмітка — в account-view.tsx, а це лише з'єднує їх із
// React і з мережею.
//
// 🔴 ЦЯ СТОРІНКА НІКОЛИ НЕ ПЕРЕЗАВАНТАЖУЄТЬСЯ ПІСЛЯ ДІЇ. Макет каже це
// про модалку входу («Будь-який редірект на /login вбиває файл»), і
// тут воно так само: форма відповідає станом на місці, а не редіректом.

/** Мітка «форма ожила»: до гідратації поля вимкнені (як на /plan). */
function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

/**
 * Відлік: скільки секунд лишилось до `until` (мс епохи), раз на секунду.
 * `null` — відліку немає. Зупиняється на нулі й не тримає таймера після.
 */
function useCountdown(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [until]);
  return until === null ? 0 : secondsLeft(until, now);
}

// ── Реєстрація ───────────────────────────────────────────────────────

export function SignupForm() {
  const ready = useReady();
  const [draft, setDraft] = useState<SignupDraft>(EMPTY_SIGNUP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Outcome | null>(null);
  const [done, setDone] = useState<{ email: string; until: number } | null>(null);
  const [resendError, setResendError] = useState<Outcome | null>(null);
  const left = useCountdown(done?.until ?? null);

  async function submit() {
    setBusy(true);
    setError(null);
    const out = await signUp(draft);
    setBusy(false);
    if (out.kind !== 'ok' || !out.body) return setError(out);
    const { token, expiresAt, email } = out.body as {
      token: string;
      expiresAt: string;
      email: string;
    };
    saveSession({ token, expiresAt, email });
    setDone({ email, until: Date.now() + RESEND_SECONDS * 1000 });
  }

  async function resend() {
    if (!done) return;
    setBusy(true);
    setResendError(null);
    const out = await resendVerification(done.email);
    setBusy(false);
    if (sentOrWaiting(out)) setDone({ ...done, until: waitUntil(out, Date.now()) });
    else setResendError(out);
  }

  if (done)
    return (
      <SignupDoneView
        email={done.email}
        secondsLeft={left}
        busy={busy}
        error={resendError}
        onResend={resend}
      />
    );
  return (
    <SignupFormView
      draft={draft}
      error={error}
      busy={busy}
      ready={ready}
      onEdit={(field, value) => setDraft((d) => ({ ...d, [field]: value }))}
      onSubmit={submit}
    />
  );
}

// ── Вхід ──────────────────────────────────────────────────────────────

export function LoginForm() {
  const ready = useReady();
  const [draft, setDraft] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Outcome | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const out = await logIn(draft.email, draft.password);
    setBusy(false);
    if (out.kind !== 'ok' || !out.body) return setError(out);
    const { token, expiresAt } = out.body as { token: string; expiresAt: string };
    saveSession({ token, expiresAt, email: draft.email.trim().toLowerCase() });
    setDone(true);
  }

  if (done) return <LoginDoneView />;
  return (
    <LoginFormView
      draft={draft}
      error={error}
      busy={busy}
      ready={ready}
      onEdit={(field, value) => setDraft((d) => ({ ...d, [field]: value }))}
      onSubmit={submit}
    />
  );
}

// ── Забули пароль ────────────────────────────────────────────────────

export function ForgotForm() {
  const ready = useReady();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Outcome | null>(null);
  const [sent, setSent] = useState<{ email: string; until: number } | null>(null);
  const [resendError, setResendError] = useState<Outcome | null>(null);
  const left = useCountdown(sent?.until ?? null);

  async function ask(address: string) {
    setBusy(true);
    const out = await requestReset(address);
    setBusy(false);
    return out;
  }

  async function submit() {
    setError(null);
    const out = await ask(email);
    // `too-soon` тут — теж «лист уже пішов»: другий запит за хвилину.
    if (sentOrWaiting(out)) setSent({ email, until: waitUntil(out, Date.now()) });
    else setError(out);
  }

  async function resend() {
    if (!sent) return;
    setResendError(null);
    const out = await ask(sent.email);
    if (sentOrWaiting(out)) setSent({ ...sent, until: waitUntil(out, Date.now()) });
    else setResendError(out);
  }

  if (sent)
    return <ForgotSentView secondsLeft={left} busy={busy} error={resendError} onResend={resend} />;
  return (
    <ForgotFormView
      email={email}
      error={error}
      busy={busy}
      ready={ready}
      onEdit={setEmail}
      onSubmit={submit}
    />
  );
}

// ── Нове значення пароля ─────────────────────────────────────────────

export function ResetForm() {
  const ready = useReady();
  // `null`, поки адресу не прочитано: до того сторінка не знає, чи є що
  // показувати, і не вдає, що знає.
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Outcome | null>(null);
  const [done, setDone] = useState(false);
  const [stale, setStale] = useState(false);

  useEffect(() => setToken(tokenFrom(window.location.search)), []);

  async function submit() {
    if (!token) return;
    setBusy(true);
    setError(null);
    const out = await resetPassword(token, password);
    setBusy(false);
    const step = resetStep(out);
    if (step === 'done') {
      // API щойно закрило всі сесії цього акаунта, і цю теж.
      clearSession();
      setDone(true);
    } else if (step === 'stale') setStale(true);
    else setError(out);
  }

  if (done) return <ResetDoneView />;
  if (stale || token === '')
    return (
      <StaleLinkView>
        <p className="mt-4 text-sm">
          <Link className="underline" href="/forgot-password">
            Ask for a new link
          </Link>
        </p>
      </StaleLinkView>
    );
  return (
    <ResetFormView
      password={password}
      error={error}
      busy={busy}
      ready={ready && token !== null}
      onEdit={setPassword}
      onSubmit={submit}
    />
  );
}

// ── Підтвердження пошти ──────────────────────────────────────────────

type VerifyState =
  | { phase: 'checking' }
  | { phase: 'verified' }
  | { phase: 'stale' }
  | { phase: 'failed'; outcome: Outcome };

export function VerifyEmail() {
  const ready = useReady();
  const [state, setState] = useState<VerifyState>({ phase: 'checking' });
  // 🔴 Один раз. У StrictMode ефект виконується двічі, а друге звернення
  // з тим самим одноразовим токеном дало б «застаріло» людині, чий лист
  // щойно спрацював.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenFrom(window.location.search);
    if (token === '') return setState({ phase: 'stale' });
    verifyEmail(token).then((out) => {
      const phase = verifyPhase(out);
      setState(phase === 'failed' ? { phase, outcome: out } : { phase });
    });
  }, []);

  if (state.phase === 'verified') return <VerifiedView />;
  if (state.phase === 'failed') return <VerifyFailedView outcome={state.outcome} />;
  if (state.phase === 'stale')
    return (
      <StaleLinkView>
        <ResendFromStale ready={ready} />
      </StaleLinkView>
    );
  return <VerifyingView />;
}

/** «Надіслати новий лист» зі сторінки застарілого посилання підтвердження. */
function ResendFromStale({ ready }: { ready: boolean }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Outcome | null>(null);
  const [sent, setSent] = useState<{ email: string; until: number } | null>(null);
  const left = useCountdown(sent?.until ?? null);

  async function submit() {
    const address = sent?.email ?? email;
    setBusy(true);
    setError(null);
    const out = await resendVerification(address);
    setBusy(false);
    if (sentOrWaiting(out)) setSent({ email: address, until: waitUntil(out, Date.now()) });
    else setError(out);
  }

  return (
    <ResendVerificationView
      email={email}
      sent={sent !== null}
      secondsLeft={left}
      busy={busy}
      ready={ready}
      error={error}
      onEdit={setEmail}
      onSubmit={submit}
    />
  );
}
