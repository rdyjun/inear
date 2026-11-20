import { buildRedisClient } from '@/common/redis/redis.provider';

describe('redis client', () => {
  it('stays up when nothing is listening', async () => {
    const errors: unknown[] = [];
    const client = buildRedisClient({
      host: '127.0.0.1',
      port: 1,
      disableOfflineQueue: true,
    });
    client.on('error', (error) => errors.push(error));

    const connecting = client.connect();
    connecting.catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(client.isReady).toBe(false);
    await expect(client.ping()).rejects.toBeTruthy();
    expect(errors.length).toBeGreaterThan(0);
    await client.disconnect().catch(() => undefined);
  });
});
