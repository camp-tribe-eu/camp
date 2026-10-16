import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DeleteFlow } from '@/components/account-delete';
import { LoginDoneView } from '@/components/account-view';
import {
  DELETE_TITLE,
  DeleteFormView,
  DeletedView,
  type DeleteProblem,
} from '@/components/account-delete-view';
import { EMPTY_DELETE, type DeleteDraft } from '@/lib/rights';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

// CAMP-229 (3/3) — що каже екран видалення акаунта, прочитано з ВИДАНОГО HTML.
//
// 🔴 КОЖНЕ ТВЕРДЖЕННЯ ТУТ ЧИТАЄ HTML, який віддає компонент, — не константу, не клас,
// не `data-testid`, не `sr-only`. Два пункти приймання картки — найлегші для фальшивого
// зеленого, тож кожен з них побудований парою:
//
//   «жоден варіант не вибрано» ← разом із «варіанти Є» і «коли один обрано, `checked`
//       справді з'являється». Перевірка «в розмітці немає слова checked» зелена й тоді,
//       коли екран не відрендерився взагалі; тому спершу доводиться, що обидва варіанти
//       присутні, а потім — що жоден не позначений, і що цей самий розбір БАЧИТЬ
//       позначений, коли він є.
//   «текст називає підставу» ← рядком, а не «текст непорожній»: «Article 17(3) of the
//       GDPR expressly allows it» у тому ж блоці, що й «Anonymised moderation records».
//
// 🔴 ПЕРШИЙ ЕКРАН — НЕ ПРОП, А КОМПОНЕНТ: `DeleteFlow` рендериться у своєму ПОЧАТКОВОМУ
// стані, тим, з якого він стартує в браузері. Передати тесту `EMPTY_DELETE` самому — це
// перевірити константу; тут перевіряється те, що компонент із нею справді робить.

/** Атрибути одного тега: ім'я → значення (`''` для атрибута без значення). */
function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = tag.replace(/^<\w+/, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g))
    out.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** Усі `<input>` у HTML з їхніми атрибутами. */
function inputs(html: string): Map<string, string>[] {
  return [...html.matchAll(/<input\b(?:"[^"]*"|'[^']*'|[^'">])*>/g)].map((m) => attributes(m[0]));
}

const radios = (html: string) => inputs(html).filter((a) => a.get('type') === 'radio');
const checkboxes = (html: string) => inputs(html).filter((a) => a.get('type') === 'checkbox');

/** Чи позначено вибраним — будь-яким із способів, якими HTML це каже. */
const isChosen = (a: Map<string, string>) =>
  a.has('checked') || a.get('aria-checked') === 'true' || a.has('selected');

const view = (draft: DeleteDraft, over: Partial<{ ready: boolean; busy: boolean; error: DeleteProblem | null }> = {}) =>
  renderComponent(DeleteFormView, {
    email: 'anna@example.com',
    draft,
    error: over.error ?? null,
    busy: over.busy ?? false,
    ready: over.ready ?? true,
    onEdit: () => undefined,
    onSubmit: () => undefined,
  });

/** Те, що віддає сам компонент, у стані, з якого він стартує. */
const served = () => renderComponent(() => <DeleteFlow email="anna@example.com" />, {});

