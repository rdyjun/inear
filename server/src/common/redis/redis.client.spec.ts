import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { createClient } from 'redis';
import {
  REDIS_OUTAGE_LOG_INTERVAL_MS,
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

  it('logs the first outage and then at most once per interval', () => {
    let now = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    try {
      const client = createResilientRedisClient({
        name: 'throttle',
        host: '127.0.0.1',
        port: 6399,
      });
      clients.push(client);
      const socketError = Object.assign(
        new Error('Socket closed unexpectedly'),
        { name: 'SocketClosedUnexpectedlyError' },
      );

      client.emit('error', socketError);
      client.emit('reconnecting');
      client.emit('error', socketError);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();

      now += REDIS_OUTAGE_LOG_INTERVAL_MS;
      client.emit('reconnecting');
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      client.emit('ready');
      expect(logSpy).toHaveBeenCalledWith('Redis client "throttle" recovered');

      client.emit('error', socketError);
      expect(errorSpy).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
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

  it('disables the offline queue only when the caller opts in', () => {
    const adapterClient = createResilientRedisClient({
      name: 'socket.io-pub',
      host: '127.0.0.1',
      port: 6399,
    });
    const appClient = createResilientRedisClient({
      name: 'app',
      host: '127.0.0.1',
      port: 6399,
      password: 'secret',
      disableOfflineQueue: true,
    });
    const duplicated = adapterClient.duplicate();
    clients.push(adapterClient, appClient, duplicated);

    expect(adapterClient.options?.disableOfflineQueue).not.toBe(true);
    expect(appClient.options?.disableOfflineQueue).toBe(true);
    expect(appClient.options?.password).toBe('secret');
    expect(appClient.options?.socket?.reconnectStrategy).toBe(
      redisReconnectStrategy,
    );
    expect(duplicated.options?.disableOfflineQueue).not.toBe(true);
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
