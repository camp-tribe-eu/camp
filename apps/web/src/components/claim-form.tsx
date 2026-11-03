'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  canAskAgain,
  codeLooksComplete,
  confirmClaim,
  nextStep,
  startClaim,
  type ClaimOutcome,
  type ClaimStep,
} from '@/lib/spot-claim';
import {
  AskView,
  CodeView,
  DoneView,
  NoSpotView,
  messageFor,
} from '@/components/claim-view';

// CAMP-51 — стан сторінки заявки. Тонка обгортка: правила в
// lib/spot-claim.ts, розмітка в claim-view.tsx, тут лише React і мережа.

/** Мітка «форма ожила»: до гідратації поля вимкнені (як на /plan). */
function useReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

export function ClaimForm() {
  const ready = useReady();
  const params = useSearchParams();
  const spot = params.get('spot') ?? '';
  const [step, setStep] = useState<ClaimStep>('ask');
  const [outcome, setOutcome] = useState<ClaimOutcome | null>(null);
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (spot === '') return <NoSpotView />;

  async function run(action: () => Promise<ClaimOutcome>) {
    setBusy(true);
    try {
      const res = await action();
      setOutcome(res);
      if (res.kind === 'sent') {
        setSentTo(res.sentTo);
        // 🔴 Новий лист — новий код: старе поле лишилося б наполовину
        // набраним і дало б «wrong_code» на свіжому коді.
        setCode('');
      }
      setStep((s) => nextStep(s, res));
    } finally {
      setBusy(false);
    }
  }

  const send = () => void run(() => startClaim(spot));
  const confirm = () => void run(() => confirmClaim(spot, code));
  const message = messageFor(outcome);

  if (step === 'done') return <DoneView spot={spot} />;
  if (step === 'code') {
    return (
      <CodeView
        spot={spot}
        sentTo={sentTo}
        code={code}
        busy={busy}
        ready={ready}
        // Кнопка «Confirm» вмикається на повному коді; «новий код» —
        // лише коли API само сказало, що старий більше не годиться.
        canSend={codeLooksComplete(code) || canAskAgain(outcome)}
        onCode={setCode}
        onConfirm={confirm}
        onSend={send}
        message={message}
      />
    );
  }
  return (
    <AskView
      spot={spot}
      busy={busy}
      ready={ready}
      onSend={send}
      message={message}
    />
  );
}
