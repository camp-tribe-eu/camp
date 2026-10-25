import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { wordingAt } from '../consent/wordings';
import { User } from '../entities/user.entity';
import {
  DELETION_WINDOW_DAYS,
  DELETION_WINDOW_MS,
  EXPORT_STALE_MS,
  EXPORT_TTL_MS,
  PhotoChoice,
  restorableUntil,
} from './account-deletion';
import { looksLikeStoredHash, verifyPassword } from './password';

// Domain errors; the controller maps each to one HTTP answer.
export class WrongPassword extends Error {}
export class NoSuchAccount extends Error {}

/** What the page is told about the archive. */
export type ExportStatus =
  | { status: 'none' }
  | { status: 'preparing'; requestedAt: string }
  | { status: 'ready'; requestedAt: string; expiresAt: string }
  | { status: 'failed'; requestedAt: string };

export type Deleted = {
  /** The last moment signing in brings the account back. */
  restorableUntil: Date;
  /** Photos removed outright (the person chose "delete"). */
  photosDeleted: number;
  /** Photos kept, with the name taken off (the person chose "keep"). */
  photosDetached: number;
};

/** How often the sweep runs. An hour: the units it works in are days. */
export const MAINTENANCE_EVERY_MS = 60 * 60 * 1000;

/**
 * The rows of a result, whichever statement made it.
 *
 * 🔴 TypeORM's postgres `query()` answers `[rows, rowCount]` for UPDATE and
 * DELETE and just `rows` for SELECT and INSERT. Counting the first with
 * `.length` is always 2, which is how a "deleted 2 accounts" was read off a
 * statement that deleted none. A row is an object and never an array, so a
 * two-element array whose first element IS an array can only be the pair.
 */
const rowsOf = (result: unknown): Record<string, any>[] =>
  Array.isArray(result) &&
  result.length === 2 &&
  Array.isArray(result[0]) &&
  typeof result[1] === 'number'
    ? result[0]
    : (result as Record<string, any>[]);

