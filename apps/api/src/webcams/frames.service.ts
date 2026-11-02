import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { FrameCache, FramesRefused } from './frames';

/** Windy answers in well under a second; ten is already a failure. */
const WINDY_TIMEOUT_MS = 8_000;

/**
 * 🔴 THE KEY IS READ HERE AND GOES INTO ONE HEADER. It is never put in a
 * URL, a log line, an error message or a response body: the repository
 * is public and a key in a log is a key in the world.
 */
@Injectable()
export class FramesService {
  private readonly log = new Logger(FramesService.name);
  private readonly cache: FrameCache;

  constructor(@InjectDataSource() private readonly db: DataSource) {
    this.cache = new FrameCache({
      now: () => Date.now(),
      known: async (refs) => {
        const rows: Array<{ ref: string }> = await this.db.query(
          `SELECT ref FROM webcams WHERE provider = 'windy' AND ref = ANY($1::text[])`,
          [refs],
        );
        return rows.map((r) => r.ref);
      },
      callWindy: (url) => {
        const key = process.env.WINDY_WEBCAMS_API_KEY;
        if (!key) return Promise.reject(new Error('no key'));
        return fetch(url, {
          headers: { 'x-windy-api-key': key },
          signal: AbortSignal.timeout(WINDY_TIMEOUT_MS),
        });
      },
    });
  }

  async frames(refs: string[]): Promise<{ frames: Record<string, string> }> {
    try {
      return { frames: await this.cache.frames(refs) };
    } catch (e) {
      if (e instanceof FramesRefused) {
        this.log.warn(`frames refused: ${e.status} ${e.message}`);
        throw new HttpException(e.message, e.status);
      }
      this.log.error(`frames failed: ${(e as Error).name}`);
      throw new ServiceUnavailableException('frames are not available');
    }
  }
}
