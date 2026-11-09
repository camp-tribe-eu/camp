/**
 * CAMP-473. Помічник чекання нотатки про пожежі.
 *
 * ⚠️ ЧОГО ЦІ ДВА ТЕСТИ НЕ ДОВОДЯТЬ, І ЦЕ СКАЗАНО ПЕРШИМ. Вони НЕ
 * доводять, що мигтіння полагоджене. Я пробував: повернув у помічник
 * прибраний другий запит `page.getAttribute(NOTE, 'data-state',
 * { timeout: 1_000 })` — обидва тести лишились зелені.
 *
 * Причина чесна: щоб той запит упав, вузол має бути відчеплений саме в
 * ту мить, коли запит іде, а йде він одразу після того, як чекання вже
 * побачило потрібний стан. Відтворити цю щілину детерміновано я не
 * вмію: якщо прибрати вузол раніше — чекання його не знайде й зачекає;
 * якщо пізніше — запит устигне. Отже доказ правки — не тест, а журнал
 * CI від 09.11.2026 (PR #489, усі вісім знімків «identical to the
 * baseline», впало саме чекання) плюс те, що другий запит був зайвий:
 * стан уже був у руках.
 *
 * 🔴 ЩО ВОНИ ДОВОДЯТЬ. Що `waitForState` віддає САМЕ ТОЙ стан, який
 * побачив, і помічник ним користується. Мутація «повернути сторонній
 * рядок замість прочитаного» червонить другий тест: помічник перестає
 * впізнавати `off` і висить 20 с на чеканні `data-in-view`.
 *
 * Перший тест — поведінкова огорожа: нотатка, що зникла на дві секунди
 * ПІСЛЯ того, як стан прийшов, не валить чекання. Старий код її теж
 * проходив; вона стоїть, щоб наступна правка помічника не зробила
 * гірше, а не як підтвердження цієї.
 */
import { expect, test } from '@playwright/test';

import { waitForWildfireNote } from '../map-ready';

const PAGE = `
<!doctype html><html><body>
<div data-testid="wildfire-note" data-state="fresh" data-in-view="">burnt areas</div>
<script>
  const note = document.querySelector('[data-testid="wildfire-note"]');
  // Нотатка зникає ПІСЛЯ того, як стан уже прийнятний — саме так
  // виглядає перемальовка React для стороннього спостерігача.
  setTimeout(() => note.remove(), 300);
  setTimeout(() => {
    note.setAttribute('data-in-view', '1');
    document.body.appendChild(note);
  }, 2300);
</script>
</body></html>`;

test('нотатка, що зникає на дві секунди після того, як стан прийшов, не валить чекання', async ({
  page,
}) => {
  await page.setContent(PAGE);
  await waitForWildfireNote(page, 20_000);
  await expect(page.locator('[data-testid="wildfire-note"]')).toHaveAttribute(
    'data-in-view',
    '1',
  );
});

test('🔴 шар пожеж вимкнено — помічник упізнає `off` зі стану, який сам же дочекався', async ({
  page,
}) => {
  await page.setContent(
    '<div data-testid="wildfire-note" data-state="off" data-in-view="">layer off</div>',
  );
  const started = Date.now();
  await waitForWildfireNote(page, 20_000);
  // Повертається одразу, а не через таймаут очікування `data-in-view`.
  expect(Date.now() - started).toBeLessThan(5_000);
});
