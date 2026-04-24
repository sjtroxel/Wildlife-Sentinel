import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSubscriber } = vi.hoisted(() => {
  const mockSubscriber = {
    // Simulate BLOCK timeout: resolves after 20ms so the event loop can process
    // close events between iterations instead of spinning at 100% CPU.
    xread: vi.fn().mockImplementation(
      () => new Promise<null>(resolve => setTimeout(() => resolve(null), 20))
    ),
    quit: vi.fn().mockResolvedValue(undefined),
  };
  return { mockSubscriber };
});

vi.mock('../../src/db/client.js', () => ({
  sql: Object.assign(vi.fn().mockResolvedValue([{ '?column?': 1 }]), { end: vi.fn() }),
}));

vi.mock('../../src/discord/bot.js', () => ({
  getBotStatus: vi.fn().mockReturnValue('connected'),
  startBot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/redis/client.js', () => ({
  redis: {
    duplicate:  vi.fn().mockReturnValue(mockSubscriber),
    xrevrange:  vi.fn().mockResolvedValue([]),  // no history by default
    ping:       vi.fn().mockResolvedValue('PONG'),
    quit:       vi.fn(),
    on:         vi.fn(),
  },
}));

import { app } from '../../src/app.js';
import { redis } from '../../src/redis/client.js';
import http from 'http';

describe('GET /agent-activity (SSE)', () => {
  let server: http.Server;
  let port: number;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
  });

  afterEach(async () => {
    // closeAllConnections destroys live SSE connections, triggering req.on('close')
    // which sets closed=true in the XREAD loop so it exits cleanly.
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Allow any pending setTimeouts in the xread mock to drain
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  });

  it('sets SSE headers', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/agent-activity`, (res) => {
        try {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toContain('text/event-stream');
          expect(res.headers['cache-control']).toBe('no-cache');
          expect(res.headers['connection']).toBe('keep-alive');
          res.destroy();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') resolve();
        else reject(e);
      });
    });
  });

  it('fetches history via xrevrange on connect', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/agent-activity`, (res) => {
        res.destroy();
        resolve();
      });
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') resolve();
        else reject(e);
      });
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(redis.xrevrange)).toHaveBeenCalledWith('agent:activity', '+', '-', 'COUNT', 50);
  });

  it('sends history entries as SSE events before live stream', async () => {
    const historyEntry = JSON.stringify({
      agent: 'threat',
      action: 'high-risk fire near habitat',
      detail: 'confidence: 0.90',
      timestamp: '2026-04-24T10:00:00.000Z',
    });
    vi.mocked(redis.xrevrange).mockResolvedValueOnce([['1714000000000-0', ['data', historyEntry]]]);

    const received: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/agent-activity`, (res) => {
        res.on('data', (chunk: Buffer) => {
          received.push(chunk.toString());
          res.destroy();
        });
        res.on('close', resolve);
      });
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') resolve();
        else reject(e);
      });
    });

    const fullBody = received.join('');
    expect(fullBody).toContain(historyEntry);
  });

  it('calls quit on connection close', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = http.get(`http://localhost:${port}/agent-activity`, (res) => {
        res.destroy();
        resolve();
      });
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') resolve();
        else reject(e);
      });
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(mockSubscriber.quit).toHaveBeenCalled();
  });
});
