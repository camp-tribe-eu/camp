import { expect, test } from '@playwright/test';
import { metadata as forgotMeta } from '@/app/forgot-password/page';
import { metadata as loginMeta } from '@/app/login/page';
import { metadata as resetMeta } from '@/app/reset-password/page';
import { metadata as signupMeta } from '@/app/signup/page';
import { metadata as verifyMeta } from '@/app/verify-email/page';
import {
  EMPTY_SIGNUP,
  ForgotSentView,
  LoginFormView,
  ResendVerificationView,
  SignupDoneView,
  SignupFormView,
  StaleLinkView,
  messageFor,
} from '@/components/account-view';
import { SignupForm } from '@/components/account-forms';
import type { Outcome } from '@/lib/account';
import { robotsFor } from '@/lib/robots-rules';
import { STATIC_HUBS } from '@/lib/sitemap';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-228 — що сторінки акаунта кажуть людині, прочитано з ВИДАНОГО HTML.
//
// 🔴 КОЖНЕ ТВЕРДЖЕННЯ ТУТ ЧИТАЄ HTML, який віддає компонент, — не
// константу, не клас, не `data-testid`, не `sr-only`. «Галочка порожня» —
// це атрибут `checked` у розмітці, якої нема; «Умови без галочки» — це
// рівно один checkbox у документі, і він про розсилку. Тест, який питав би
// стан, що його передали компоненту, питав би власну фікстуру.
//
// `SignupForm` рендериться ЦІЛИМ (з його початковим станом), бо саме цей
// початковий стан Next пререндерить у статичний HTML: інакше тест не бачив
// би, що `useState` починається з `true`.

type Tag = Record<string, string | true>;

/** Усі теги `<name …>` із виданого HTML з їхніми атрибутами. */
function tags(html: string, name: string): Tag[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'g'))].map((m) => {
    const attrs: Tag = {};
    for (const a of m[1].matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? true;
    return attrs;
  });
}

/** Підписи (`<label>`) з виданого HTML: `for` → видимий текст. */
function labels(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<label\b[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g))
    out[m[1]] = visibleText(m[2]);
  return out;
}

/** Посилання `<a href>` із видимим текстом. */
function links(html: string): { href: string; text: string }[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: visibleText(m[2]),
  }));
}

const noop = () => undefined;
const signupView = (over: Partial<Parameters<typeof SignupFormView>[0]> = {}) =>
  renderComponent(SignupFormView, {
    draft: EMPTY_SIGNUP,
    error: null,
    busy: false,
    ready: true,
    onEdit: noop,
    onSubmit: noop,
    ...over,
  });

const servedSignup = () => renderComponent(() => <SignupForm />, {});