/** Кнопка «Delete account» (type=submit): її тег. */
function deleteButton(html: string): string {
  const all = [...html.matchAll(/<button\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
  const found = all.filter((b) => visibleText(b) === 'Delete account');
  expect(found, 'рівно одна кнопка «Delete account»').toHaveLength(1);
  return found[0];
}

const CHOSEN = (v: 'delete' | 'keep-anonymous'): DeleteDraft => ({
  photos: v,
  password: '',
  understood: false,
});

test.describe('🔴 пункт приймання 3: жоден варіант долі фото не вибраний за замовчуванням', () => {
  test('перший екран: ОБИДВА варіанти є, з правильними значеннями, і РОЗМІТКА — не прапорець — каже, що вони є', () => {
    const html = served();
    const r = radios(html);
    // Спершу, що варіанти ПРИСУТНІ — інакше «жоден не вибраний» нічого не варте.
    expect(r).toHaveLength(2);
    expect(r.map((a) => a.get('value'))).toEqual(['delete', 'keep-anonymous']);
    expect(r.map((a) => a.get('name'))).toEqual(['photos', 'photos']);
    // Кожен варіант має підпис, який людина бачить, у `<label>` навколо себе.
    const labels = [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[0]);
    const withRadio = labels.filter((l) => /type="radio"/.test(l));
    expect(withRadio).toHaveLength(2);
    expect(visibleText(withRadio[0])).toContain('Delete the photos too');
    expect(visibleText(withRadio[1])).toContain('Keep the photos, remove my name');
    expect(visibleText(html)).toContain('we do not decide for you');
  });

  test('…і жоден із них не позначений: ні `checked`, ні `aria-checked`, ні `selected`', () => {
    const html = served();
    for (const a of radios(html)) {
      expect(a.has('checked'), `checked на ${a.get('value')}`).toBe(false);
      expect(a.get('aria-checked'), `aria-checked на ${a.get('value')}`).not.toBe('true');
      expect(a.has('selected'), `selected на ${a.get('value')}`).toBe(false);
      expect(isChosen(a)).toBe(false);
    }
    // Вибір долі фото не ховається й у `<select>`/`<option selected>`.
    expect(html).not.toMatch(/<select\b/);
    expect(html).not.toMatch(/<option\b[^>]*\bselected\b/);
    expect(html).not.toMatch(/defaultChecked|default-checked/i);
  });

  test('🔴 цей самий розбір БАЧИТЬ позначений варіант: коли людина обрала, `checked` стоїть на ньому — і лише на ньому', () => {
    for (const [pick, other] of [
      ['delete', 'keep-anonymous'],
      ['keep-anonymous', 'delete'],
    ] as const) {
      const r = radios(view(CHOSEN(pick)));
      expect(r).toHaveLength(2);
      const chosen = r.filter(isChosen).map((a) => a.get('value'));
      expect(chosen, `обрано ${pick}`).toEqual([pick]);
      expect(r.find((a) => a.get('value') === other)!.has('checked')).toBe(false);
    }
  });

  test('галочка «розумію» теж не поставлена, а при поставленій розбір її бачить', () => {
    const html = served();
    const boxes = checkboxes(html);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].get('name')).toBe('understood');
    expect(isChosen(boxes[0])).toBe(false);
    const ticked = checkboxes(view({ ...EMPTY_DELETE, understood: true }));
    expect(ticked.map(isChosen)).toEqual([true]);
  });

  test('поле пароля порожнє', () => {
    const pw = inputs(served()).filter((a) => a.get('type') === 'password');
    expect(pw).toHaveLength(1);
    expect(pw[0].get('value') ?? '').toBe('');
    expect(pw[0].get('autocomplete')).toBe('current-password');
  });

  test('на екрані рівно два способи вибору долі фото, і вони не виросли непомітно', () => {
    // Третій варіант, доданий мовчки, мав би зламати це число, а не пройти повз.
    expect(radios(served())).toHaveLength(2);
  });

  test('кнопка видалення НЕАКТИВНА, поки людина сама не обрала: і коли сторінка жива, і коли ні', () => {
    for (const html of [served(), view(EMPTY_DELETE, { ready: true })]) {
      expect(attributes(deleteButton(html)).has('disabled')).toBe(true);
    }
  });

  test('…і активна лише коли заповнено все: вибір, пароль і «розумію» — кожне, пропущене окремо, її вимикає', () => {
    const FULL: DeleteDraft = { photos: 'keep-anonymous', password: 'pw', understood: true };
    expect(attributes(deleteButton(view(FULL))).has('disabled')).toBe(false);
    for (const lacking of [
      { ...FULL, photos: null },
      { ...FULL, password: '' },
      { ...FULL, understood: false },
    ]) {
      expect(attributes(deleteButton(view(lacking))).has('disabled'), JSON.stringify(lacking)).toBe(true);
    }
    // Сторінка, що ще не ожила, не дає натиснути й заповнену форму; і зайнята — теж.
    expect(attributes(deleteButton(view(FULL, { ready: false }))).has('disabled')).toBe(true);
    expect(attributes(deleteButton(view(FULL, { busy: true }))).has('disabled')).toBe(true);
  });

  test('рішення про «не вибрано» сказано людині словами, не лише зроблено', () => {
    const text = visibleText(served());
    expect(text).toContain('No option is chosen in advance');
    expect(text).toContain('We would rather you kept the photos');
    expect(text).toContain('choosing “keep” for you would be manipulation');
    expect(text).toContain('Planet49, C-673/17');
  });
});

