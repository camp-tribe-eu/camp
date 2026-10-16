import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { metadata as accountMeta } from '@/app/account/page';
import {
  CABINET_TITLE,
  CabinetErrorView,
  CabinetView,
  CheckingView,
  SignedOutView,
} from '@/components/account-cabinet-view';
import { LoginDoneView, SignupDoneView } from '@/components/account-view';
import type { Profile } from '@/lib/cabinet';
import { robotsFor } from '@/lib/robots-rules';
import { STATIC_HUBS } from '@/lib/sitemap';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-229 — що кабінет каже людині, прочитано з ВИДАНОГО HTML.
//
// 🔴 КОЖНЕ ТВЕРДЖЕННЯ ТУТ ЧИТАЄ HTML, який віддає компонент, — не константу, не
// клас, не `data-testid`, не `sr-only`. «Порожній стан читається» означає, що
// ТЕКСТ, який бачить людина, дорівнює рядку з макета (перекладеному, див.
// docs/design-audit.md §6.7), а не що в розмітці є елемент. Масив `EMPTY_STATES`
// читає лише e2e (щоб довести, що до відповіді сервера жоден заголовок не
// виданий); ТУТ очікувані рядки написано руками, щоб тест не перевіряв
// компонент його ж даними.

const ANNA: Profile = { email: 'anna@example.com', displayName: 'Anna', emailVerified: true };
const NO_NAME: Profile = { email: 'kim@example.com', displayName: null, emailVerified: false };

const cabinet = (profile: Profile) => renderComponent(CabinetView, { profile });

/** Усі `<a href>` у виданому HTML з їхнім видимим текстом. */
function links(html: string): { href: string; text: string }[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => ({
    href: m[1],
    text: visibleText(m[2]),
  }));
}

/** Секції `<section aria-labelledby>`: заголовок → { текст секції, кнопки }. */
function sections(html: string) {
  const out: { heading: string; text: string; links: { href: string; text: string }[] }[] = [];
  for (const m of html.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/g)) {
    const h = /<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(m[1]);
    out.push({
      heading: h ? visibleText(h[1]) : '',
      text: visibleText(m[1]),
      links: links(m[1]),
    });
  }
  return out;
}

const h1s = (html: string) =>
  [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => visibleText(m[1]));

