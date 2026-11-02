import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

import { expect, test } from '@playwright/test';

import { SignupForm } from '@/components/account-forms';
import ReportProblem from '@/components/report-problem';
import { CONTACT_EMAIL } from '@/lib/legal';
import {
  API_SRC,
  WEB_SRC,
  pageText,
  paragraphs,
  readCode,
  sourceFiles,
} from './legal-claims';
import { renderComponent } from './render-component';
import { visibleText } from './rendered-text';

/**
 * «Terms of use» 1.2 — три твердження про те, що сайт робить, звірені з
 * кодом, а не з літералом у тесті.
 *
 * 🔴 ЧИТАЄТЬСЯ ВІДРЕНДЕРЕНИЙ HTML: і сторінка (крізь `LegalProse`), і форма
 * реєстрації (`SignupForm` ЦІЛА, з початковим станом, бо саме його Next
 * віддає читачеві), і форма «Report a problem». Не константа, не клас, не
 * `data-testid`, не `sr-only`.
 */

const webFiles = sourceFiles(WEB_SRC);
const apiFiles = sourceFiles(API_SRC);

const signupHtml = () => renderComponent(() => <SignupForm />, {});
const reportHtml = () => renderComponent(() => <ReportProblem slug="x" />, {});

/** Слово-число з коду в слово, яким його пише сторінка. */
const AGE_WORDS: Record<string, number> = { sixteen: 16, eighteen: 18, twenty: 20 };

