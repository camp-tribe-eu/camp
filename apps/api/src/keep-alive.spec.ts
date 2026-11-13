import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { keepAliveTimeoutMs } from './keep-alive';

describe('keepAliveTimeoutMs', () => {
  it('leaves Node’s default alone when nothing is set', () => {
    expect(keepAliveTimeoutMs(undefined)).toBeUndefined();
    expect(keepAliveTimeoutMs('')).toBeUndefined();
    expect(keepAliveTimeoutMs('   ')).toBeUndefined();
  });

  it('reads a positive whole number of milliseconds', () => {
    expect(keepAliveTimeoutMs('120000')).toBe(120000);
    expect(keepAliveTimeoutMs(' 65000 ')).toBe(65000);
  });

  // 🔴 `0` is "never time out" to Node. A typo must not become that.
  it.each(['0', '-1', '1.5', '120s', 'abc', '1e5', '0x10'])(
    'refuses %p rather than guessing',
    (raw) => {
      expect(() => keepAliveTimeoutMs(raw)).toThrow(
        /HTTP_KEEP_ALIVE_TIMEOUT_MS/,
      );
    },
  );
});

/**
 * 🔴 THE SETTING DOES WHAT THE COMMENT SAYS, ON A REAL SOCKET.
 *
 * The function above only parses. What the e2e suite depends on is that
 * a server given the value still holds an idle connection AFTER Node's
 * default would have dropped it — so that is what is measured here: one
 * agent, one socket, a second request after the default has expired.
 */
describe('a server with the timeout applied', () => {
  let server: Server;
  const sockets = new Set<unknown>();

  const listen = (keepAlive: number | undefined) =>
    new Promise<number>((resolve) => {
      server = createServer((_req, res) => res.end('ok'));
      if (keepAlive !== undefined) server.keepAliveTimeout = keepAlive;
      server.on('connection', (s) => sockets.add(s));
      server.listen(0, '127.0.0.1', () =>
        resolve((server.address() as AddressInfo).port),
      );
    });

  afterEach(async () => {
    sockets.clear();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  const get = (port: number, agent: import('node:http').Agent) =>
    new Promise<void>((resolve, reject) => {
      request({ port, host: '127.0.0.1', agent }, (res) => {
        res.resume();
        res.on('end', resolve);
      })
        .on('error', reject)
        .end();
    });

  const twoRequestsApart = async (
    keepAlive: number | undefined,
    ms: number,
  ) => {
    const { Agent } = await import('node:http');
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const port = await listen(keepAlive);
    await get(port, agent);
    await new Promise((r) => setTimeout(r, ms));
    await get(port, agent);
    agent.destroy();
    return sockets.size;
  };

  it('a short timeout drops the idle connection: the control', async () => {
    // Without this, "one socket" below would be a fact about the agent,
    // not about the setting.
    expect(await twoRequestsApart(300, 1500)).toBe(2);
  });

  // 🔴 6.5 s ON PURPOSE: past Node's default (5 s advertised, closed about
  // a second later) and right where the e2e suite was losing requests.
  // If the configured value stops reaching the server — or the parser
  // starts answering `undefined` — the default drops the socket and this
  // counts two.
  it('holds an idle connection past Node’s default when configured', async () => {
    expect(await twoRequestsApart(keepAliveTimeoutMs('120000'), 6500)).toBe(1);
  }, 15_000);
});