test.describe('🔴 порожні стани: той текст, що в макеті', () => {
  // Очікувані рядки — переклад рядків Design/07-account.html (блок «ПОРОЖНІ
  // СТАНИ»), написаний тут руками. Українські оригінали — поруч.
  const EXPECTED = [
    {
      icon: '🗺',
      // «Маршрутів поки немає»
      heading: 'No routes yet',
      // «Складіть свій у Trip Planner — або візьміть готовий і змініть під себе.»
      body: 'Build your own in the Trip Planner — or take a ready-made one and change it to suit you.',
      // «У Trip Planner» · «Готові маршрути»
      buttons: [
        { href: '/plan', text: 'Open the Trip Planner' },
        { href: '/routes', text: 'Ready-made routes' },
      ],
    },
    {
      icon: '⛺',
      // «Ще нічого не збережено»
      heading: 'Nothing saved yet',
      // «Сердечко на будь-якому кемпінгу — і він тут. Список синхронізується між пристроями.»
      body: 'A heart on any campsite and it lands here. The list syncs between your devices.',
      // «Відкрити мапу»
      buttons: [{ href: '/map', text: 'Open the map' }],
    },
    {
      icon: '📷',
      // «Ви ще не надсилали фото»
      heading: "You haven't sent any photos yet",
      // «Були в кемпінгу, якого немає на фото? Ваш знімок побачать тисячі людей — із вашим імʼям у підписі.»
      body: 'Been to a campsite we have no photo of? Thousands of people will see your shot — with your name in the credit.',
      // «Додати фото» — кнопки немає свідомо: завантаження фото ще не існує.
      buttons: [],
    },
  ] as const;

  const html = cabinet(ANNA);
  // Профіль — перша секція; три порожні стани — наступні, у порядку макета.
  const empties = sections(html).slice(1);

  test('у виданій сторінці рівно три порожні картки, в порядку макета', () => {
    expect(empties.map((s) => s.heading)).toEqual(EXPECTED.map((e) => e.heading));
  });

  for (const [i, want] of EXPECTED.entries()) {
    test(`«${want.heading}»: заголовок, речення й кнопки — рядки, а не наявність елемента`, () => {
      const card = empties[i];
      expect(card.heading).toBe(want.heading);
      // Видимий текст картки = значок + заголовок + речення, а за ним підписи
      // кнопок, і нічого іншого. Підписи читач склеює без пробілу (це два
      // вбудовані посилання поруч; між ними відступ дає `gap`, а не пробіл).
      const prose = [want.icon, want.heading, want.body].join(' ');
      expect(card.text.startsWith(prose), card.text).toBe(true);
      expect(card.text.slice(prose.length).trim()).toBe(want.buttons.map((b) => b.text).join(''));
      expect(card.links).toEqual(want.buttons.map((b) => ({ href: b.href, text: b.text })));
    });
  }

  test('кожна картка підписана своїм заголовком (доступність), і ці зв’язки існують', () => {
    for (const id of ['routes', 'saved', 'photos']) {
      expect(html).toContain(`aria-labelledby="empty-${id}"`);
      expect(html).toContain(`id="empty-${id}"`);
    }
  });

  test('третя картка не має кнопки: «Додати фото» вела б у нікуди', () => {
    expect(empties[2].links).toEqual([]);
    expect(visibleText(html)).not.toContain('Add a photo');
  });

  test('жодна кнопка не веде кудись, де стоїть заглушка на кшталт «#»', () => {
    for (const l of links(html)) expect(l.href).toMatch(/^\/[a-z]/);
  });

  // 🔴 «Кнопка є, лише якщо є куди вести»: кожна адреса — це сторінка, що є в
  // застосунку (файл `page.tsx` на цьому шляху). Читається саме ЗВІДКИ намальованих
  // посилань, а не з `EMPTY_STATES`. Існування сторінки, а не її відповідь:
  // `/map` і `/routes` на етапі збірки питають API, і без нього відповідь —
  // 500, що не стосується кнопки; відповідь сторінок перевіряють їхні e2e.
  test('кожна намальована кнопка веде на сторінку, яка є в застосунку', () => {
    const app = join(__dirname, '..', '..', 'src', 'app');
    const hrefs = links(html).map((l) => l.href);
    expect(hrefs.slice().sort()).toEqual(['/map', '/plan', '/routes']);
    for (const href of hrefs) expect(existsSync(join(app, href, 'page.tsx')), href).toBe(true);
  });
});

