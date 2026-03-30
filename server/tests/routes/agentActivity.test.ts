import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSubscriber } = vi.hoisted(() => {
  let capturedMessageHandler: ((channel: string, message: string) => void) | null = null;

  const mockSubscriber = {
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockImplementation((event: string, handler: unknown) => {
      if (event === 'message') {
        capturedMessageHandler = handler as (channel: string, message: string) => void;
      }
    }),
    getMessageHandler: () => capturedMessageHandler,
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
    duplicate: vi.fn().mockReturnValue(mockSubscriber),
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn(),
    on: vi.fn(),
  },
}));

import { app } from '../../src/app.js';
import http from 'http';

describe('GET /agent-activity (SSE)', () => {
  let server: http.Server;
  let port: number;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset captured handler between tests
    mockSubscriber.on.mockImplementation((event: string, handler: unknown) => {
      if (event === 'message') {
        (mockSubscriber as typeof mockSubscriber & { _handler: unknown })._handler = handler;
      }
    });
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sets SSE headers and subscribes to Redis channel', async () => {
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

    await new Promise((r) => setTimeout(r, 50));
    expect(mockSubscriber.subscribe).toHaveBeenCalledWith('agent:activity');
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
