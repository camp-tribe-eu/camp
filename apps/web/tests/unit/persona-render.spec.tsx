import { expect, test } from '@playwright/test';

import RouteRental from '@/components/route-rental';
import { SiteHeader } from '@/components/site-chrome';
import type { SectionView } from '@/lib/page-content';
import { personaLabels } from '@/lib/persona-labels';
import { renderComponent } from './render-component';

/**
 * CAMP-501 — що перемикач каже у ВІДДАНІЙ розмітці. Підписи — із CMS
 * (секції сторінки `persona-switch`), а не з JSX; порожнє не малюється.
 */

const sec = (slot: string, heading: string | null, body: string | null = null): SectionView => ({
  type: 'prose', variant: null, slot, heading, subheading: null, body,
  imageUrl: null, imageAlt: null, ctaHref: null, ctaLabel: null, items: [],
});

const CMS = [
  sec('switch-label', 'Слова групи із CMS'),
  sec('owner', 'Кнопка власника із CMS'),
  sec('renter', 'Кнопка орендаря із CMS'),
  sec('route-rental', 'Заголовок оренди із CMS', 'Текст оренди із CMS'),
];

test('підписи перемикача у відданій шапці — із CMS, обидві кнопки', () => {
  const html = renderComponent(SiteHeader, { nav: [], persona: personaLabels(CMS) });
  expect(html).toContain('data-testid="persona-owner"');
  expect(html).toContain('data-testid="persona-renter"');
  expect(html).toContain('Кнопка власника із CMS');
  expect(html).toContain('Кнопка орендаря із CMS');
  expect(html).toContain('aria-label="Слова групи із CMS"');
});

test('без підпису в CMS перемикач не малюється, а не малюється з порожнім', () => {
  for (const slot of ['switch-label', 'owner', 'renter']) {
    const cut = CMS.filter((s) => s.slot !== slot);
    expect(personaLabels(cut), `без «${slot}» усе одно щось малюється`).toBeNull();
    expect(renderComponent(SiteHeader, { nav: [], persona: personaLabels(cut) })).not.toContain(
      'persona-toggle',
    );
  }
  expect(personaLabels([...CMS.filter((s) => s.slot !== 'owner'), sec('owner', '')])).toBeNull();
});

test('блок оренди маршруту: позначений для орендаря, зі словами CMS і посиланнями', () => {
  const html = renderComponent(RouteRental, {
    section: CMS[3],
    countries: [{ code: 'hr', name: 'Croatia' }, { code: 'si', name: 'Slovenia' }],
  });
  expect(html).toContain('data-persona-only="renter"');
  expect(html).toContain('Заголовок оренди із CMS');
  expect(html).toContain('Текст оренди із CMS');
  expect(html).toContain('href="/camper-rental/hr"');
  expect(html).toContain('href="/camper-rental/si"');
});

test('порожнє не малюємо: немає слів або немає жодної сторінки оренди — блока нема', () => {
  expect(renderComponent(RouteRental, { section: null, countries: [{ code: 'hr', name: 'Croatia' }] })).toBe('');
  expect(renderComponent(RouteRental, { section: sec('route-rental', null), countries: [{ code: 'hr', name: 'Croatia' }] })).toBe('');
  expect(renderComponent(RouteRental, { section: CMS[3], countries: [] })).toBe('');
});
