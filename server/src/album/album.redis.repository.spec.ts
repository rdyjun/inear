import { AlbumRedisRepository } from '@/album/album.redis.repository';

describe('AlbumRedisRepository', () => {
  it('reports zero listeners when redis is offline', async () => {
    const offline = {
      name: 'ClientOfflineError',
      message: 'The client is offline',
    };
    const client = {
      hGet: jest.fn().mockRejectedValue(offline),
      multi: jest.fn(() => {
        throw offline;
      }),
    };
    const repository = new AlbumRedisRepository(client as never);

    await expect(repository.getCurrentUsers('album-1')).resolves.toBe(0);
    await expect(
      repository.getCurrentUsersAll(['album-1', 'album-2']),
    ).resolves.toEqual([0, 0]);
  });
});
