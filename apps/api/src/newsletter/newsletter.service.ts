import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { MAILER } from '../auth/account.service';
import { newsletterConfirmMessage, type Mailer } from '../auth/mail';
import { newToken, tokenHash } from '../auth/session';
import type { ParsedSubscription } from './newsletter.rules';

/** Скільки живе посилання «підтвердити» в листі. Лист каже ці ж 48 годин — з цієї константи. */
export const CONFIRM_TTL_HOURS = 48;
/** Скільки днів адреса може бути pending. Політика каже ці ж «7 days»; тест читає її звідси. */
export const PENDING_KEPT_DAYS = 7;
/** Не частіше одного листа на адресу за цей час. Мовчки: відповідь та сама. */
export const RESEND_GAP_MINUTES = 10;

export type SubscribeOutcome =
  /** Прийнято — або скрипту так сказано. Викликач не розрізняє, і не має. */
  | 'accepted'
  /** Немає відправника. Залежить лише від налаштувань, тож не підказка про адресу. */
  | 'unavailable';

/**
 * 🔴 ВІДПОВІДЬ ПОВЕРТАЄТЬСЯ ДО ТОГО, ЯК ЛИСТ ВІДПРАВЛЕНО.
 *
 * Нова й pending-адреса — це лист, підтверджена — ні. Якби відповідь чекала
 * SMTP, секунда різниці в часі була б оракулом «ця адреса вже в базі».
 * Тому лист іде у фоні: `delivery` — проміс, який ніколи не відхиляється (він
 * сам логує клас помилки й скасовує «відправлено» в базі), а контролер його не
 * чекає. Тести чекають.
 */
export type SubscribeResult = {
  outcome: SubscribeOutcome;
  delivery: Promise<void>;
};

@Injectable()
export class NewsletterService {
  private readonly log = new Logger(NewsletterService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(MAILER) private readonly mailer: Mailer | null,
  ) {}

  /**
   * 🔴 ЧИСТКА НЕПІДТВЕРДЖЕНИХ — НА ШЛЯХУ ЗАПИТУ, не окремою задачею: щоразу, коли
   * хтось підписується або підтверджує, спершу видаляються pending-адреси
   * старші за `PENDING_KEPT_DAYS` від ПЕРШОГО запиту (повторні листи строк не
   * продовжують — `created_at` при повторі не міняється). Межа: якщо ніхто не
   * підписується й не підтверджує, прострочені лежать, доки хтось не прийде.
   * Один оператор, по індексу на `status` не потрібен — таблиця мала.
   */
  private purgeStale(): Promise<unknown> {
    return this.db.query(
      `DELETE FROM newsletter_subscribers
        WHERE status = 'pending'
          AND created_at < now() - ($1 * interval '1 day')`,
      [PENDING_KEPT_DAYS],
    );
  }

