'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { loadCabinet, type CabinetState, type Profile } from '@/lib/cabinet';
import { rememberReturn } from '@/lib/return-path';
import {
  CABINET_TITLE,
  CabinetErrorView,
  CabinetView,
  CheckingView,
  SignedOutView,
} from '@/components/account-cabinet-view';

// CAMP-229 — стан кабінету. Тонка обгортка: правила — в lib/cabinet.ts
// (хто ввійшов) і lib/return-path.ts (куди повернути), розмітка — в
// account-cabinet-view.tsx; це лише з'єднує їх із React.
//
// 🔴 ЦЕ ЄДИНЕ МІСЦЕ, ДЕ ПИШЕТЬСЯ МІСЦЕ ПОВЕРНЕННЯ. Сторінка за логіном, яка
// побачила «ви не ввійшли», запамʼятовує СВОЮ адресу (`location`, а не що б то
// не було з рядка запиту) і йде на /login. Куди саме повертатись після входу,
// вирішує `takeReturn` у формі входу, з того, що тут записано. Друге місце, що
// писало б у це сховище, було б другою дірою; перше перевіряє те, що пише.
//
// 🔴 КАБІНЕТ НІЧОГО НЕ ПОКАЗУЄ, ПОКИ СЕРВЕР НЕ СКАЗАВ, ХТО ЦЕ. Токен у сховищі —
// це лише заява; профіль приходить від `GET /auth/me`. Видана сторінка (до
// гідратації) — заголовок і «Checking your sign-in…», і саме це бачить будь-хто,
// кому JS не виконався: ні чужих даних, ні порожнього кабінету, що вдає, ніби
// людина ввійшла.

// 🔴 CAMP-229 (3/3): ЦЕЙ СТАН — ВОРОТА, А НЕ ЛИШЕ КАБІНЕТ. Дві нові сторінки
// («Ваші дані», «Видалити акаунт») мають той самий захист: нічого не малювати, доки
// сервер не назвав людину; без сесії — запамʼятати, звідки, і на /login. Друга копія
// цієї логіки була б другим місцем, що пише місце повернення; тож вона одна, тут, а
// кабінет і дві нові сторінки — три відповіді на питання «що показати, коли людину
// названо». Заголовок станів «перевіряємо / не ввійшли / помилка» — заголовок
// СТОРІНКИ, на якій ворота стоять: виданий `<h1>` мусить дорівнювати хлібній крихті.

export function AccountGate({
  title = CABINET_TITLE,
  children,
}: {
  title?: string;
  children: (profile: Profile) => ReactNode;
}) {
  const router = useRouter();
  // В ref, а не в залежностях ефекту: щоб зміна обʼєкта роутера не повторювала
  // запит до API. Ефект залежить лише від того, що справді вимагає нового запиту.
  const routerRef = useRef(router);
  routerRef.current = router;
  const [state, setState] = useState<CabinetState>({ kind: 'checking' });
  // Щоразу, коли людина натискає «Try again», запит відбувається наново.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadCabinet().then((next) => {
      if (cancelled) return;
      setState(next);
      if (next.kind === 'signed-out') {
        // Адреса ЦІЄЇ сторінки: шлях і запит такими, якими їх бачить браузер.
        // Що не годиться як місце повернення, `rememberReturn` не запише, і
        // після входу людина піде на типове місце.
        rememberReturn(window.location.pathname + window.location.search);
        routerRef.current.replace('/login');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'checking' });
    setAttempt((n) => n + 1);
  }, []);

  switch (state.kind) {
    case 'ready':
      return <>{children(state.profile)}</>;
    case 'signed-out':
      return <SignedOutView title={title} />;
    case 'unavailable':
    case 'failed':
      return <CabinetErrorView kind={state.kind} onRetry={retry} title={title} />;
    case 'checking':
      return <CheckingView title={title} />;
  }
}

export function AccountCabinet() {
  return <AccountGate>{(profile) => <CabinetView profile={profile} />}</AccountGate>;
}
