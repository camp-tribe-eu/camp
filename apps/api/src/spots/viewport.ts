// CAMP-32: the viewport itself — parsing it, and the rule that turns it
// into a cluster grid.
//
// 🔴 Separate from map.service.ts so it can be unit-tested. The service
// imports @nestjs/typeorm, which ships as ESM; Jest runs CommonJS here
// and refuses to parse it, so a spec that reached these functions
// through the service could not run at all. Validation logic that
// cannot be tested is the last thing that should be hard to test.

import { BadRequestException } from '@nestjs/common';

/** A degenerate or absurd viewport is a bug upstream, not a query. */
const MAX_SPAN_DEG = 360;

/**
 * The cap on points returned for one viewport. It is a safety valve, not
 * a paging mechanism: at the zoom levels that ask for points the window
 * is small enough that it is never reached. When it IS reached the
 * response says so, and the client falls back to clusters rather than
 * drawing a silently truncated map.
 */
export const POINT_LIMIT = 2000;

/**
 * Cells across the viewport when clustering. Higher means smaller, more
 * numerous clusters. Eight keeps a continent-wide view at a few dozen
 * bubbles, which is readable and cheap to draw.
 */
const CELLS_ACROSS = 8;

export interface Bbox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/**
 * Parse and check a `minLon,minLat,maxLon,maxLat` string.
 *
 * 🔴 Strict on purpose. `Number('')` is 0 and `Number('abc')` is NaN, and
 * a NaN reaching ST_MakeEnvelope produces an empty envelope — an empty
 * map with a 200 status, which looks like "no campsites here" rather
 * than "the request was wrong".
 */
export function parseBbox(raw: unknown): Bbox {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException(
      'bbox is required, as minLon,minLat,maxLon,maxLat',
    );
  }
  const parts = raw.split(',');
  if (parts.length !== 4) {
    throw new BadRequestException('bbox needs exactly four numbers');
  }
  const [minLon, minLat, maxLon, maxLat] = parts.map((p) => {
    const text = p.trim();
    // 🔴 The empty segment, checked before Number() rather than after.
    // `Number('')` is 0, not NaN, so "13.3,,16.6,46.9" sailed through
    // the finite check as a viewport starting at the equator. The unit
    // test for this found it; the comment above had already described
    // the failure and the code still had it.
    if (text === '') {
      throw new BadRequestException('bbox has an empty value');
    }
    const n = Number(text);
    if (!Number.isFinite(n)) {
      throw new BadRequestException(`bbox value "${text}" is not a number`);
    }
    return n;
  });

  if (minLat < -90 || maxLat > 90 || minLon < -180 || maxLon > 180) {
    throw new BadRequestException('bbox is outside the world');
  }
  if (minLon >= maxLon || minLat >= maxLat) {
    throw new BadRequestException('bbox min must be below max');
  }
  if (maxLon - minLon > MAX_SPAN_DEG || maxLat - minLat > 180) {
    throw new BadRequestException('bbox is larger than the world');
  }
  return { minLon, minLat, maxLon, maxLat };
}

/**
 * Cell size for the cluster grid, in degrees.
 *
 * 🔴 Derived from the viewport, not from a `zoom` parameter the client
 * sends. Zoom and viewport width already say the same thing, and taking
 * both would let them disagree — a caller could ask for a continent at
 * zoom 14 and get a grid finer than the points themselves.
 */
export function gridFor(bbox: Bbox): number {
  return Math.max(0.0005, (bbox.maxLon - bbox.minLon) / CELLS_ACROSS);
}