test.describe('умови §4: що сайт приймає від читача', () => {
  /** Код, що приймає файл від читача. Нуль — і саме це стверджує сторінка. */
  function uploadSites(): string[] {
    const probes: Array<[string, RegExp]> = [
      ['FileInterceptor-родина', /\b(?:File|Files|AnyFiles|FileFields)Interceptor\b/],
      ['MulterModule', /\bMulterModule\b/],
      ['multer', /['"]multer['"]/],
      ['input type=file', /type\s*[=:]\s*\{?\s*['"]file['"]/],
      ['new FormData', /\bnew FormData\(/],
    ];
    const hits: string[] = [];
    for (const f of [...webFiles, ...apiFiles]) {
      const code = readCode(f);
      for (const [name, re] of probes) if (re.test(code)) hits.push(`${basename(f)}: ${name}`);
    }
    return hits;
  }

  /** Маршрути API, що пишуть, і названі так, ніби приймають фото чи відгук. */
  function contentRoutes(): { writing: number; contentNamed: string[] } {
    let writing = 0;
    const contentNamed: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name !== 'node_modules' && name !== 'dist' && name !== 'migrations') walk(p);
        } else if (/\.controller\.ts$/.test(name)) {
          const code = readCode(p);
          const base = /@Controller\(\s*['"]([^'"]*)['"]/.exec(code)?.[1] ?? '';
          for (const m of code.matchAll(/@(?:Post|Put|Patch)\(\s*(?:['"]([^'"]*)['"])?\s*\)\s*(?:@[\w]+\([^)]*\)\s*)*(?:async\s+)?(\w+)/g)) {
            writing++;
            const label = `${base}/${m[1] ?? ''} → ${m[2]}`;
            if (/photo|review|upload|image|picture|file|attach/i.test(label)) contentNamed.push(`${name}: ${label}`);
          }
        }
      }
    };
    walk(API_SRC);
    return { writing, contentNamed };
  }

  test('🔴 код не приймає ні файлів, ні фото, ні відгуків — і сторінка не обіцяє їх', () => {
    // Знаменник: скільки файлів прочитано і скільки маршрутів, що пишуть, знайдено.
    expect(webFiles.length + apiFiles.length).toBeGreaterThan(300);
    const { writing, contentNamed } = contentRoutes();
    expect(writing, 'не знайдено жодного @Post — розбір сліпий').toBeGreaterThan(5);

    const uploads = uploadSites();
    const reviewRoutes = contentNamed.filter((c) => /review/i.test(c));
    const uploadRoutes = contentNamed.filter((c) => !/review/i.test(c));
    // Що код ПРИЙМАЄ: ключ — іменник, яким сторінка могла б це назвати.
    const accepts: Record<string, boolean> = {
      photograph: uploads.length > 0 || uploadRoutes.length > 0,
      photo: uploads.length > 0 || uploadRoutes.length > 0,
      picture: uploads.length > 0 || uploadRoutes.length > 0,
      image: uploads.length > 0 || uploadRoutes.length > 0,
      upload: uploads.length > 0 || uploadRoutes.length > 0,
      file: uploads.length > 0 || uploadRoutes.length > 0,
      attachment: uploads.length > 0 || uploadRoutes.length > 0,
      review: reviewRoutes.length > 0,
    };

    const para = paragraphs('terms').find((p) => p.text.includes('If you send us content'));
    expect(para, 'на сторінці немає абзацу «If you send us content»').toBeTruthy();
    const named = Object.keys(accepts).filter((n) => new RegExp(`\\b${n}s?\\b`, 'i').test(para!.text));

    // Сторінка називає лише те, що код приймає…
    expect(
      named.filter((n) => !accepts[n]),
      'сторінка обіцяє приймати те, чого код не приймає',
    ).toEqual([]);
    // …і каже «one thing», тож код не приймає нічого понад форму.
    expect(para!.text).toContain('at the moment that means one thing');
    expect(
      { uploads, uploadRoutes, reviewRoutes },
      'код тепер приймає більше, ніж «one thing» на сторінці умов',
    ).toEqual({ uploads: [], uploadRoutes: [], reviewRoutes: [] });
  });

  test('🔴 форма «Report a problem», названа на сторінці, є на сторінці кемпінгу, текстова, без файлового поля', () => {
    const html = reportHtml();
    expect(visibleText(html)).toContain('Report a problem');
    expect(html.match(/<textarea\b/g) ?? []).toHaveLength(1);
    expect(html).not.toMatch(/type="file"/);
    const para = paragraphs('terms').find((p) => p.text.includes('If you send us content'))!;
    expect(para.text).toContain('“Report a problem” form on a campsite page');
  });
});

test.describe('умови §4: як підтверджується вік', () => {
  test('🔴 вік, названий на сторінці умов, — той, що стверджує форма реєстрації', () => {
    const signup = visibleText(signupHtml());
    const fromForm = /confirm that you are (\w+) or older/.exec(signup)?.[1];
    expect(fromForm, 'форма реєстрації не стверджує віку — сторінка умов каже, що стверджує').toBeTruthy();

    const terms = pageText('terms');
    const mustBe = /You must be (\w+) to open an account/.exec(terms)?.[1];
    const confirm = /confirmation that you are (\w+) or older/.exec(terms)?.[1];
    expect(
      { mustBe, confirm },
      `форма каже «${fromForm}», і обидва місця на сторінці умов мусять казати те саме`,
    ).toEqual({ mustBe: fromForm, confirm: fromForm });
    expect(AGE_WORDS[fromForm!], `невідоме слово віку «${fromForm}»`).toBeTruthy();
  });

  test('🔴 «a sentence above the button, and there is no box to tick»', () => {
    const html = signupHtml();
    const sentence = html.indexOf('you confirm that you are eighteen or older');
    const button = html.search(/<button\b[^>]*type="submit"/);
    expect(sentence, 'у формі немає речення про вік').toBeGreaterThan(-1);
    expect(button, 'у формі немає кнопки відправки').toBeGreaterThan(-1);
    expect(sentence, 'речення про вік стоїть НЕ над кнопкою').toBeLessThan(button);

    // Рівно один чекбокс, і він про розсилку, а не про вік чи умови.
    const boxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatch(/\bname="newsletter"/);

    const terms = pageText('terms');
    expect(terms).toContain('there is no box to tick');
    expect(terms).toContain('in a sentence above the button');
  });

  test('🔴 «We do not ask for your date of birth»: у формі й у запиті реєстрації такого поля немає', () => {
    const html = signupHtml();
    const inputs = [...html.matchAll(/<input\b[^>]*>/g)].map((m) => m[0]);
    expect(inputs.length, 'у формі реєстрації немає жодного поля — розбір сліпий').toBeGreaterThan(1);
    for (const tag of inputs) {
      expect(tag, 'поле, схоже на дату народження').not.toMatch(/type="date"|birth|dob|\bage\b/i);
    }
    // Те саме на боці API: тіло реєстрації не має такого поля.
    const authDir = join(API_SRC, 'auth');
    const authCode = sourceFiles(authDir).map((f) => readCode(f)).join('\n');
    expect(authCode.length).toBeGreaterThan(1000);
    expect(authCode, 'API реєстрації знає про дату народження').not.toMatch(/birth|\bdob\b|dateOfBirth/i);
    expect(pageText('terms')).toContain('We do not ask for your date of birth');
  });
});

test.describe('умови §6: де лежать попередні редакції', () => {
  test('🔴 сторінка не відсилає до репозиторію, а адреса, на яку просить писати, — з реєстру', () => {
    const text = pageText('terms');
    expect(text).not.toMatch(/repository|github|\bgit\b/i);
    const para = paragraphs('terms').find((p) => p.text.includes('we keep every earlier wording ourselves'));
    expect(para, 'немає речення про те, де зберігаються попередні редакції').toBeTruthy();
    // «{{company.email}}» розкрито підстановкою, і розкрито в ту адресу, що в реєстрі.
    expect(para!.text).toContain(CONTACT_EMAIL);
    expect(para!.html).toContain(`mailto:${CONTACT_EMAIL}`);
  });

  test('🔴 «printed at the top of this page»: шаблон друкує версію й дату над текстом', () => {
    const code = readCode(join(WEB_SRC, 'app', 'legal', '[slug]', 'page.tsx'));
    const at = code.indexOf('data-testid="legal-version"');
    const body = code.indexOf('<LegalProse');
    expect(at, 'у шаблоні немає блоку з версією').toBeGreaterThan(-1);
    expect(body, 'у шаблоні немає тексту документа').toBeGreaterThan(-1);
    expect(at, 'версія друкується ПІСЛЯ тексту, а не вгорі').toBeLessThan(body);
    const block = code.slice(at, body);
    expect(block).toContain('doc.version');
    expect(block).toContain('doc.effectiveFrom');
    expect(pageText('terms')).toContain('printed at the top of this page');
  });
});

