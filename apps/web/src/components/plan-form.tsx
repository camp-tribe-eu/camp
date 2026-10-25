'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { initialState, planReducer, settle, type PlanField } from '@/lib/plan';
import { planRoute } from '@/lib/plan-source';
import { FIELD_ID, PlanFormView, PlanOutcomePanel } from '@/components/plan-view';

// CAMP-205 — стан /plan. Тонка обгортка: усі правила в lib/plan.ts,
// уся розмітка в plan-view.tsx, а це лише з'єднує їх із React і з
// джерелом.
//
// 🔴 `planRoute` імпортовано тут і ніде більше. Щоб підмінити джерело,
// не треба чіпати ні форму, ні її стани.

export default function PlanForm() {
  const [state, dispatch] = useReducer(planReducer, undefined, initialState);
  const [ready, setReady] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  useEffect(() => setReady(true), []);

  // Запит до джерела, коли є що запитувати. Відповідь на запит, якого вже
  // немає (людина виправила поле, відправила знову), відкидає редюсер —
  // за номером запиту, а не за прапорцем у цьому ефекті. Одне місце для
  // правила, а не два, що тримають одне одного: див. `planReducer`.
  const { run } = state;
  useEffect(() => {
    if (run.phase !== 'pending') return;
    settle(planRoute, run.request).then((outcome) => {
      dispatch({ type: 'settled', id: run.id, outcome });
    });
  }, [run]);

  // 🔴 Після невдалої відправки фокус іде на підсумок помилок: людина з
  // клавіатури чи екранним читачем інакше лишилась би на кнопці й
  // не дізналась би, що щось не так, поки не пройшла б усю форму.
  useEffect(() => {
    if (state.rejected > 0) summary.current?.focus();
  }, [state.rejected]);

  const jump = (field: PlanField) => document.getElementById(FIELD_ID[field])?.focus();

  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
      <PlanFormView
        draft={state.draft}
        errors={state.errors}
        ready={ready}
        summaryRef={summary}
        onEdit={(field, value) => dispatch({ type: 'edit', field, value })}
        onSubmit={() => dispatch({ type: 'submit' })}
        onJump={jump}
      />
      <PlanOutcomePanel run={state.run} />
    </div>
  );
}
