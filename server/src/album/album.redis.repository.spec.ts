import { AlbumRedisRepository } from './album.redis.repository';

describe('AlbumRedisRepository', () => {
  function repository(client: Record<string, unknown>) {
    return new AlbumRedisRepository(client as never);
  }

  it('returns zeros when Redis is down', async () => {
    const client = {
      isReady: false,
      hGet: jest.fn(),
      multi: jest.fn(),
    };
    const repo = repository(client);

    await expect(repo.getCurrentUsers('album-1')).resolves.toBe(0);
    await expect(repo.getCurrentUsersAll(['a', 'b'])).resolves.toEqual([0, 0]);
    expect(client.hGet).not.toHaveBeenCalled();
    expect(client.multi).not.toHaveBeenCalled();
  });

  it('returns zeros when the socket closes mid-read', async () => {
    const client = {
      isReady: true,
      hGet: jest.fn().mockRejectedValue(
        Object.assign(new Error('Socket closed unexpectedly'), {
          name: 'SocketClosedUnexpectedlyError',
        }),
      ),
    };
    const repo = repository(client);

    await expect(repo.getCurrentUsersAll(['album-1'])).resolves.toEqual([0]);
  });

  it('returns the stored listener count when Redis is up', async () => {
    const client = {
      isReady: true,
      hGet: jest.fn().mockResolvedValue('12'),
    };
    const repo = repository(client);

    await expect(repo.getCurrentUsers('album-1')).resolves.toBe(12);
  });
});
