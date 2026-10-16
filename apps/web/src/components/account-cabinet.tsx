'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCabinet, type CabinetState } from '@/lib/cabinet';
import { rememberReturn } from '@/lib/return-path';
import {
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

export function AccountCabinet() {
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
      return <CabinetView profile={state.profile} />;
    case 'signed-out':
      return <SignedOutView />;
    case 'unavailable':
    case 'failed':
      return <CabinetErrorView kind={state.kind} onRetry={retry} />;
    case 'checking':
      return <CheckingView />;
  }
}
