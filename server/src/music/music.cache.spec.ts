import { createCache } from 'cache-manager';
import { createKeyv } from 'cacheable';

describe('music segment cache', () => {
  it('round-trips buffers and caps the number of entries', async () => {
    const cache = createCache({
      ttl: 60_000,
      stores: [
        createKeyv({
          ttl: 60_000,
          lruSize: 2,
          useClone: false,
        }),
      ],
    });

    const segment = Buffer.from([0, 1, 2, 3, 4]);
    await cache.set('segment:1', segment, 60_000);
    const cached = await cache.get<Buffer>('segment:1');

    expect(Buffer.isBuffer(cached)).toBe(true);
    expect(cached).toEqual(segment);

    await cache.set('segment:2', Buffer.from('b'), 60_000);
    await cache.set('segment:3', Buffer.from('c'), 60_000);
    expect(await cache.get('segment:1')).toBeNull();
    expect(Buffer.isBuffer(await cache.get('segment:3'))).toBe(true);

    await cache.disconnect();
  });
});