  async subscribe(sub: ParsedSubscription): Promise<SubscribeResult> {
    const done = Promise.resolve();
    // 🔴 Скрипт отримує те саме, що людина, і нічого не відбувається.
    if (sub.spam) return { outcome: 'accepted', delivery: done };

    const webBase = this.mailer?.webBase ?? null;
    if (!this.mailer || webBase === null)
      return { outcome: 'unavailable', delivery: done };

    await this.purgeStale();

    const confirm = newToken();
    const unsubscribe = newToken();
    const confirmHash = tokenHash(confirm);

    // 🔴 ОДИН ОПЕРАТОР НА ВСІ ТРИ ВИПАДКИ. Нова адреса вставляється. Існуюча —
    // оновлюється ЛИШЕ коли лист справді треба слати:
    //   · unsubscribed → знову pending (людина сама попросила ще раз: це нова
    //     згода), лічильник 7 днів іде заново;
    //   · pending, лист за останні RESEND_GAP хвилин не йшов → новий токен, але
    //     `created_at` НЕ чіпаємо — 7 днів рахуються від першого запиту;
    //   · confirmed, або pending із щойно надісланим листом → нічого не
    //     міняється, `RETURNING` порожній, листа немає.
    // «Коли йшов останній лист» не зберігається окремо: це `expires_at` мінус
    // TTL — одна колонка менше.
    const rows: Array<{ id: string }> = await this.db.query(
      `INSERT INTO newsletter_subscribers
         (email, status, confirm_token_hash, confirm_token_expires_at, unsubscribe_token_hash)
       VALUES ($1, 'pending', $2, now() + ($3 * interval '1 hour'), $4)
       ON CONFLICT (email) DO UPDATE SET
         status = 'pending',
         confirm_token_hash = EXCLUDED.confirm_token_hash,
         confirm_token_expires_at = EXCLUDED.confirm_token_expires_at,
         unsubscribe_token_hash = EXCLUDED.unsubscribe_token_hash,
         created_at = CASE WHEN newsletter_subscribers.status = 'unsubscribed'
                           THEN now() ELSE newsletter_subscribers.created_at END,
         confirmed_at = NULL,
         unsubscribed_at = NULL
       WHERE newsletter_subscribers.status = 'unsubscribed'
          OR (newsletter_subscribers.status = 'pending'
              AND newsletter_subscribers.confirm_token_expires_at
                  < now() + ($3 * interval '1 hour') - ($5 * interval '1 minute'))
       RETURNING id::text AS id`,
      [
        sub.email,
        confirmHash,
        CONFIRM_TTL_HOURS,
        tokenHash(unsubscribe),
        RESEND_GAP_MINUTES,
      ],
    );
    if (rows.length === 0) return { outcome: 'accepted', delivery: done };

    // 🔴 ПОСИЛАННЯ ВЕДУТЬ НА СТОРІНКИ САЙТУ, а не в API: відкриття нічого не
    // міняє, зміну робить кнопка (POST). База — з налаштувань, не із запиту.
    const message = newsletterConfirmMessage(
      sub.email,
      `${webBase}/newsletter/confirm?token=${encodeURIComponent(confirm)}`,
      `${webBase}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribe)}`,
      `${webBase}/legal/privacy#newsletter`,
      CONFIRM_TTL_HOURS,
    );
    const sender = this.mailer.sender;
    const delivery = (async () => {
      try {
        await sender.send(message);
      } catch (e) {
        // 🔴 ЛИШЕ КЛАС ПОМИЛКИ: текст може містити адресу. І «лист не пішов»
        // записується в базу — строк токена стає «зараз», тож наступне
        // натискання не чекає десять хвилин на лист, якого не було.
        this.log.warn(
          `newsletter letter not sent: ${(e as Error)?.name ?? 'Error'}`,
        );
        try {
          await this.db.query(
            `UPDATE newsletter_subscribers
                SET confirm_token_expires_at = now()
              WHERE id = $1::uuid AND confirm_token_hash = $2`,
            [rows[0].id, confirmHash],
          );
        } catch {
          /* найгірший наслідок — десять хвилин очікування */
        }
      }
    })();
    return { outcome: 'accepted', delivery };
  }

  /**
   * Підтвердити за токеном із листа. `true` — підтверджено цим викликом.
   * Непідтверджена, прострочена чи невідома — `false`, і база не міняється.
   * Одноразово: токен зануляється в тому ж операторі, що міняє стан.
   */
  async confirm(token: string): Promise<boolean> {
    await this.purgeStale();
    // 🔴 `WITH … SELECT`, не голий `UPDATE … RETURNING`: TypeORM повертає з
    // UPDATE/DELETE пару `[рядки, кількість]`, а не масив рядків — `rows.length`
    // там завжди 2, і перша версія цього коду читала хибне «не підтверджено».
    const rows = await this.db.query(
      `WITH hit AS (
       UPDATE newsletter_subscribers
          SET status = 'confirmed',
              confirmed_at = now(),
              confirm_token_hash = NULL,
              confirm_token_expires_at = NULL
        WHERE confirm_token_hash = $1
          AND status = 'pending'
          AND confirm_token_expires_at > now()
        RETURNING id::text AS id)
       SELECT id FROM hit`,
      [tokenHash(token)],
    );
    return rows.length === 1;
  }

  /**
   * Відписатися за довгим токеном. `true` — адреса за токеном тепер
   * unsubscribed (і була такою вже, якщо посилання відкрили вдруге: відписка
   * ідемпотентна, дата першої не затирається). Невідомий токен — `false`.
   */
  async unsubscribe(token: string): Promise<boolean> {
    const rows = await this.db.query(
      `WITH hit AS (
       UPDATE newsletter_subscribers
          SET unsubscribed_at = CASE WHEN status = 'unsubscribed'
                                     THEN unsubscribed_at ELSE now() END,
              status = 'unsubscribed',
              confirm_token_hash = NULL,
              confirm_token_expires_at = NULL
        WHERE unsubscribe_token_hash = $1
        RETURNING id::text AS id)
       SELECT id FROM hit`,
      [tokenHash(token)],
    );
    return rows.length === 1;
  }
}