test.describe('🔴 пункт приймання 4: текст про те, що лишиться, є, і НАЗИВАЄ ПІДСТАВУ', () => {
  const html = served();

  /** Блок, що починається заголовком «What stays in any case — and why», до кінця його контейнера. */
  const block = (() => {
    const at = html.indexOf('What stays in any case — and why');
    expect(at, 'заголовок блоку є у виданому HTML').toBeGreaterThan(0);
    const start = html.lastIndexOf('<div', at);
    const end = html.indexOf('</div>', at) + '</div>'.length;
    return visibleText(html.slice(start, end));
  })();

  test('заголовок блоку — слова макета: «що лишиться в будь-якому разі — і чому»', () => {
    expect(block.startsWith('What stays in any case — and why')).toBe(true);
  });

  test('називає, ЩО лишається: знеособлені записи модерації, і навіщо', () => {
    expect(block).toContain('Anonymised moderation records');
    expect(block).toContain('that a photo or a review was rejected, why, and when, with no name and no address');
    expect(block).toContain(
      'so that someone we blocked for fake photos cannot come back the next day with a new account',
    );
  });

  test('🔴 називає ПІДСТАВУ — ст. 17 п. 3 — в тому ж блоці, а не окремо десь на сторінці', () => {
    expect(block).toContain('This is our legitimate interest');
    expect(block).toContain('Article 17(3) of the GDPR expressly allows it.');
    // «Article 17» без пункту не рахується: саме пункт 3 називає виняток.
    expect(block.match(/Article 17\(3\)/g)).toHaveLength(1);
  });

  test('називає й другу річ, що лишається: ліцензію на опубліковані фото — договір, не персональні дані', () => {
    expect(block).toContain('The licence on photos already published is a contract, not personal data.');
    expect(block).toContain('your name comes off whenever you ask');
    expect(block).toContain('the photo itself only if you chose the first option above');
  });

  test('цей текст ВИДНО: його немає лише в прихованому елементі, `sr-only`, `title` чи `aria-label`', () => {
    // `visibleText` викидає приховане; блок, прочитаний ним, уже містить підставу (вище).
    // Тут — дзеркало: ніхто не сховав її й не продублював у атрибутах замість тексту.
    expect(visibleText(html)).toContain('Article 17(3) of the GDPR expressly allows it.');
    expect(html).not.toMatch(/sr-only[^>]*>[^<]*Article 17/);
    expect(html).not.toMatch(/(?:title|aria-label)="[^"]*Article 17/);
  });

  test('«30 днів — це не спосіб потягнути час»: закон, мета вікна й «доступ припиняється одразу»', () => {
    const text = visibleText(html);
    expect(text).toContain('30 days is not a way to stall');
    expect(text).toContain('without undue delay');
    expect(text).toContain('a mistaken click, and a broken account');
    expect(text).toContain('Access ends immediately.');
    expect(text).toContain('The only way back is signing in with the same password.');
    expect(text).toContain('After 30 days the account and everything left in it is erased for good.');
  });

  test('галочка підтвердження називає ті самі 30 днів, що й решта екрана', () => {
    expect(visibleText(html)).toContain(
      'I understand: for 30 days the account can be brought back by simply signing in; after that it cannot.',
    );
  });
});

