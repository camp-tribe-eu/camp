import { expect, test } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import RentalDisclosure from '@/components/rental-disclosure';

// 🔴 ЧОМУ ЦЕ ОКРЕМИЙ ВИПАДОК, А НЕ РЯДОК В E2E.
//
// 08.11.2026 власник знайшов на проді абзац, який повідомляв світові, що
// партнерів у нас немає і сторінка нічого не заробляє. Це не розкриття —
// це наша переговорна позиція. Прибрано; компонент тепер мовчить, поки
// розкривати нема чого.
//
// Але мовчання легко перетворити на сліпоту: хтось поверне `offers > 0`
// і забуде розкриття. Тому обидва боки перевіряються тут, без браузера.
test('🔴 без посилань не показує нічого', () => {
  expect(renderToStaticMarkup(<RentalDisclosure offers={0} />)).toBe('');
});

test('🔴 із посиланням розкриває звʼязок, і це видно словами', () => {
  const html = renderToStaticMarkup(<RentalDisclosure offers={1} />);
  expect(html).toContain('affiliate links');
  expect(html).toContain('rental-disclosure');
});

test('розкриття не оголошує ВІДСУТНІСТЬ звʼязку', () => {
  const html = renderToStaticMarkup(<RentalDisclosure offers={1} />);
  for (const forbidden of ['no affiliate links', 'no rental partner', 'earning us']) {
    expect(html.toLowerCase(), `знову оголошує відсутність: «${forbidden}»`).not.toContain(
      forbidden,
    );
  }
});
