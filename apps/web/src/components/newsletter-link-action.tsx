"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { Block } from "@/components/layout";
import { Shell } from "@/components/account-view";
import { NewsletterResultView } from "@/components/newsletter-result";
import {
  sendLinkAction,
  tokenFrom,
  type LinkAction,
  type LinkOutcome,
} from "@/lib/newsletter-form";

// Посилання з листа підписки відкриває ЦЮ сторінку.
//
// 🔴 ВІДКРИТТЯ НІЧОГО НЕ МІНЯЄ — ні на сервері, ні тут. Поштові сканери (Safe
// Links, проксі Gmail, корпоративні шлюзи) відкривають усі посилання листа
// самі й іноді виконують скрипти сторінки; тому єдиний виклик API
// (`sendLinkAction`) стоїть ВИКЛЮЧНО в обробнику кнопки, а `useEffect` лише
// читає токен з адреси. Тест `newsletter-form.spec.tsx` читає цей файл і
// падає, якщо виклик перебереться в ефект.
//
// 🔴 БЕЗ JAVASCRIPT СТОРІНКА НІЧОГО НЕ РОБИТЬ, І ЦЕ СКАЗАНО: кнопка вимкнена,
// `<noscript>` дає адресу, на яку писати. Токен вирізається з адреси лише в
// пам'яті сторінки й нікуди не логується; сторінка віддається з
// `Referrer-Policy: no-referrer`.

const COPY: Record<LinkAction, { title: string; sentence: string; button: string }> = {
  confirm: {
    title: "Confirm your subscription",
    sentence:
      "Press the button to confirm that CampTribe may send you occasional news at the address this letter was sent to. Until you do, you are not subscribed.",
    button: "Confirm my subscription",
  },
  unsubscribe: {
    title: "Unsubscribe",
    sentence:
      "Press the button to stop CampTribe letters to the address this letter was sent to.",
    button: "Unsubscribe",
  },
};

export const LINK_TITLES: Record<LinkAction, string> = {
  confirm: COPY.confirm.title,
  unsubscribe: COPY.unsubscribe.title,
};

const FAILURE: Record<Exclude<LinkOutcome, "done" | "invalid">, string> = {
  throttled: "Enough requests from this connection for now. Please try again in a few minutes.",
  unavailable: "This is not available right now. Nothing was changed.",
  failed: "We could not do that just now. Nothing was changed; please try again in a little while.",
};

type Phase =
  | { kind: "idle"; problem: string | null }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "invalid" };

export default function NewsletterLinkAction({ action }: { action: LinkAction }) {
  const [token, setToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle", problem: null });
  const started = useRef(false);

  // Читає адресу — і ТІЛЬКИ читає.
  useEffect(() => {
    setToken(tokenFrom(window.location.search));
  }, []);

  const press = async () => {
    if (started.current || !token) return;
    started.current = true;
    setPhase({ kind: "working" });
    const outcome = await sendLinkAction(action, token);
    if (outcome === "done") setPhase({ kind: "done" });
    else if (outcome === "invalid") setPhase({ kind: "invalid" });
    else {
      started.current = false;
      setPhase({ kind: "idle", problem: FAILURE[outcome] });
    }
  };

  if (phase.kind === "done")
    return <NewsletterResultView state={action === "confirm" ? "confirmed" : "unsubscribed"} />;
  if (phase.kind === "invalid" || token === "")
    return <NewsletterResultView state="link-invalid" />;

  const copy = COPY[action];
  const disabled = token === null || phase.kind === "working";
  return (
    <Shell title={copy.title}>
      <Block as="p" measure="read" className="mt-4 text-ink-2">
        {copy.sentence}
      </Block>
      <noscript>
        <p className="mt-3 text-ink-2">
          This page needs JavaScript to do anything. To subscribe or unsubscribe without it, write
          to privacy@camptribe.eu.
        </p>
      </noscript>
      {phase.kind === "idle" && phase.problem && (
        <p role="alert" className="mt-3 text-sm text-warn">
          <span className="font-semibold">Error:</span> {phase.problem}
        </p>
      )}
      <p className="mt-5">
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={disabled}
          onClick={() => void press()}
        >
          {phase.kind === "working" ? "One moment…" : copy.button}
        </Button>
      </p>
    </Shell>
  );
}
