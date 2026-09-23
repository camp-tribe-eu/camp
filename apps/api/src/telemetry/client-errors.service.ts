import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientError } from '../entities/client-error.entity';
import { allow, prune, RATE, validate } from './client-errors.rules';
import type { Bucket, IncomingReport } from './client-errors.rules';

// CAMP-92 — storage. Every rule this applies lives in ./client-errors.rules,
// which has its own spec; this file is only the part that needs a database.

export type { IncomingReport } from './client-errors.rules';

@Injectable()
export class ClientErrorsService {
  private readonly bucket: Bucket = new Map();
  private lastPrune = 0;

  constructor(
    @InjectRepository(ClientError)
    private readonly repo: Repository<ClientError>,
  ) {}

  async accept(
    body: IncomingReport,
  ): Promise<'stored' | 'rejected' | 'throttled'> {
    const row = validate(body);
    if (!row) return 'rejected';

    const now = Date.now();
    if (now - this.lastPrune > RATE.windowMs) {
      prune(this.bucket, now);
      this.lastPrune = now;
    }
    if (!allow(this.bucket, `${row.fingerprint}|${row.path}`, now)) {
      return 'throttled';
    }

    await this.repo.insert(row);
    return 'stored';
  }

  /** For the check the card asks for: a deliberately broken page has to
   *  produce a record, and something has to be able to read it back. */
  async recent(limit = 50): Promise<ClientError[]> {
    return this.repo.find({
      order: { receivedAt: 'DESC' },
      take: Math.min(Math.max(1, limit), 200),
    });
  }
}
