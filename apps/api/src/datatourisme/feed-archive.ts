// CAMP-147: read the DATAtourisme feed archive without unpacking it.
//
// 🔴 THE TRAP THAT COST A DAY, recorded here because the server lies
// about it and nothing else will tell you.
//
// The feed is served with `content-type: application/zip`, and it is a
// ZIP — wrapped in GZIP. `unzip` on the downloaded bytes refuses with
// "End-of-central-directory signature not found", which reads like a
// truncated download and is not. The header cannot be trusted; the first
// two bytes can:
//
//     1f 8b   gzip — decompress it first, or fetch with curl --compressed
//     50 4b   "PK" — a real ZIP
//
// `assertNotGzipped` below is that check, and it runs before every read
// rather than at download time, because the file that reaches this
// function is not always the file somebody downloaded.

import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { JsonValueSplitter } from './json-stream';
import type { JsonLdNode } from './prices';

/** gzip's magic number. */
const GZIP_MAGIC = [0x1f, 0x8b];
/** The local-file-header signature every real ZIP starts with. */
const ZIP_MAGIC = [0x50, 0x4b];

export type ArchiveCheck =
  { kind: 'zip' } | { kind: 'gzip' } | { kind: 'unknown'; firstBytes: string };

/** What the first two bytes actually say the file is. */
export function identifyArchive(head: Uint8Array): ArchiveCheck {
  if (head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1]) {
    return { kind: 'gzip' };
  }
  if (head[0] === ZIP_MAGIC[0] && head[1] === ZIP_MAGIC[1]) {
    return { kind: 'zip' };
  }
  return {
    kind: 'unknown',
    firstBytes: Array.from(head.slice(0, 4))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' '),
  };
}

/**
 * Refuse a file that is not a plain ZIP, saying which one it is.
 *
 * 🔴 The gzip message names the fix. An error that says only "not a zip
 * archive" sends the next person to re-download an 810 MB file that was
 * never damaged.
 */
export async function assertPlainZip(path: string): Promise<void> {
  const fh = await open(path, 'r');
  try {
    const head = new Uint8Array(4);
    await fh.read(head, 0, 4, 0);
    const got = identifyArchive(head);
    if (got.kind === 'zip') return;
    if (got.kind === 'gzip') {
      throw new Error(
        `${path} is GZIP, not ZIP — the feed is served as a ZIP wrapped ` +
          `in GZIP while content-type claims application/zip. unzip will ` +
          `refuse it. Re-fetch with "curl --compressed", or run ` +
          `"gunzip -c ${path} > feed.zip" first.`,
      );
    }
    throw new Error(
      `${path} is neither ZIP nor GZIP (first bytes: ${got.firstBytes}). ` +
        `A 244-byte HTML redirect page looks exactly like this.`,
    );
  } finally {
    await fh.close();
  }
}

export type ArchiveOptions = {
  /** Entries to stream. The default is every object file. */
  pattern?: string;
  /** Stop after this many documents. For a smoke test, never for a report. */
  limit?: number;
};

/**
 * Every JSON document in the archive, one at a time.
 *
 * 🔴 An async generator and not an array. 129 594 parsed objects is more
 * than 20 GB resident; the caller sees one at a time and keeps only what
 * it needs. On this machine a full pass is ~2 minutes and the process
 * stays under 200 MB.
 *
 * 🔴 `spawn` with an argument array, never a shell string. The pattern
 * contains `*`, and through a shell the glob would be expanded by the
 * shell against the working directory — matching nothing, and `unzip`
 * would then helpfully stream the ENTIRE archive including index.json.
 * unzip does its own matching, so it never reaches a shell.
 */
export async function* readArchive(
  zipPath: string,
  options: ArchiveOptions = {},
): AsyncGenerator<JsonLdNode> {
  await assertPlainZip(zipPath);

  const pattern = options.pattern ?? 'objects/*';
  const child = spawn('unzip', ['-p', zipPath, pattern], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (b: Buffer) => {
    // Bounded: a broken archive can emit a warning per entry, and
    // 129 594 of them in a rejection message helps nobody.
    if (stderr.length < 4096) stderr += b.toString('utf8');
  });

  const exited = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      // 🔴 SIGPIPE is expected: an early `break` in the caller closes
      // the pipe under unzip, and that is not a failure.
      if (code === 0 || signal === 'SIGPIPE') return resolve();
      reject(
        new Error(
          `unzip exited ${code ?? signal} for ${zipPath}: ${stderr.trim()}`,
        ),
      );
    });
  });

  const splitter = new JsonValueSplitter();
  // 🔴 StringDecoder, not chunk.toString(). The feed is French and full
  // of multi-byte characters; a 64 KiB pipe boundary lands in the middle
  // of "Étoile" often enough that the naive version corrupts roughly one
  // object per hundred megabytes — and the corruption is a replacement
  // character inside a name, which parses fine and is simply wrong.
  const decoder = new StringDecoder('utf8');
  let seen = 0;
  let stopped = false;

  try {
    for await (const chunk of child.stdout) {
      for (const doc of splitter.push(decoder.write(chunk as Buffer))) {
        yield JSON.parse(doc) as JsonLdNode;
        seen++;
        if (options.limit !== undefined && seen >= options.limit) {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
    if (!stopped) {
      splitter.push(decoder.end());
      splitter.end();
      await exited;
    }
  } finally {
    if (stopped && child.exitCode === null) child.kill('SIGTERM');
  }
}
