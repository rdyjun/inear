import { ServiceUnavailableException } from '@nestjs/common';
import { createClient } from 'redis';
import {
  REDIS_RECONNECT_BASE_DELAY_MS,
  REDIS_RECONNECT_MAX_DELAY_MS,
  attachRedisErrorHandlers,
  createResilientRedisClient,
  isRedisUnavailableError,
  redisReconnectStrategy,
  withRedisFallback,
  withRedisOrUnavailable,
} from './redis.client';

describe('redis client resilience', () => {
  const clients: Array<{ disconnect: () => Promise<unknown> }> = [];

  afterEach(async () => {
    await Promise.all(
      clients.splice(0).map(async (client) => {
        try {
          await client.disconnect();
        } catch {
          // client was never connected
        }
      }),
    );
  });

  it('keeps reconnecting with capped exponential backoff', () => {
    const samples = [0, 1, 2, 3, 8, 20].map((retries) => {
      const delay = redisReconnectStrategy(retries);
      expect(typeof delay).toBe('number');
      return delay as number;
    });

    for (const delay of samples) {
      expect(delay).toBeGreaterThanOrEqual(REDIS_RECONNECT_BASE_DELAY_MS);
      expect(delay).toBeLessThanOrEqual(REDIS_RECONNECT_MAX_DELAY_MS + 200);
    }

    const first = samples[0];
    const later = samples[samples.length - 1];
    expect(later).toBeGreaterThan(first);
    expect(later).toBeGreaterThanOrEqual(REDIS_RECONNECT_MAX_DELAY_MS);
  });

  it('stops retrying a bad port and keeps retrying a dropped socket', () => {
    const configError = redisReconnectStrategy(
      0,
      new RangeError(
        'Port should be >= 0 and < 65536. Received type number (NaN).',
      ),
    );
    expect(configError).toBeInstanceOf(Error);

    const dropped = redisReconnectStrategy(
      1,
      Object.assign(new Error('Socket closed unexpectedly'), {
        name: 'SocketClosedUnexpectedlyError',
      }),
    );
    expect(typeof dropped).toBe('number');
  });

  it('logs SocketClosedUnexpectedlyError instead of crashing', () => {
    const client = createResilientRedisClient({
      name: 'test',
      host: '127.0.0.1',
      port: 6399,
    });
    clients.push(client);

    const error = Object.assign(new Error('Socket closed unexpectedly'), {
      name: 'SocketClosedUnexpectedlyError',
    });

    expect(() => client.emit('error', error)).not.toThrow();
    expect(client.listenerCount('error')).toBeGreaterThan(0);
  });

  it('attaches an error listener to duplicated clients', () => {
    const client = createClient({
      socket: { host: '127.0.0.1', port: 6399 },
    });
    clients.push(client);
    const duplicate = client.duplicate();
    clients.push(duplicate);

    attachRedisErrorHandlers(duplicate, 'duplicate');

    const error = Object.assign(new Error('Socket closed unexpectedly'), {
      name: 'SocketClosedUnexpectedlyError',
    });
    expect(() => duplicate.emit('error', error)).not.toThrow();
    expect(duplicate.listenerCount('error')).toBeGreaterThan(0);
  });

  it('enables reconnectStrategy and disables the offline queue', () => {
    const client = createResilientRedisClient({
      name: 'options',
      host: '127.0.0.1',
      port: 6399,
      password: 'secret',
    });
    clients.push(client);

    expect(client.options?.disableOfflineQueue).toBe(true);
    expect(client.options?.password).toBe('secret');
    expect(client.options?.socket?.reconnectStrategy).toBe(
      redisReconnectStrategy,
    );
  });

  it('recognizes connection-loss errors', () => {
    expect(
      isRedisUnavailableError(
        Object.assign(new Error('Socket closed unexpectedly'), {
          name: 'SocketClosedUnexpectedlyError',
        }),
      ),
    ).toBe(true);
    expect(
      isRedisUnavailableError(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      ),
    ).toBe(true);
    expect(isRedisUnavailableError(new Error('WRONGTYPE'))).toBe(false);
  });

  it('returns the fallback while Redis is down and preserves real data', async () => {
    const client = {
      isReady: false,
      hGet: jest.fn(),
    };

    await expect(
      withRedisFallback(client, () => client.hGet(), 0, 'user count'),
    ).resolves.toBe(0);
    expect(client.hGet).not.toHaveBeenCalled();

    client.isReady = true;
    client.hGet.mockResolvedValueOnce(4);
    await expect(
      withRedisFallback(client, () => client.hGet(), 0, 'user count'),
    ).resolves.toBe(4);

    client.hGet.mockRejectedValueOnce(
      Object.assign(new Error('Socket closed unexpectedly'), {
        name: 'SocketClosedUnexpectedlyError',
      }),
    );
    await expect(
      withRedisFallback(client, () => client.hGet(), 0, 'user count'),
    ).resolves.toBe(0);
  });

  it('returns 503 for operations that cannot run without Redis', async () => {
    const client = { isReady: false };

    await expect(
      withRedisOrUnavailable(client, async () => 'ok', 'join room'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
