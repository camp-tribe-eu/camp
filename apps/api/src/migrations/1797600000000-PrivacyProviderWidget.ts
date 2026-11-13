import { MigrationInterface, QueryRunner } from 'typeorm';
import { PrivacyPersonaChoice1797100100000 } from './1797100100000-PrivacyPersonaChoice';
import {
  applyLegalUpdate,
  replaceOnce,
  revertLegalUpdate,
} from '../pages/legal-update';

/**
 * Приватність 2.8 → 2.9 (CAMP-523): блок, який кемпінг вбудовує на свій
 * сайт, вантажиться з НАШОГО сервера. Отже відвідувач чужого сайту лишає
 * рядок у нашому журналі доступу, жодного разу не відкривши camptribe.eu.
 * Політика мусить це назвати: це єдине місце, де людина, що нас не
 * відвідувала, потрапляє в наші дані.
 *
 * 🔴 ЩО ПИШЕ ЖУРНАЛ — ЗАМІРЯНО НА МАШИНІ 13.11.2026, А НЕ ПЕРЕПИСАНО З
 * ПОПЕРЕДНЬОЇ РЕДАКЦІЇ. Блок `log` у Caddyfile не має ні `format`, ні
 * фільтра полів, тож пишеться типовий JSON Caddy: час, IP, метод, адреса,
 * статус, байти, тривалість, TLS — і КОЖЕН заголовок запиту поіменно.
 * Імена полів останнього рядка та імена заголовків у всьому файлі (89
 * рядків): серед них `User-Agent` (89 з 89) і `Referer` (4 з 89).
 * `Cookie`/`Authorization` — слово REDACTED (40 з 40 значень).
 * Зберігання: `/etc/logrotate.d/camptribe-caddy` — `daily`, `rotate 13`,
 * `maxage 14`.
 *
 * 🔴 І ЗАМІР ЗНАЙШОВ ПРОГАЛИНУ В ЧИННОМУ ТЕКСТІ. Перелік «Each line
 * holds» не називав реферер, хоча журнал його пише, коли браузер його
 * надсилає. Для віджета це не дрібниця: реферер — це адреса сайту
 * кемпінгу, на якому людина була. Тому тут ДВІ зміни: рядок у загальному
 * переліку і новий підрозділ про блок.
 *
 * 🔴 ЧОГО ТЕКСТ НЕ ОБІЦЯЄ. Код вставки, який ми даємо, несе
 * `referrerpolicy="no-referrer"` (тест `what the campsite pastes`). Але
 * чужий сайт може цей атрибут прибрати — тож політика каже «код, який ми
 * даємо, просить не надсилати», а не «ми не дізнаємось».
 */
export class PrivacyProviderWidget1797600000000 implements MigrationInterface {
  name = 'PrivacyProviderWidget1797600000000';

  readonly previous = new PrivacyPersonaChoice1797100100000().page;

  readonly page = (() => {
    let body = replaceOnce(
      this.previous.body,
      '- the address of the page you asked for, the method, and the status we answered with;',
      `- the address of the page you asked for, the method, and the status we answered with;
- the address of the page that led you to us, when your browser sends one (the referrer);`,
    );
    body = replaceOnce(
      body,
      '### When something breaks in your browser {#browser-errors}',
      `### Our block on a campsite’s own website {#widget}

A campsite can show a small block from this site on its own website: what lies around it, with a link to its page here. The block is loaded from our server. So when you open a page of theirs that shows it, your browser sends us one request, and that request becomes one line in the security log described above — the same line, with the same contents, as if you had opened a page of this site, on the same legal basis and for the same fourteen days.

The block sets no cookies, runs no script and writes nothing into your browser’s storage. The code we give campsites asks your browser not to send us the referrer, which here would be the address of the page of theirs you were reading; a website that changes that code may let your browser send it, and then it is in the line with the rest. We learn nothing else about your visit to that website. What that website does with your data is described in its own privacy notice, not in this one.

### When something breaks in your browser {#browser-errors}`,
    );
    return {
      // Літерал: сторож реєстру шукає останню міграцію політики за `slug: 'privacy'`.
      slug: 'privacy',
      title: this.previous.title,
      summary: this.previous.summary,
      version: '2.9',
      effectiveFrom: '2026-11-13',
      body,
    };
  })();

  public async up(queryRunner: QueryRunner): Promise<void> {
    await applyLegalUpdate(queryRunner, this.page, this.previous);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await revertLegalUpdate(queryRunner, this.page, this.previous);
  }
}
