'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { needsLogin, pauseForLogin } from '@/lib/auth-wall';
import {
  confirmOwnerLink,
  emailLooksUsable,
  startOwnerLink,
  tokenFromSearch,
  type OwnerOutcome,
} from '@/lib/owner-verify';
import {
  OwnerConfirmView,
  OwnerDoneView,
  OwnerEmailView,
  OwnerNoTokenView,
  OwnerSentView,
  ownerMessage,
} from '@/components/owner-verify-view';
import { ClaimForm } from '@/components/claim-form';
import { NoSpotView } from '@/components/claim-view';

// CAMP-505 — стан сторінок «Це мій кемпінг». Тонка обгортка: правила в
// lib/owner-verify.ts, розмітка в owner-verify-view.tsx.

function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

/** /account/claim: за замовчуванням — пошта на домені кемпінгу; `via=osm` — код із CAMP-51. */
export function ClaimEntry() {
  const params = useSearchParams();
  if (params.get('via') === 'osm') return <ClaimForm />;
  return <OwnerEmailForm />;
}

export function OwnerEmailForm() {
  const ready = useReady();
  const router = useRouter();
  const params = useSearchParams();
  const spot = params.get('spot') ?? '';
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [outcome, setOutcome] = useState<OwnerOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  if (spot === '') return <NoSpotView />;
  if (sent) return <OwnerSentView spot={spot} />;

  async function send() {
    if (!emailLooksUsable(email)) {
      setOutcome({
        kind: 'refused',
        code: 'bad_email',
        message: 'That does not look like an email address.',
      });
      return;
    }
    setBusy(true);
    try {
      const res = await startOwnerLink(spot, email);
      // CAMP-227: вхід — пауза посеред дії; повернення — на ЦЮ сторінку.
      if (needsLogin(res.kind)) {
        pauseForLogin(
          { pathname: window.location.pathname, search: window.location.search },
          (to) => router.replace(to),
        );
        return;
      }
      if (res.kind === 'accepted') {
        setSent(true);
        return;
      }
      setOutcome(res);
    } finally {
      setBusy(false);
    }
  }

  return (
    <OwnerEmailView
      spot={spot}
      email={email}
      busy={busy}
      ready={ready}
      onEmail={setEmail}
      onSend={() => void send()}
      message={ownerMessage(outcome)}
    />
  );
}

/** /account/claim/confirm: сторінка, куди веде лист. Лише клік підтверджує. */
export function OwnerConfirm() {
  const ready = useReady();
  const router = useRouter();
  const params = useSearchParams();
  const token = tokenFromSearch(`?${params.toString()}`);
  const [done, setDone] = useState<{ name: string | null } | null>(null);
  const [outcome, setOutcome] = useState<OwnerOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  if (token === '') return <OwnerNoTokenView />;
  if (done) return <OwnerDoneView name={done.name} />;

  async function confirm() {
    setBusy(true);
    try {
      const res = await confirmOwnerLink(token);
      if (needsLogin(res.kind)) {
        pauseForLogin(
          { pathname: window.location.pathname, search: window.location.search },
          (to) => router.replace(to),
        );
        return;
      }
      if (res.kind === 'confirmed') {
        setDone({ name: res.name });
        return;
      }
      setOutcome(res);
    } finally {
      setBusy(false);
    }
  }

  return (
    <OwnerConfirmView
      busy={busy}
      ready={ready}
      onConfirm={() => void confirm()}
      message={ownerMessage(outcome)}
    />
  );
}
