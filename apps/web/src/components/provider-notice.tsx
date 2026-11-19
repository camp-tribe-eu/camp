import Link from 'next/link';
import { Block } from '@/components/layout';
import { PROVIDER_NOTICE } from '@/lib/legal';

/**
 * CAMP-489: «ми інформаційний сервіс, не навігація» — там, де читач приймає
 * рішення в дорозі за нашими числами (планувальник, калькулятор вартості).
 * Текст — дослівно абзац із /legal/disclaimer#information; посилання веде
 * туди ж, де він повний і під версією.
 */
export function ProviderNotice({ className = 'mt-4' }: { className?: string }) {
  return (
    <Block
      as="p"
      measure="read"
      data-testid="provider-notice"
      className={`${className} text-sm text-ink-2`}
    >
      <span data-testid="provider-notice-text">{PROVIDER_NOTICE}</span>{' '}
      <Link href="/legal/disclaimer#information" className="underline">
        What we do and do not know
      </Link>
      .
    </Block>
  );
}