test.describe('решта екрана', () => {
  test('заголовок один і той самий — у `<h1>` і в константі, що йде в хлібну крихту й `<title>`', () => {
    const h1 = [...served().matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => visibleText(m[1]));
    expect(h1).toEqual([DELETE_TITLE]);
    expect(DELETE_TITLE).toBe('Delete your account');
  });

  test('називає, ЩО зникне, і чого немає в цьому списку теж не вигадано (жодних цифр без джерела)', () => {
    const text = visibleText(served());
    expect(text).toContain(
      'Will disappear: your profile, your routes and saved campsites, your settings, and any reviews you wrote.',
    );
    expect(text).not.toMatch(/\b\d+ (routes|saved|campsites)\b/i);
  });

  test('чесно каже, що вибір фото застосовується одразу і вхід його не повертає', () => {
    expect(visibleText(served())).toContain(
      'Your choice is applied straight away. Signing back in later restores your account — not the photos.',
    );
  });

  test('«Скасувати» веде на сторінку, що існує', () => {
    const html = served();
    const cancel = [...html.matchAll(/<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].filter(
      (m) => visibleText(m[2]) === 'Cancel',
    );
    expect(cancel).toHaveLength(1);
    expect(cancel[0][1]).toBe('/account/data');
    expect(existsSync(join(__dirname, '..', '..', 'src', 'app', 'account', 'data', 'page.tsx'))).toBe(true);
  });

  test('адреса в заголовку форми виводиться текстом, а не розміткою', () => {
    const html = renderComponent(DeleteFormView, {
      email: '<img src=x onerror=alert(1)>',
      draft: EMPTY_DELETE,
      error: null,
      busy: false,
      ready: true,
      onEdit: () => undefined,
      onSubmit: () => undefined,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  const MESSAGES: [DeleteProblem, string][] = [
    ['wrong-password', 'That password is not right. Nothing was deleted.'],
    ['throttled', 'Too many attempts from this connection. Try again in a few minutes.'],
    ['unavailable', 'Accounts are not available right now. Nothing was deleted.'],
    [
      'incomplete',
      'Choose what happens to your photos, enter your password and tick the box. Nothing was deleted.',
    ],
    ['failed', 'We could not complete that. Nothing was deleted — try again.'],
  ];
  for (const [error, message] of MESSAGES)
    test(`помилка «${error}» — слово «Error», причина, і «нічого не видалено»`, () => {
      const html = view(EMPTY_DELETE, { error });
      expect(html).toContain('role="alert"');
      expect(visibleText(html)).toContain(`Error: ${message}`);
    });

  test('без помилки блоку `alert` немає', () => {
    expect(view(EMPTY_DELETE)).not.toContain('role="alert"');
  });

  test('після видалення: коли можна повернути, що сесію закрито, і що з фото не повернеться', () => {
    const html = renderComponent(DeletedView, { restorableUntil: '2026-11-15T12:00:00.000Z' });
    const text = visibleText(html);
    expect(text).toContain('Your account has been deleted');
    expect(text).toContain('Access ended just now and you have been signed out everywhere.');
    expect(text).toContain('15 November 2026, 12:00 UTC');
    expect(text).toContain('signing in with the same password');
    expect(text).toContain('not undone if you sign back in');
    expect(html).toContain('role="status"');
  });
});

test.describe('🔴 вхід, що скасував видалення, каже про це', () => {
  const NOTICE = 'Your account was scheduled for deletion.';

  test('коли API сказало `restored`, екран входу це каже і веде далі', () => {
    const html = renderComponent(LoginDoneView, { to: '/account', restored: true });
    const text = visibleText(html);
    expect(text).toContain(NOTICE);
    expect(text).toContain('Signing in has cancelled that: your profile and routes are back.');
    expect(text).toContain('signing in restores the account, not the photos');
    expect(html).toContain('role="status"');
    expect(html).toContain('href="/account"');
  });

  test('при звичайному вході про видалення — ні слова', () => {
    for (const props of [{ to: '/account' }, { to: '/account', restored: false }, {}]) {
      const text = visibleText(renderComponent(LoginDoneView, props));
      expect(text).not.toContain(NOTICE);
      expect(text).not.toMatch(/deletion|restored/i);
      expect(text).toContain('You are signed in');
    }
  });
});
