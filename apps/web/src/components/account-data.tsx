'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountGate } from '@/components/account-cabinet';
import { DATA_TITLE, DataView, type DownloadProblem } from '@/components/account-data-view';
import {
  archiveFrom,
  askForExport,
  getExportFile,
  getExportStatus,
  type ArchiveState,
  type StatusCall,
} from '@/lib/rights';
import { saveTextFile } from '@/lib/save-file';
import { useReady } from '@/components/use-ready';

// CAMP-229 (3/3) — стан сторінки «Ваші дані». Тонка обгортка: правила — в
// lib/rights.ts, розмітка — в account-data-view.tsx, а це лише з'єднує їх із React.
//
// 🔴 «АРХІВ ГОТУЄТЬСЯ» — СПРАВЖНІЙ СТАН, А НЕ ЗАГЛУШКА. Сервер відповідає на запит
// 202 і готує файл ПІСЛЯ відповіді; статус живе в базі, а не в цій вкладці. Сторінка
// питає його кожні `POLL_MS`, поки він «готується», і тому: закрита й відкрита знову
// сторінка бачить той самий архів; а збій, що трапився після відповіді, приходить як
// `failed`, а не як нескінченне колесо.
//
// 🔴 ТРИ ЗБОЇ ПІДРЯД — ЦЕ «НЕ ВДАЛОСЬ ДІЗНАТИСЬ», А НЕ «НЕ ВИЙШЛО». Один збій опитування
// (мережа моргнула) стан не змінює; три — показують `unreachable` з кнопкою «Try again».
// Це не `failed`: про архів нічого не відомо, і казати «не вдалось приготувати» було б
// твердженням, якого сторінка не бачить.

const POLL_MS = 1500;
const POLL_FAILURES = 3;

/** Сесія, яку сервер визнав мертвою посеред дії: перечитати сторінку, ворота самі поведуть на /login. */
const startOver = () => window.location.reload();

export function AccountData() {
  return <AccountGate title={DATA_TITLE}>{() => <DataFlow />}</AccountGate>;
}

export function DataFlow() {
  const ready = useReady();
  const [archive, setArchive] = useState<ArchiveState>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<DownloadProblem>(null);
  // Скільки опитувань підряд не вдалось, і лічильник, що перезапускає ефект опитування.
  const failures = useRef(0);
  const [tick, setTick] = useState(0);

  /** Відповідь на запит про статус → стан екрана. Єдине місце, де це вирішується. */
  const apply = useCallback((out: StatusCall) => {
    switch (out.kind) {
      case 'ok':
        failures.current = 0;
        setArchive(archiveFrom(out.value));
        return;
      case 'signed-out':
        startOver();
        return;
      case 'unavailable':
        setArchive({ kind: 'unavailable' });
        return;
      default:
        setArchive({ kind: 'unreachable' });
    }
  }, []);

  // Що вже є на сервері: нічого, готується, готове чи не вийшло.
  const look = useCallback(async () => {
    setArchive({ kind: 'checking' });
    apply(await getExportStatus());
  }, [apply]);

  useEffect(() => {
    void look();
  }, [look]);

  useEffect(() => {
    if (archive.kind !== 'preparing') return;
    let cancelled = false;
    const id = setTimeout(async () => {
      const out = await getExportStatus();
      if (cancelled) return;
      if (out.kind === 'signed-out') return startOver();
      if (out.kind === 'ok') return apply(out);
      failures.current += 1;
      if (failures.current >= POLL_FAILURES) {
        failures.current = 0;
        setArchive({ kind: 'unreachable' });
      } else setTick((t) => t + 1);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [archive, tick, apply]);

  async function prepare() {
    setBusy(true);
    setProblem(null);
    apply(await askForExport());
    setBusy(false);
  }

  async function download() {
    setBusy(true);
    setProblem(null);
    const out = await getExportFile();
    setBusy(false);
    switch (out.kind) {
      case 'ok':
        saveTextFile(out.filename, out.text);
        return;
      case 'signed-out':
        return startOver();
      case 'gone':
        // Строк минув, поки сторінка була відкрита: стан змінюється на те, що є насправді.
        setProblem('gone');
        void look();
        return;
      case 'unavailable':
      case 'failed':
        setProblem('failed');
    }
  }

  return (
    <DataView
      archive={archive}
      busy={busy}
      ready={ready}
      problem={problem}
      onPrepare={prepare}
      onDownload={download}
      onRetry={look}
    />
  );
}
