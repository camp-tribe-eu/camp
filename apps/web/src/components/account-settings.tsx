'use client';

import { useCallback, useEffect, useState } from 'react';
import { AccountGate } from '@/components/account-cabinet';
import {
  SETTINGS_TITLE,
  SettingsErrorView,
  SettingsLoadingView,
  SettingsView,
} from '@/components/account-settings-view';
import {
  changePassword,
  loadSettings,
  requestEmailChange,
  setLetters,
  type Settings,
} from '@/lib/settings';

// CAMP-229 — стан сторінки налаштувань. Тонка обгортка: правила — у
// `lib/settings.ts`, розмітка — в `account-settings-view.tsx`.
//
// 🔴 ВОРОТА ТІ САМІ, ЩО В КАБІНЕТУ. `AccountGate` — єдине місце, яке пише
// місце повернення перед /login; друга копія цієї логіки була б другою
// дірою. Тому сторінка не питає «чи ввійшов» сама.

type Note = { tone: 'calm' | 'bad'; text: string } | null;

const WENT_WRONG = 'Something went wrong. Nothing was changed.';

/** Відповіді, спільні для всіх трьох форм. */
function commonNote(kind: string): Note {
  if (kind === 'signed-out')
    return { tone: 'bad', text: 'Your session has ended. Sign in again.' };
  if (kind === 'unavailable')
    return { tone: 'bad', text: 'Accounts are not available right now. Nothing was changed.' };
  return { tone: 'bad', text: WENT_WRONG };
}

function Inner() {
  const [state, setState] = useState<Settings | null>(null);
  const [broken, setBroken] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((out) => {
      if (cancelled) return;
      if (out.kind === 'ok') setState(out.value);
      else setBroken(true);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setBroken(false);
    setState(null);
    setAttempt((n) => n + 1);
  }, []);

  // ── пошта ──────────────────────────────────────────────────────────────
  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailNote, setEmailNote] = useState<Note>(null);

  async function submitEmail() {
    setEmailBusy(true);
    setEmailNote(null);
    const out = await requestEmailChange(emailPassword, newEmail);
    setEmailBusy(false);
    if (out.kind === 'sent') {
      // 🔴 Речення, однаково правдиве і для вільної адреси, і для зайнятої:
      // сервер навмисно не розрізняє їх, і екран не повинен вдавати, ніби
      // знає більше.
      setEmailNote({
        tone: 'calm',
        text: `If ${newEmail} can receive letters, a confirmation is on its way to it. Nothing changes until you open the link.`,
      });
      setEmailPassword('');
      return;
    }
    if (out.kind === 'wrong-password')
      return setEmailNote({ tone: 'bad', text: 'That password is not right. Nothing was changed.' });
    if (out.kind === 'bad-email')
      return setEmailNote({ tone: 'bad', text: 'That does not look like an email address.' });
    if (out.kind === 'same-email')
      return setEmailNote({ tone: 'bad', text: 'That is already the address on this account.' });
    if (out.kind === 'throttled')
      return setEmailNote({
        tone: 'bad',
        text: `A letter was sent a moment ago. Try again in ${out.retryAfter} seconds.`,
      });
    setEmailNote(commonNote(out.kind));
  }

  // ── пароль ─────────────────────────────────────────────────────────────
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwNote, setPwNote] = useState<Note>(null);

  async function submitPassword() {
    setPwBusy(true);
    setPwNote(null);
    const out = await changePassword(current, next);
    setPwBusy(false);
    if (out.kind === 'ok') {
      // Поля чистяться: лишати пароль у полі після успіху — лишати його на
      // екрані й у памʼяті довше, ніж потрібно.
      setCurrent('');
      setNext('');
      return setPwNote({
        tone: 'calm',
        text: 'Your password is changed, and every other browser has been signed out.',
      });
    }
    if (out.kind === 'wrong-password')
      return setPwNote({ tone: 'bad', text: 'That password is not right. Nothing was changed.' });
    if (out.kind === 'weak') return setPwNote({ tone: 'bad', text: out.message });
    if (out.kind === 'throttled')
      return setPwNote({ tone: 'bad', text: 'Too many attempts. Try again in a few minutes.' });
    setPwNote(commonNote(out.kind));
  }

  // ── листи ──────────────────────────────────────────────────────────────
  const [lettersBusy, setLettersBusy] = useState(false);
  const [lettersNote, setLettersNote] = useState<Note>(null);

  async function toggleLetters(on: boolean) {
    setLettersBusy(true);
    setLettersNote(null);
    const out = await setLetters(on);
    setLettersBusy(false);
    if (out.kind === 'ok') {
      // 🔴 Стан — той, що підтвердив сервер, а не той, на що натиснули.
      setState((s) => (s === null ? s : { ...s, letters: out.letters }));
      return;
    }
    // 🔴 CAMP-390: текст біля перемикача змінився, поки сторінка була відкрита.
    // Перемикач лишається таким, яким його підтвердив сервер.
    if (out.kind === 'wording-changed')
      return setLettersNote({
        tone: 'bad',
        text: 'The text next to this switch has changed since the page was opened. Reload the page and read it again. Nothing was changed.',
      });
    setLettersNote(commonNote(out.kind));
  }

  if (broken) return <SettingsErrorView onRetry={retry} />;
  if (state === null) return <SettingsLoadingView />;

  return (
    <SettingsView
      email={{
        current: state.email,
        verified: state.emailVerified,
        value: newEmail,
        password: emailPassword,
        busy: emailBusy,
        note: emailNote,
        onEdit: setNewEmail,
        onPassword: setEmailPassword,
        onSubmit: submitEmail,
      }}
      password={{
        current,
        next,
        busy: pwBusy,
        note: pwNote,
        onCurrent: setCurrent,
        onNext: setNext,
        onSubmit: submitPassword,
      }}
      letters={{
        on: state.letters,
        busy: lettersBusy,
        note: lettersNote,
        onToggle: toggleLetters,
      }}
    />
  );
}

export function AccountSettings() {
  return (
    <AccountGate title={SETTINGS_TITLE}>
      {() => <Inner />}
    </AccountGate>
  );
}