test.describe('профіль: що кабінет каже про людину', () => {
  test('імʼя — заголовком, під ним адреса, потім стан підтвердження', () => {
    const [profile] = sections(cabinet(ANNA));
    expect(profile.heading).toBe('Anna');
    expect(profile.text).toBe('Anna anna@example.com Email confirmed');
  });

  test('імені немає — заголовком адреса, і вона не повторюється', () => {
    const [profile] = sections(cabinet(NO_NAME));
    expect(profile.heading).toBe('kim@example.com');
    expect(profile.text).toBe('kim@example.com Email not confirmed yet');
  });

  test('не вигадує привітань: жодного «Hello», «Welcome», «user»', () => {
    for (const p of [ANNA, NO_NAME]) {
      expect(visibleText(cabinet(p))).not.toMatch(/hello|welcome|\buser\b/i);
    }
  });

  test('рівно один <h1>, і він такий самий в усіх станах — як у хлібній крихті', () => {
    expect(CABINET_TITLE).toBe('Your account');
    const states = [
      cabinet(ANNA),
      renderComponent(CheckingView, {}),
      renderComponent(SignedOutView, {}),
      renderComponent(CabinetErrorView, { kind: 'failed', onRetry: () => undefined }),
      renderComponent(CabinetErrorView, { kind: 'unavailable', onRetry: () => undefined }),
    ];
    for (const html of states) expect(h1s(html)).toEqual([CABINET_TITLE]);
  });

  test('профіль не віддає чужих полів: у HTML лише переданий профіль', () => {
    const leaky = {
      ...ANNA,
      passwordHash: 'scrypt$LEAK',
      id: 'u-1',
    } as unknown as Profile;
    expect(cabinet(leaky)).not.toContain('LEAK');
    expect(cabinet(leaky)).not.toContain('u-1');
  });

  test('адреса, що містить HTML, виводиться текстом, а не розміткою', () => {
    const html = cabinet({ ...ANNA, displayName: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

test.describe('стани до профілю', () => {
  test('видана сторінка ДО гідратації — заголовок і «Checking…», жодного профілю й порожніх карток', () => {
    // Це те, що лежить у статичному HTML і що бачить кожен, кому JS не виконався.
    const served = renderComponent(CheckingView, {});
    expect(visibleText(served)).toBe('Your account Checking your sign-in…');
    expect(served).toContain('role="status"');
    expect(visibleText(served)).not.toContain('No routes yet');
  });

  test('«не ввійшли»: людину ведуть на /login, і посилання є на випадок, коли перехід не стався', () => {
    const html = renderComponent(SignedOutView, {});
    expect(visibleText(html)).toBe(
      'Your account You are not signed in. Taking you to the sign-in page… Sign in',
    );
    expect(links(html)).toEqual([{ href: '/login', text: 'Sign in' }]);
    expect(visibleText(html)).not.toContain('No routes yet');
  });

  test('збій — слово «Error», причина й кнопка повтору; «недоступно» — без кнопки', () => {
    const failed = renderComponent(CabinetErrorView, { kind: 'failed', onRetry: () => undefined });
    expect(visibleText(failed)).toBe(
      'Your account Error: We could not load your account. Nothing was changed — try again. Try again',
    );
    expect(failed).toContain('role="alert"');
    const unavailable = renderComponent(CabinetErrorView, {
      kind: 'unavailable',
      onRetry: () => undefined,
    });
    expect(visibleText(unavailable)).toBe('Your account Error: Accounts are not available right now.');
    expect(unavailable).not.toContain('<button');
  });
});

test.describe('🔴 повернення після входу: куди веде «Continue»', () => {
  test('форма входу: посилання веде туди, де людина була, а не на головну', () => {
    const html = renderComponent(LoginDoneView, { to: '/account' });
    expect(links(html)).toEqual([{ href: '/account', text: 'Continue to the site' }]);
  });

  test('без місця повернення — на головну', () => {
    expect(links(renderComponent(LoginDoneView, {}))).toEqual([
      { href: '/', text: 'Continue to the site' },
    ]);
  });

  test('реєстрація: «Continue» веде туди, де людина була', () => {
    const html = renderComponent(SignupDoneView, {
      email: 'a@b.co',
      secondsLeft: 0,
      busy: false,
      error: null,
      onResend: () => undefined,
      continueTo: '/account',
    });
    expect(links(html).find((l) => l.text === 'Continue to the site')).toEqual({
      href: '/account',
      text: 'Continue to the site',
    });
  });

  // 🔴 Обидва екрани НЕ ВІРЯТЬ значенню, яке їм передали: вони самі не знають,
  // що воно перевірене. Ворожий `to` перетворюється на `/` у виданому HTML.
  for (const hostile of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)']) {
    test(`ворожий \`to\` («${hostile}») на кінцевих екранах стає «/»`, () => {
      const login = renderComponent(LoginDoneView, { to: hostile });
      expect(links(login)[0].href).toBe('/');
      const signup = renderComponent(SignupDoneView, {
        email: 'a@b.co',
        secondsLeft: 0,
        busy: false,
        error: null,
        onResend: () => undefined,
        continueTo: hostile,
      });
      expect(links(signup).find((l) => l.text === 'Continue to the site')!.href).toBe('/');
      expect(login).not.toContain('evil.com');
      expect(signup).not.toContain('evil.com');
    });
  }
});

test.describe('🔴 /account: noindex метатегом, а не robots.txt (макет: «noindex — так, robots.txt — ні»)', () => {
  test('noindex, nofollow і назва — той самий рядок, що <h1>', () => {
    expect(accountMeta.robots).toEqual({ index: false, follow: false });
    expect(accountMeta.title).toBe(CABINET_TITLE);
  });

  test('відкрита збірка НЕ закриває її в robots.txt — інакше робот не прочитає noindex', () => {
    const rules = robotsFor(true).rules as { disallow: string[] };
    const blocked = (path: string) => rules.disallow.some((d) => path.startsWith(d));
    expect(blocked('/account')).toBe(false);
    // Щоб відсутність щось означала: правило, яке справді є, спрацьовує.
    expect(blocked('/trips/abc')).toBe(true);
  });

  test('її немає в карті сайту', () => {
    const listed = STATIC_HUBS.map((u) => new URL(u.loc).pathname);
    expect(listed.length).toBeGreaterThan(3);
    expect(listed).toContain('/camping');
    expect(listed).not.toContain('/account');
  });
});