// SQL for timestamps, written once. The archive is read by people AND programs,
// so every instant is ISO 8601 with its zone, never the server's local spelling.
// `timestamp` (no zone) columns are the older ones; they are printed as stored,
// WITHOUT a "Z", rather than claiming a zone nobody recorded.
const tz = (c: string) =>
  `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const naive = (c: string) => `to_char(${c}, 'YYYY-MM-DD"T"HH24:MI:SS.MS')`;

/**
 * Export (GDPR 15) and erasure (GDPR 17) of one account. CAMP-229, part 3.
 *
 * Everything that is promised on the two screens is carried out HERE, and
 * `account-rights.db.spec.ts` asserts each promise against a real database:
 *
 *   · the archive is built after the request is answered, and has a status a
 *     person can come back to;
 *   · deleting ends access in the same request, keeps the row for
 *     `DELETION_WINDOW_DAYS`, and applies the photo choice at once;
 *   · what stays, stays with nothing in it that could name the person.
 */
@Injectable()
export class AccountRightsService
  implements BeforeApplicationShutdown, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly log = new Logger(AccountRightsService.name);

  /** Archives being built after the response was sent. */
  private readonly pending = new Set<Promise<void>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DataSource,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  // ── export (Art. 15) ──────────────────────────────────────────────────

  /**
   * Start an archive, or say that one is already being made.
   *
   * 🔴 ONE STATEMENT DECIDES, so two clicks at once cannot start two builds: the
   * upsert replaces a row only when it is not a FRESH "preparing". A person's
   * data is held in one archive at a time, and a second request while the first
   * is still being made returns the first.
   */
  async requestExport(
    userId: string,
    now: Date = new Date(),
  ): Promise<ExportStatus> {
    const stale = new Date(now.getTime() - EXPORT_STALE_MS);
    const rows = rowsOf(
      await this.db.query(
        `INSERT INTO data_exports (user_id, status, requested_at)
       VALUES ($1, 'preparing', $2)
       ON CONFLICT (user_id) DO UPDATE
         SET status = 'preparing', requested_at = EXCLUDED.requested_at,
             finished_at = NULL, expires_at = NULL, file = NULL
         WHERE data_exports.status <> 'preparing'
            OR data_exports.requested_at < $3
       RETURNING requested_at`,
        [userId, now, stale],
      ),
    );
    // A row came back: this call started the build. None: one is in progress.
    if (rows.length === 1)
      this.later(() => this.build(userId, new Date(rows[0].requested_at)));
    return this.exportStatus(userId, now);
  }

  /** Where the person's archive stands. */
  async exportStatus(
    userId: string,
    now: Date = new Date(),
  ): Promise<ExportStatus> {
    const rows = await this.db.query(
      `SELECT status, requested_at, expires_at FROM data_exports WHERE user_id = $1`,
      [userId],
    );
    if (rows.length === 0) return { status: 'none' };
    const { status, requested_at, expires_at } = rows[0];
    const requestedAt = new Date(requested_at);
    if (status === 'ready') {
      // 🔴 An expired archive is gone as far as anyone can tell, whether or not
      // the sweep has run yet. The check is HERE and not only in the sweep.
      if (new Date(expires_at).getTime() <= now.getTime())
        return { status: 'none' };
      return {
        status: 'ready',
        requestedAt: requestedAt.toISOString(),
        expiresAt: new Date(expires_at).toISOString(),
      };
    }
    if (status === 'preparing') {
      // A "preparing" nobody is working on is a failure, said so (see EXPORT_STALE_MS).
      if (now.getTime() - requestedAt.getTime() >= EXPORT_STALE_MS)
        return { status: 'failed', requestedAt: requestedAt.toISOString() };
      return { status: 'preparing', requestedAt: requestedAt.toISOString() };
    }
    return { status: 'failed', requestedAt: requestedAt.toISOString() };
  }

  /** The finished archive as text, or null when there is none to give. */
  async exportFile(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ filename: string; body: string } | null> {
    const rows = await this.db.query(
      `SELECT file FROM data_exports
        WHERE user_id = $1 AND status = 'ready' AND expires_at > $2`,
      [userId, now],
    );
    if (rows.length === 0) return null;
    return {
      filename: `camptribe-data-${now.toISOString().slice(0, 10)}.json`,
      body: rows[0].file as string,
    };
  }

  /**
   * Make the archive. Runs after the response, once per request.
   *
   * 🔴 THE WRITE NAMES THE REQUEST IT ANSWERS (`requested_at`). A build that was
   * slow, or that outlived a staleness timeout, must not overwrite the archive
   * of a newer request, and must not write at all into a row that the account's
   * deletion has already removed: both are `UPDATE … WHERE` that match nothing.
   */
  private async build(userId: string, requestedAt: Date): Promise<void> {
    try {
      const file = JSON.stringify(await this.assemble(userId), null, 2);
      const finished = new Date();
      await this.db.query(
        `UPDATE data_exports
            SET status = 'ready', file = $3, finished_at = $4, expires_at = $5
          WHERE user_id = $1 AND requested_at = $2 AND status = 'preparing'`,
        [
          userId,
          requestedAt,
          file,
          finished,
          new Date(finished.getTime() + EXPORT_TTL_MS),
        ],
      );
    } catch (e) {
      // Class only, never the message: a driver error can carry a value.
      this.log.error(
        `archive not built (${(e as { name?: string })?.name ?? 'error'})`,
      );
      await this.db
        .query(
          `UPDATE data_exports SET status = 'failed', finished_at = now()
            WHERE user_id = $1 AND requested_at = $2 AND status = 'preparing'`,
          [userId, requestedAt],
        )
        .catch(() => undefined);
    }
  }

  /**
   * Everything we hold about one account, as plain data.
   *
   * 🔴 FIELD BY FIELD, NEVER `SELECT *`. The password hash and the hashes of
   * sessions and links are secrets, not the person's data; a row returned whole
   * would carry them into a file that is emailed, forwarded and kept. Columns
   * are named, so one added to a table tomorrow does not appear here by accident
   * — and one that should, does not vanish by accident either:
   * `account-rights.db.spec.ts` compares the archive with the table's columns.
   *
   * 🔴 WHAT IS NOT HERE, AND SAID IN THE FILE: photo files (there is no upload
   * yet, so there are none) and the moderation records that are kept without a
   * name — those are not about the person any more.
   *
   * Protected, not private, so that a test can hold the build open and watch
   * the "preparing" state.
   */
  protected async assemble(userId: string): Promise<Record<string, unknown>> {
    const q = (sql: string, params: unknown[] = [userId]) =>
      this.db.query(sql, params) as Promise<Record<string, unknown>[]>;

    const [account] = await q(
      `SELECT email, display_name AS "displayName",
              ${naive('created_at')} AS "createdAt",
              ${tz('email_verified_at')} AS "emailConfirmedAt",
              ${tz('marketing_consent_at')} AS "newsletterConsentAt"
         FROM users WHERE id = $1`,
    );
    if (!account) throw new NoSuchAccount();

    const sessions = await q(
      `SELECT ${tz('created_at')} AS "createdAt", ${tz('expires_at')} AS "expiresAt"
         FROM sessions WHERE user_id = $1 ORDER BY created_at, id`,
    );
    // 🔴 CAMP-229 — `newEmail` ТУТ, А НЕ СЕРЕД ПРОПУЩЕНОГО. Адреса, на яку
    // людина попросила перевести акаунт і ще не підтвердила, — це дані про
    // неї, і стаття 15 про них теж. Для решти видів посилань вона порожня.
    const emailLinks = await q(
      `SELECT kind, new_email AS "newEmail", ${tz('created_at')} AS "createdAt",
              ${tz('expires_at')} AS "expiresAt", ${tz('used_at')} AS "usedAt"
         FROM auth_tokens WHERE user_id = $1 ORDER BY created_at, id`,
    );
    const trips = await q(
      `SELECT id, name, start_date::text AS "startDate", end_date::text AS "endDate",
              ${naive('created_at')} AS "createdAt"
         FROM trips WHERE user_id = $1 ORDER BY created_at, id`,
    );
    const stops = trips.length
      ? await q(
          `SELECT trip_id AS "tripId", sequence, camping_spot_id AS "campsiteId",
                  arrival_date::text AS "arrivalDate"
             FROM trip_stops WHERE trip_id = ANY($1) ORDER BY trip_id, sequence`,
          [trips.map((t) => t.id)],
        )
      : [];
    // 🔴 CAMP-390 — ЖУРНАЛ ЗГОД ТУТ, бо стаття 15 без нього неповна: людина має
    // право знати не лише «коли», а й НА ЩО погодилась, і чи відкликала.
    // Усі рядки, у порядку запису, відкликання поруч із наданням. Текст
    // формулювання дістається з реєстру за (ключем, версією), тобто той, що
    // діяв тоді, а не чинний сьогодні.
    const consentRows = await q(
      `SELECT kind, granted, source, wording_key AS "wordingKey",
              wording_version AS "wordingVersion",
              ${tz('recorded_at')} AS "recordedAt"
         FROM consent_record WHERE user_id = $1 ORDER BY recorded_at, id`,
    );
    const photos = await q(
      `SELECT id, camping_spot_id AS "campsiteId", source, shot_on::text AS "shotOn",
              licence_publish AS "licencePublish",
              licence_sublicense AS "licenceSublicense",
              licence_attribution_name AS "creditedAs", status,
              rejection_reason AS "rejectionReason",
              ${tz('reviewed_at')} AS "reviewedAt",
              ${naive('created_at')} AS "submittedAt"
         FROM photo_submissions WHERE submitted_by_id = $1 ORDER BY created_at, id`,
    );
    const reviews = await q(
      `SELECT id, camping_spot_id AS "campsiteId", rating, body,
              stayed_on::text AS "stayedOn", status,
              rejection_reason AS "rejectionReason",
              ${tz('reviewed_at')} AS "reviewedAt",
              ${naive('created_at')} AS "submittedAt"
         FROM reviews WHERE author_id = $1 ORDER BY created_at, id`,
    );

    return {
      about: {
        what: 'Everything CampTribe holds about your account, as of generatedAt.',
        format: 'camptribe-data-export',
        version: 1,
        generatedAt: new Date().toISOString(),
        notIncluded: [
          'Photo files: there is no photo upload yet, so there are none. Records about photos are under "photos".',
          'Your password and the secrets behind sessions and email links: they are not your data, and a file that is emailed and forwarded must not carry them.',
        ],
      },
      account,
      // 🔴 `wording.text` — `null`, а не пропуск і не падіння, коли реєстр не
      // знає (ключа, версії) з рядка: один рядок, що посилається на втрачений
      // текст, коштує одного `null`, а не всього вивантаження.
      consentLog: consentRows.map((c) => ({
        kind: c.kind,
        granted: c.granted,
        source: c.source,
        recordedAt: c.recordedAt,
        wording: {
          key: c.wordingKey,
          version: c.wordingVersion,
          text:
            wordingAt(c.wordingKey as string, c.wordingVersion as number)
              ?.text ?? null,
        },
      })),
      sessions,
      emailLinks,
      trips: trips.map((t) => ({
        ...t,
        stops: stops
          .filter((s) => s.tripId === t.id)
          .map((s) => ({
            sequence: s.sequence,
            campsiteId: s.campsiteId,
            arrivalDate: s.arrivalDate,
          })),
      })),
      photos,
      reviews,
    };
  }

  // ── erasure (Art. 17) ─────────────────────────────────────────────────

  /**
   * Delete an account: end access now, apply the photo choice now, and leave
   * the rest to be erased after the window.
   *
   * 🔴 ACCESS ENDS IN THIS REQUEST. The sessions are deleted in the same
   * transaction that marks the account, so there is no instant at which the row
   * says "deleted" and a token still opens it, and none at which the tokens are
   * gone and the account is not marked. `GET /auth/me` with the same token is
   * 401 the moment this returns; that is a test over HTTP, not a claim.
   *
   * 🔴 THE PASSWORD IS ASKED AGAIN, on top of the session. A token left on a
   * shared laptop, or taken from storage by a script, must not be enough to
   * destroy somebody's account. It is checked BEFORE the transaction: scrypt
   * takes 200 ms, and a row lock held for that long is a lock held on the
   * person's whole account.
   *
   * 🔴 WHAT HAPPENS TO PHOTOS IS APPLIED NOW, NOT AT THE END OF THE WINDOW. A
   * person who chose "delete the photos too" asked for them to come off the
   * pages, and thirty days of waiting for that would be the delay the window is
   * not allowed to be. The consequence is said on the screen: signing back in
   * restores the account, not the photos.
   */
  async deleteAccount(
    userId: string,
    input: { password: string; photos: PhotoChoice },
    now: Date = new Date(),
  ): Promise<Deleted> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new NoSuchAccount();
    const hash = user.passwordHash;
    // A stored value that is not a hash we could have written is refused, as at
    // sign-in, rather than handed to scrypt.
    const ok = looksLikeStoredHash(hash)
      ? await verifyPassword(input.password, hash)
      : false;
    if (!ok) throw new WrongPassword();

    return this.db.transaction(async (m) => {
      // Lock order: the user row first, as in `AccountService.resetWith`.
      const locked = await m.query(
        `SELECT deleted_at FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      if (locked.length === 0) throw new NoSuchAccount();
      // Asked twice at once: the second finds it already done, and says the
      // same as the first rather than failing a person who clicked twice.
      if (locked[0].deleted_at !== null) {
        return {
          restorableUntil: restorableUntil(new Date(locked[0].deleted_at)),
          photosDeleted: 0,
          photosDetached: 0,
        };
      }

      // What stays: THAT a submission was rejected, why and when — and nothing
      // that could name the person (the table has no such column).
      await m.query(
        `INSERT INTO moderation_log
           (kind, camping_spot_id, outcome, reason, submitted_at, decided_at)
         SELECT 'photo', camping_spot_id, 'rejected', rejection_reason,
                created_at::timestamptz, reviewed_at
           FROM photo_submissions
          WHERE submitted_by_id = $1 AND status = 'rejected'`,
        [userId],
      );
      await m.query(
        `INSERT INTO moderation_log
           (kind, camping_spot_id, outcome, reason, submitted_at, decided_at)
         SELECT 'review', camping_spot_id, 'rejected', rejection_reason,
                created_at::timestamptz, reviewed_at
           FROM reviews
          WHERE author_id = $1 AND status = 'rejected'`,
        [userId],
      );

      let photosDeleted = 0;
      let photosDetached = 0;
      if (input.photos === 'delete') {
        // 🔴 When photo upload exists, the stored files go here: this is the
        // only place that knows which keys belonged to this person, and once
        // the rows are gone nothing does.
        photosDeleted = rowsOf(
          await m.query(
            `DELETE FROM photo_submissions WHERE submitted_by_id = $1 RETURNING id`,
            [userId],
          ),
        ).length;
      } else {
        // Kept, but no longer his or hers: unlinked, the name taken off, and
        // credited to "the community" as the screen promises. The licence
        // columns stay — that is a contract about the file, not personal data.
        photosDetached = rowsOf(
          await m.query(
            `UPDATE photo_submissions
                SET submitted_by_id = NULL, licence_attribution_name = NULL,
                    source = 'community'
              WHERE submitted_by_id = $1 RETURNING id`,
            [userId],
          ),
        ).length;
      }
      // Their own words are theirs: reviews go, whichever way the photos went.
      await m.query(`DELETE FROM reviews WHERE author_id = $1`, [userId]);

      await m.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
      // Links in letters already sent: a reset link must not be a way back that
      // the password is not (the screen says "only by signing in").
      await m.query(`DELETE FROM auth_tokens WHERE user_id = $1`, [userId]);
      await m.query(`DELETE FROM data_exports WHERE user_id = $1`, [userId]);
      await m.query(`UPDATE users SET deleted_at = $2 WHERE id = $1`, [
        userId,
        now,
      ]);

      return {
        restorableUntil: restorableUntil(now),
        photosDeleted,
        photosDetached,
      };
    });
  }

  /**
   * Erase, for good, the accounts whose window has run out, and the archives
   * that have expired.
   *
   * The account row's own foreign keys do the rest: trips and their stops go
   * with it (ON DELETE CASCADE), as do any sessions, links and archives left;
   * photo and review rows would be unlinked (ON DELETE SET NULL), though by now
   * the deletion request has already dealt with both.
   */
  async purge(
    now: Date = new Date(),
  ): Promise<{ accounts: number; exports: number }> {
    const cutoff = new Date(now.getTime() - DELETION_WINDOW_MS);
    const accounts = rowsOf(
      await this.db.query(
        `DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at <= $1 RETURNING id`,
        [cutoff],
      ),
    );
    const exports = rowsOf(
      await this.db.query(
        `DELETE FROM data_exports WHERE expires_at <= $1 RETURNING user_id`,
        [now],
      ),
    );
    return { accounts: accounts.length, exports: exports.length };
  }

  // ── running ───────────────────────────────────────────────────────────

  /**
   * 🔴 THE SWEEP RUNS INSIDE THE API, because nothing else runs it: a
   * window that is promised and never closed would keep the data for ever, and
   * the screen would be wrong. Once at start (a process that was down over the
   * deadline catches up), then hourly; the timer is `unref`ed so it never keeps
   * a stopping process alive.
   *
   * Said at boot, like the mail and build-token lines, so that "is it
   * running" has an answer in the log.
   */
  onApplicationBootstrap(): void {
    this.log.log(
      `purge: accounts deleted more than ${DELETION_WINDOW_DAYS} days ago and expired archives, every ${MAINTENANCE_EVERY_MS / 60_000} min`,
    );
    const run = () =>
      this.purge().then(
        (r) => {
          if (r.accounts > 0 || r.exports > 0)
            this.log.log(
              `purged ${r.accounts} account(s), ${r.exports} archive(s)`,
            );
        },
        (e: unknown) =>
          this.log.error(
            `purge failed (${(e as { name?: string })?.name ?? 'error'})`,
          ),
      );
    void run();
    this.timer = setInterval(() => void run(), MAINTENANCE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Run `job` after the current response has gone out. Failures are logged by
   * class only, as in `AccountService.later`.
   */
  private later(job: () => Promise<void>): void {
    const done = new Promise<void>((resolve) => {
      setImmediate(() => {
        job()
          .catch((e: unknown) =>
            this.log.error(
              `background job failed (${(e as { name?: string })?.name ?? 'error'})`,
            ),
          )
          .finally(resolve);
      });
    });
    this.pending.add(done);
    void done.then(() => this.pending.delete(done));
  }

  /** Wait for every archive being built. Tests call it; shutdown does too. */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  beforeApplicationShutdown(): Promise<void> {
    return this.drain();
  }
}
