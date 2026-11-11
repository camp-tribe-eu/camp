import { expect, test } from '@playwright/test';

import GuideArticle from '@/components/guide-article';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

/**
 * CAMP-460 — шухляда й сторінка показують ОДНЕ Й ТЕ САМЕ.
 *
 * Власник: «при натисканні на картку навіщо переводити на наступну іншу
 * сторінку якщо ми на цій же можемо… дровер боковий як в темі». Рішення:
 * обидва шляхи, бо гідів у збірці 1 287 сторінок (заміряно на проді
 * 09.11.2026), і шухляда НАТОМІСТЬ сторінок стерла б 1 287 адрес із
 * єдиного каналу, який ми маємо.
 *
 * 🔴 ДВА РЕНДЕРИ ОДНОГО ТЕКСТУ — ЦЕ РІВНО ТА ФОРМА, ДЕ ВМІСТ
 * РОЗХОДИТЬСЯ МОВЧКИ. Тому вміст один — `GuideArticle` — і тут
 * перевіряється, що він несе те, без чого сторінка не має права
 * існувати: позначку походження ПЕРЕД текстом (ст. 50(2) AI Act).
 */

const guide = (over: Record<string, unknown> = {}) =>
  ({
    slug: 'at-tyrol-dogs',
    title: 'Camping with a dog in Tyrol',
    summary: 'What to expect.',
    provenance: 'ai-generated',
    generator: 'camptribe-writer',
    authorName: null,
    authorCredentials: null,
    factsCheckedAt: '2026-10-01',
    publishedAt: '2026-09-01',
    body: 'First paragraph.\n\n- one\n- two',
    ...over,
  }) as unknown as Parameters<typeof GuideArticle>[0]['guide'];

test('🔴 позначка походження стоїть ПЕРЕД текстом, а не під ним', () => {
  const html = renderComponent(GuideArticle, { guide: guide() });
  const mark = html.indexOf('data-testid="provenance"');
  const body = html.indexOf('First paragraph.');
  expect(mark, 'позначки походження немає зовсім').toBeGreaterThan(-1);
  expect(body, 'тексту гіда немає — замір сліпий').toBeGreaterThan(-1);
  expect(
    mark,
    'позначка опинилась під текстом — читач зустріне її, вже повіривши',
  ).toBeLessThan(body);
});

test('машину названо машиною, коли текст написала машина', () => {
  const html = renderComponent(GuideArticle, { guide: guide() });
  expect(visibleText(html)).toContain('camptribe-writer');
});

test('🔴 CAMP-463: лічильник записів не друкує свого імені, але говорить, що писала програма', () => {
  const html = renderComponent(GuideArticle, {
    guide: guide({ provenance: 'data-generated', generator: 'region-facts@2' }),
  });
  const text = visibleText(html);
  expect(text).not.toContain('region-facts');
  expect(text).not.toMatch(/model invented/i);
  // Знаменник: позначка на місці й каже словами, хто писав.
  expect(html).toContain('data-provenance="data-generated"');
  expect(text).toContain('A program wrote this page from our own records.');
  // …а мовна модель, як і раніше, названа поіменно (ст. 50(2) AI Act).
  expect(visibleText(renderComponent(GuideArticle, { guide: guide() }))).toContain(
    'camptribe-writer',
  );
});

test('список у тілі лишається списком, а не рядком із дефісами', () => {
  const html = renderComponent(GuideArticle, { guide: guide() });
  expect(html).toContain('<ul');
  expect(visibleText(html)).toContain('one');
});

test('порожнє тіло не малює порожнього блока', () => {
  const html = renderComponent(GuideArticle, { guide: guide({ body: null }) });
  expect(html).not.toContain('<p>');
});