test.describe('🔴 реєстрація: галочка розсилки порожня (Planet49, C-673/17)', () => {
  test('у виданій сторінці рівно один checkbox — розсилка — і він не поставлений', () => {
    const boxes = tags(servedSignup(), 'input').filter((i) => i.type === 'checkbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0].name).toBe('newsletter');
    expect('checked' in boxes[0]).toBe(false);
    expect('defaultChecked' in boxes[0]).toBe(false);
  });

  test('…і підписаний саме тим реченням про розсилку', () => {
    const html = servedSignup();
    const box = tags(html, 'input').find((i) => i.type === 'checkbox')!;
    expect(labels(html)[box.id as string]).toBe(
      'I want emails about new routes and guides. No more than once a month.',
    );
  });

  // 🔴 Без цього тест міг би бути зеленим, бо парсер просто не вміє бачити
  // `checked`: той самий документ зі ввімкненим станом мусить показати його.
  test('той самий компонент зі ввімкненим станом ПОКАЗУЄ checked — тож відсутність щось означає', () => {
    const box = tags(signupView({ draft: { ...EMPTY_SIGNUP, newsletter: true } }), 'input').find(
      (i) => i.type === 'checkbox',
    )!;
    expect('checked' in box).toBe(true);
  });

  test('початковий стан форми — без згоди', () => {
    expect(EMPTY_SIGNUP).toEqual({ email: '', password: '', newsletter: false });
  });
});

test.describe('🔴 реєстрація: Умови — рядок тексту з лінками, без галочки', () => {
  test('видимий рядок називає Умови й Політику приватності', () => {
    expect(visibleText(servedSignup())).toContain(
      'By creating an account you accept the Terms and the Privacy Policy.',
    );
  });

  test('обидва слова — посилання на справжні сторінки', () => {
    const l = links(servedSignup());
    expect(l).toContainEqual({ href: '/legal/terms', text: 'Terms' });
    expect(l).toContainEqual({ href: '/legal/privacy', text: 'Privacy Policy' });
  });

  test('у формі немає жодного поля, яким можна «прийняти» чи «відмовитись» від Умов', () => {
    const inputs = tags(servedSignup(), 'input');
    expect(inputs.map((i) => i.name).sort()).toEqual(['email', 'newsletter', 'password']);
    // Єдиний checkbox — розсилка (перевірено вище); радіо немає зовсім.
    expect(inputs.filter((i) => i.type === 'radio')).toHaveLength(0);
  });

  test('рядок про Умови — не частина підпису якогось поля', () => {
    const html = servedSignup();
    const forTerms = Object.values(labels(html)).filter((t) => /Terms/.test(t));
    expect(forTerms).toEqual([]);
  });
});

test.describe('реєстрація: решта форми', () => {
  test('довжина — єдина вимога, і це сказано', () => {
    expect(visibleText(servedSignup())).toContain(
      'At least 10 characters. That is the only rule; we turn away only the most common passwords.',
    );
  });

  test('до гідратації поля вимкнені, і сторінка каже чому', () => {
    const html = servedSignup();
    expect(tags(html, 'input').every((i) => 'disabled' in i)).toBe(true);
    expect(tags(html, 'button').every((i) => 'disabled' in i)).toBe(true);
    expect(visibleText(html)).toContain('The form comes alive when the page finishes loading.');
  });

  test('після гідратації — ні поля, ні кнопка не вимкнені, а підказка зникла', () => {
    const html = signupView();
    expect(tags(html, 'input').some((i) => 'disabled' in i)).toBe(false);
    expect(visibleText(html)).not.toContain('comes alive');
  });

  test('автозаповнення: нова пошта, новий пароль', () => {
    const inputs = tags(servedSignup(), 'input');
    expect(inputs.find((i) => i.name === 'email')!.autoComplete).toBe('email');
    expect(inputs.find((i) => i.name === 'password')!.autoComplete).toBe('new-password');
    expect(inputs.find((i) => i.name === 'password')!.type).toBe('password');
  });

  test('помилка «адреса зайнята» стоїть у role=alert зі словом Error й веде куди йти далі', () => {
    const html = signupView({ error: { kind: 'taken' } });
    expect(html).toMatch(/role="alert"/);
    expect(visibleText(html)).toContain('Error: An account with this email already exists.');
    const l = links(html);
    expect(l).toContainEqual({ href: '/login', text: 'Sign in' });
    expect(l).toContainEqual({ href: '/forgot-password', text: 'reset the password' });
  });

  test('пароль, відхилений сервером, показує речення сервера дослівно', () => {
    const html = signupView({
      error: { kind: 'invalid', code: 'weak_password', message: 'Use at least 10 characters.' },
    });
    expect(visibleText(html)).toContain('Error: Use at least 10 characters.');
  });
});

test.describe('🔴 «Підтвердьте пошту»: правда й лише правда про збережене', () => {
  const done = (over: Partial<Parameters<typeof SignupDoneView>[0]> = {}) =>
    renderComponent(SignupDoneView, {
      email: 'anna@example.com',
      secondsLeft: 47,
      busy: false,
      error: null,
      onResend: noop,
      ...over,
    });

  test('каже, куди пішов лист, на скільки живе посилання, і що людина вже ввійшла', () => {
    const text = visibleText(done());
    expect(text).toContain('We sent a letter to anna@example.com.');
    expect(text).toContain('The link works once and for 60 minutes.');
    expect(text).toContain('You are signed in.');
    expect(text).toContain('Confirming your email does not stop you doing anything here.');
  });

  // Макет тут каже «Ваш маршрут уже збережено», але зберігати поки нічого:
  // ендпоінта немає. Фраза про збережений маршрут без маршруту була б
  // твердженням про те, чого сторінка не бачить.
  test('не стверджує, що щось збережено — зберігати поки нічого', () => {
    const text = visibleText(done());
    expect(text).not.toMatch(/saved/i);
    expect(text).not.toMatch(/your route/i);
  });

  test('показує відлік до повторного листа й не дає кнопки, поки він іде', () => {
    const html = done({ secondsLeft: 47 });
    expect(visibleText(html)).toContain('You can send it again in 0:47.');
    expect(tags(html, 'button')).toHaveLength(0);
  });

  test('на нулі замість відліку — кнопка', () => {
    const html = done({ secondsLeft: 0 });
    expect(visibleText(html)).not.toContain('You can send it again in');
    expect(visibleText(html)).toContain('Send it again');
    expect(tags(html, 'button')).toHaveLength(1);
  });

  test('помилка повторної відправки видна', () => {
    const html = done({ error: { kind: 'failed' } });
    expect(visibleText(html)).toContain('Error: We could not complete that. Nothing was saved — try again.');
  });
});

test.describe('🔴 «Перевірте пошту»: той самий екран для будь-якої адреси', () => {
  const sent = (over: Partial<Parameters<typeof ForgotSentView>[0]> = {}) =>
    renderComponent(ForgotSentView, {
      secondsLeft: 47,
      busy: false,
      error: null,
      onResend: noop,
      ...over,
    });

  test('каже «якщо акаунт існує» і нічого, що б розрізняло адреси', () => {
    const text = visibleText(sent());
    expect(text).toContain(
      'If an account with that address exists, we have just sent a link to it. The link works once and for 60 minutes.',
    );
    // Екран не отримує адреси й не може її показати.
    expect(text).not.toContain('@');
  });

  test('не залежить ні від чого, крім відліку: ті самі пропси — той самий HTML', () => {
    expect(sent()).toBe(sent());
    // Єдине, що змінює текст, — відлік.
    expect(visibleText(sent({ secondsLeft: 0 }))).not.toBe(visibleText(sent({ secondsLeft: 47 })));
  });

  test('відлік 0:47 і кнопка на нулі', () => {
    expect(visibleText(sent({ secondsLeft: 47 }))).toContain('You can send it again in 0:47.');
    expect(visibleText(sent({ secondsLeft: 0 }))).toContain('Send it again');
  });
});

test.describe('«Посилання застаріло»', () => {
  test('каже, що це нормально й нічого не зламало, і лишає місце для дії', () => {
    const html = renderComponent(StaleLinkView, {
      children: <a href="/forgot-password">Ask for a new link</a>,
    });
    const text = visibleText(html);
    expect(text).toContain('This link has expired');
    expect(text).toContain(
      'This letter is more than 60 minutes old, or the link has already been used. That is normal and nothing is broken.',
    );
    expect(links(html)).toContainEqual({ href: '/forgot-password', text: 'Ask for a new link' });
  });

  test('форма «надіслати новий лист» після відправки каже «якщо… чекає на підтвердження»', () => {
    const html = renderComponent(ResendVerificationView, {
      email: 'x@y.zz',
      sent: true,
      secondsLeft: 30,
      busy: false,
      ready: true,
      error: null,
      onEdit: noop,
      onSubmit: noop,
    });
    expect(visibleText(html)).toContain(
      'If an account with that address is waiting to be confirmed, we have just sent it a new letter.',
    );
    expect(visibleText(html)).not.toContain('x@y.zz');
  });
});

test.describe('вхід', () => {
  test('хибна пара — одне речення, яке не каже, що саме хибне', () => {
    const html = renderComponent(LoginFormView, {
      draft: { email: '', password: '' },
      error: { kind: 'refused' },
      busy: false,
      ready: true,
      onEdit: noop,
      onSubmit: noop,
    });
    expect(visibleText(html)).toContain('Error: Email or password is wrong.');
    const inputs = tags(html, 'input');
    expect(inputs.find((i) => i.name === 'password')!.autoComplete).toBe('current-password');
    expect(links(html)).toContainEqual({ href: '/forgot-password', text: 'Forgot your password?' });
  });
});

test.describe('messageFor: що каже кожен стан', () => {
  const CASES: [Outcome, string | null][] = [
    [{ kind: 'ok', body: null }, null],
    [{ kind: 'invalid', code: 'bad_email', message: 'That does not look like an email address.' }, 'That does not look like an email address.'],
    [{ kind: 'invalid', code: 'weak_password', message: '' }, 'Check the form and try again.'],
    [{ kind: 'refused' }, 'Email or password is wrong.'],
    [{ kind: 'taken' }, 'An account with this email already exists.'],
    [{ kind: 'stale' }, 'This link has expired or has already been used.'],
    [{ kind: 'too-soon', retryAfter: 30 }, 'A letter was sent a moment ago. Please wait before asking again.'],
    [{ kind: 'throttled' }, 'Too many attempts from this connection. Try again in a few minutes.'],
    [{ kind: 'unavailable' }, 'Accounts are not available right now. Nothing was saved.'],
    [{ kind: 'failed' }, 'We could not complete that. Nothing was saved — try again.'],
  ];

  for (const [outcome, text] of CASES)
    test(`${outcome.kind}: ${text ?? 'нічого'}`, () =>
      expect(messageFor(outcome)).toBe(text));
});

test.describe('🔴 сторінки: noindex метатегом, а не robots.txt (макет: «noindex — так, robots.txt — ні»)', () => {
  const PAGES = {
    '/signup': signupMeta,
    '/login': loginMeta,
    '/forgot-password': forgotMeta,
    '/reset-password': resetMeta,
    '/verify-email': verifyMeta,
  };

  for (const [path, meta] of Object.entries(PAGES)) {
    test(`${path}: noindex, nofollow`, () => {
      expect(meta.robots).toEqual({ index: false, follow: false });
    });
  }

  test('сторінки з токеном у адресі не віддають Referer', () => {
    expect(resetMeta.referrer).toBe('no-referrer');
    expect(verifyMeta.referrer).toBe('no-referrer');
  });

  test('відкрита збірка НЕ закриває їх у robots.txt — інакше робот не прочитає noindex', () => {
    const rules = robotsFor(true).rules as { disallow: string[] };
    const blocked = (path: string) => rules.disallow.some((d) => path.startsWith(d));
    for (const path of Object.keys(PAGES)) expect(blocked(path), path).toBe(false);
    // Щоб відсутність щось означала: правило, яке справді є, спрацьовує.
    expect(blocked('/trips/abc')).toBe(true);
  });

  test('закрита збірка закриває все', () => {
    expect(robotsFor(false).rules).toEqual({ userAgent: '*', disallow: '/' });
  });

  test('жодної з них немає в карті сайту', () => {
    const listed = STATIC_HUBS.map((u) => new URL(u.loc).pathname);
    // Щоб порожнє читання не пройшло за «немає»: карта справді читається.
    expect(listed.length).toBeGreaterThan(3);
    expect(listed).toContain('/camping');
    for (const path of Object.keys(PAGES)) expect(listed, path).not.toContain(path);
  });
});
