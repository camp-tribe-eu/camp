import { expect, test } from '@playwright/test';

import { metadata } from '@/app/internal/sections/page';
import { robotsFor } from '@/lib/robots-rules';

/**
 * CAMP-449 — вітрина каталогу секцій закрита ДВОМА замками, і обидва
 * перевіряються тут, бо жоден з них не видно у зібраній сторінці CI:
 * збірка там закрита, тож `noindex` стоїть на всьому й нічого не каже.
 */

test('🔴 вітрина сама оголошує себе noindex', () => {
  const robots = metadata.robots as { index?: boolean; follow?: boolean };
  expect(robots, 'сторінка не оголосила robots зовсім').toBeTruthy();
  expect(robots.index, 'вітрина дозволила себе індексувати').toBe(false);
});

test('🔴 /internal/ закрито і в robots.txt відкритої збірки', () => {
  const rules = robotsFor(true).rules;
  const groups = (Array.isArray(rules) ? rules : [rules]) as Array<{
    disallow?: unknown;
  }>;
  expect(groups.length).toBeGreaterThan(0);
  for (const g of groups) {
    expect([g?.disallow ?? []].flat().map(String)).toContain('/internal/');
  }
});
