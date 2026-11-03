import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MAILER } from '../auth/account.service';
import { claimSpotMessage, type Mailer } from '../auth/mail';
import {
  CODE_TTL_MS,
  MAX_ATTEMPTS,
  type ConfirmRefusal,
  type StartRefusal,
  codeHash,
  confirmRefusal,
  maskEmail,
  newCode,
  osmEmail,
  startRefusal,
  updatedRowCount,
} from './spot-claim';

export type StartResult =
  | { ok: true; sentTo: string; expiresAt: Date }
  | { ok: false; why: StartRefusal | 'no-spot' | 'mail-unavailable' };

export type ConfirmResult =
  { ok: true } | { ok: false; why: ConfirmRefusal | 'no-spot' };

/**
 * «Claim your listing». CAMP-51.
 *
 * 🔴 РІШЕННЯ ЖИВУТЬ У `spot-claim.ts`, ТУТ ЛИШЕ БАЗА Й ПОШТА. Сторож,
 * який можна перевірити лише піднявши HTTP, перевіряють один раз — тому
 * вся відмовна логіка чиста й накрита 28 випадками без Nest.
 */
@Injectable()
export class SpotClaimService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(MAILER) private readonly mailer: Mailer | null,
  ) {}

  /** Початок доби за UTC — вікно, у якому рахуються межі розсилки. */
  private static dayAgo(now: Date): Date {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  async start(spotSlug: string, viewerId: string | null): Promise<StartResult> {
    const rows = (await this.db.query(
      `SELECT id, name, contact FROM camping_spots WHERE slug = $1`,
      [spotSlug],
    )) as { id: string; name: string | null; contact: unknown }[];
    if (rows.length === 0) return { ok: false, why: 'no-spot' };
    const spot = rows[0];

    const now = new Date();
    const since = SpotClaimService.dayAgo(now);
    const [{ owner }] = (await this.db.query(
      `SELECT max(user_id::text) AS owner FROM spot_claims
        WHERE camping_spot_id = $1 AND used_at IS NOT NULL`,
      [spot.id],
    )) as { owner: string | null }[];
    const [{ for_spot }] = (await this.db.query(
      `SELECT count(*)::int AS for_spot FROM spot_claims
        WHERE camping_spot_id = $1 AND created_at >= $2`,
      [spot.id, since],
    )) as { for_spot: number }[];
    const [{ by_user }] = (await this.db.query(
      `SELECT count(*)::int AS by_user FROM spot_claims
        WHERE user_id = $1 AND created_at >= $2`,
      [viewerId ?? '00000000-0000-0000-0000-000000000000', since],
    )) as { by_user: number }[];

    const refusal = startRefusal({
      viewerId,
      contact: spot.contact as Record<string, unknown> | null,
      confirmedOwnerId: owner,
      sentForSpotToday: for_spot,
      sentByUserToday: by_user,
    });
    if (refusal) return { ok: false, why: refusal };

    // 🔴 АДРЕСА БЕРЕТЬСЯ ТУТ І БІЛЬШЕ НІДЕ. Ні з тіла запиту, ні з
    // профілю: інакше це перестає бути доказом володіння.
    const to = osmEmail(spot.contact as Record<string, unknown>);
    const masked = to === null ? null : maskEmail(to);
    if (to === null || masked === null) return { ok: false, why: 'no-email' };
    if (!this.mailer) return { ok: false, why: 'mail-unavailable' };

    const code = newCode();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    await this.db.query(
      `INSERT INTO spot_claims
         (camping_spot_id, user_id, code_hash, sent_to_masked, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [spot.id, viewerId, codeHash(code), masked, expiresAt],
    );
    await this.mailer.sender.send(
      claimSpotMessage(
        to,
        code,
        spot.name ?? 'this campsite',
        Math.round(CODE_TTL_MS / 3_600_000),
      ),
    );
    return { ok: true, sentTo: masked, expiresAt };
  }

  async confirm(
    spotSlug: string,
    viewerId: string | null,
    code: string,
  ): Promise<ConfirmResult> {
    const rows = (await this.db.query(
      `SELECT id FROM camping_spots WHERE slug = $1`,
      [spotSlug],
    )) as { id: string }[];
    if (rows.length === 0) return { ok: false, why: 'no-spot' };
    const spotId = rows[0].id;

    const pending = (await this.db.query(
      `SELECT id, user_id, code_hash, expires_at, used_at, attempts
         FROM spot_claims
        WHERE camping_spot_id = $1 AND user_id = $2 AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [spotId, viewerId ?? '00000000-0000-0000-0000-000000000000'],
    )) as {
      id: string;
      user_id: string;
      code_hash: string;
      expires_at: Date;
      used_at: Date | null;
      attempts: number;
    }[];

    const why = confirmRefusal(
      viewerId,
      pending.length === 0
        ? null
        : {
            userId: pending[0].user_id,
            codeHash: pending[0].code_hash,
            expiresAt: new Date(pending[0].expires_at),
            usedAt: pending[0].used_at,
            attempts: pending[0].attempts,
          },
      code,
      new Date(),
    );
    if (why) {
      // 🔴 НЕВДАЛА СПРОБА КОШТУЄ СПРОБИ, І САМЕ ТОМУ ПЕРЕБІР СКІНЧЕННИЙ.
      // Рахуємо лише хибний код: протермінована чи спалена заявка не має
      // палити лічильник ще раз.
      if (why === 'wrong-code' && pending.length > 0) {
        await this.db.query(
          `UPDATE spot_claims SET attempts = attempts + 1 WHERE id = $1`,
          [pending[0].id],
        );
      }
      return { ok: false, why };
    }

    // 🔴 `WHERE used_at IS NULL` — ТУТ, А НЕ В ПЕРЕВІРЦІ ВИЩЕ. Між SELECT
    // і UPDATE встигає другий запит; виграти має рівно один, і вирішує це
    // база, а не порядок рядків у коді.
    const res = (await this.db.query(
      `UPDATE spot_claims SET used_at = now()
        WHERE id = $1 AND used_at IS NULL
        RETURNING id`,
      [pending[0].id],
    )) as unknown[];
    if (updatedRowCount(res) === 0) return { ok: false, why: 'no-pending' };
    return { ok: true };
  }

  /** Чи тримає цей акаунт грант на цей кемпінг. */
  async isOwner(spotId: string, viewerId: string): Promise<boolean> {
    const [{ n }] = (await this.db.query(
      `SELECT count(*)::int AS n FROM spot_claims
        WHERE camping_spot_id = $1 AND user_id = $2 AND used_at IS NOT NULL`,
      [spotId, viewerId],
    )) as { n: number }[];
    return n > 0;
  }
}

export { MAX_ATTEMPTS };
