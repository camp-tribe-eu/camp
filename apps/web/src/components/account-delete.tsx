'use client';

import { useState } from 'react';
import { AccountGate } from '@/components/account-cabinet';
import {
  DELETE_TITLE,
  DeleteFormView,
  DeletedView,
  type DeleteProblem,
} from '@/components/account-delete-view';
import { EMPTY_DELETE, deleteMyAccount, type DeleteDraft } from '@/lib/rights';
import { useReady } from '@/components/use-ready';

// CAMP-229 (3/3) — стан екрана видалення. Тонка обгортка: що можна надіслати — в
// lib/rights.ts (`canDelete`, `deleteMyAccount`), розмітка — в account-delete-view.tsx.
//
// 🔴 ФОРМА СТАРТУЄ З `EMPTY_DELETE`: доля фото не обрана, пароль порожній, «розумію» не
// поставлено. Нічого тут не підставляє «розумне типове значення», і саме цей компонент
// у цьому стані рендерить тест, щоб прочитати HTML (tests/unit/account-delete.spec.tsx).

/** Сесія, яку сервер визнав мертвою посеред дії: перечитати сторінку, ворота самі поведуть на /login. */
const startOver = () => window.location.reload();

export function AccountDelete() {
  return (
    <AccountGate title={DELETE_TITLE}>{(profile) => <DeleteFlow email={profile.email} />}</AccountGate>
  );
}

export function DeleteFlow({ email }: { email: string }) {
  const ready = useReady();
  const [draft, setDraft] = useState<DeleteDraft>(EMPTY_DELETE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DeleteProblem | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const out = await deleteMyAccount(draft);
    setBusy(false);
    switch (out.kind) {
      case 'ok':
        setDone(out.restorableUntil);
        return;
      case 'signed-out':
        return startOver();
      case 'wrong-password':
        // Той самий екран, вибір збережено; а що людина набрала, стирається.
        setDraft((d) => ({ ...d, password: '' }));
        setError('wrong-password');
        return;
      case 'incomplete':
        setError('incomplete');
        return;
      case 'throttled':
        setError('throttled');
        return;
      case 'unavailable':
        setError('unavailable');
        return;
      case 'failed':
        setError('failed');
    }
  }

  if (done !== null) return <DeletedView restorableUntil={done} />;
  return (
    <DeleteFormView
      email={email}
      draft={draft}
      error={error}
      busy={busy}
      ready={ready}
      onEdit={(field, value) => setDraft((d) => ({ ...d, [field]: value }))}
      onSubmit={submit}
    />
  );
}
