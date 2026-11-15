const created: Array<{ listenerCount: (event: string) => number }> = [];

function createMockClient() {
  const clientListeners = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  const client = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    on(event: string, handler: (...args: unknown[]) => void) {
      const list = clientListeners.get(event) ?? [];
      list.push(handler);
      clientListeners.set(event, list);
      return client;
    },
    listenerCount(event: string) {
      return (clientListeners.get(event) ?? []).length;
    },
    duplicate() {
      return createMockClient();
    },
  };
  created.push(client);
  return client;
}

jest.mock('redis', () => ({
  createClient: jest.fn(() => createMockClient()),
}));

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn(() => jest.fn()),
}));

import { createClient } from 'redis';
import { RedisIoAdapter } from './redis-io.adapter';

describe('RedisIoAdapter error handlers', () => {
  beforeEach(() => {
    created.length = 0;
  });

  it('attaches error listeners to the pub and sub clients before connecting', async () => {
    const adapter = new RedisIoAdapter({} as never);
    await adapter.connectToRedis();

    expect(createClient).toHaveBeenCalledWith(
      expect.objectContaining({
        disableOfflineQueue: true,
        socket: expect.objectContaining({
          host: 'redis',
          port: 6379,
          reconnectStrategy: expect.any(Function),
        }),
      }),
    );

    expect(created).toHaveLength(2);
    for (const client of created) {
      expect(client.listenerCount('error')).toBeGreaterThan(0);
    }
  });
});
