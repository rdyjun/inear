import { S3CacheService } from './s3Cache.service';

describe('S3CacheService', () => {
  function createService(
    cache: {
      get: jest.Mock;
      set: jest.Mock;
    },
    body: Buffer,
  ) {
    async function* stream() {
      yield body;
    }
    const s3 = {
      send: jest.fn().mockResolvedValue({ Body: stream() }),
    };
    const configService = {
      get: jest.fn().mockReturnValue('bucket'),
    };
    const s3Bucket = {
      getInstance: () => s3,
    };
    return {
      s3,
      cache,
      service: new S3CacheService(
        configService as never,
        cache as never,
        s3Bucket as never,
      ),
    };
  }

  it('returns a cache hit without calling S3', async () => {
    const cached = Buffer.from('cached');
    const { s3, service } = createService(
      {
        get: jest.fn().mockResolvedValue(cached),
        set: jest.fn(),
      },
      Buffer.from('s3'),
    );

    await expect(
      service.fetchFromS3({
        cacheKey: 'segment:1',
        s3Key: 'converted/1.ts',
        cacheTTL: 1000,
        transform: (buffer) => buffer,
      }),
    ).resolves.toBe(cached);
    expect(s3.send).not.toHaveBeenCalled();
  });

  it('loads from S3 when the cache read fails', async () => {
    const body = Buffer.from('from-s3');
    const { s3, service } = createService(
      {
        get: jest.fn().mockRejectedValue(new Error('cache down')),
        set: jest.fn().mockResolvedValue(undefined),
      },
      body,
    );

    await expect(
      service.fetchFromS3({
        cacheKey: 'segment:1',
        s3Key: 'converted/1.ts',
        cacheTTL: 1000,
        transform: (buffer) => buffer,
      }),
    ).resolves.toEqual(body);
    expect(s3.send).toHaveBeenCalled();
  });

  it('still returns the S3 object when the cache write fails', async () => {
    const body = Buffer.from('from-s3');
    const { service } = createService(
      {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockRejectedValue(new Error('cache down')),
      },
      body,
    );

    await expect(
      service.fetchFromS3({
        cacheKey: 'm3u8:1',
        s3Key: 'converted/1.m3u8',
        cacheTTL: 1000,
        transform: (buffer) => buffer.toString(),
      }),
    ).resolves.toBe('from-s3');
  });
});
