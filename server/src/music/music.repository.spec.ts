import { AlbumNotFoundException } from '@/common/exceptions/domain/album/album-not-found.exception';
import { MusicRepository } from './music.repository';

describe('MusicRepository', () => {
  const releaseDate = new Date('2026-01-01T00:00:00.000Z');

  function repository(
    redis: Record<string, unknown>,
    album: { releaseDate?: Date } | null = { releaseDate },
    songs: Array<{ duration: number }> = [{ duration: 10 }, { duration: 20 }],
  ) {
    const albumRepository = {
      findById: jest.fn().mockResolvedValue(album),
    };
    const songRepository = {
      getAlbumTracksSorted: jest.fn().mockResolvedValue(songs),
    };
    return {
      repo: new MusicRepository(
        redis as never,
        albumRepository as never,
        songRepository as never,
      ),
      albumRepository,
      songRepository,
    };
  }

  it('uses Redis when the session is available', async () => {
    const redis = {
      isReady: true,
      exists: jest.fn().mockResolvedValue(1),
      hGet: jest
        .fn()
        .mockResolvedValueOnce(String(releaseDate.getTime()))
        .mockResolvedValueOnce(JSON.stringify([10, 20])),
    };
    const { repo, albumRepository } = repository(redis);

    const song = await repo.findSongByJoinTimestamp(
      'album-1',
      releaseDate.getTime() + 1_000,
    );

    expect(song).toEqual({
      id: '1',
      startTime: releaseDate.getTime(),
      duration: 10,
    });
    expect(albumRepository.findById).not.toHaveBeenCalled();
  });

  it('rebuilds the session from the database when the Redis key is missing', async () => {
    const redis = {
      isReady: true,
      exists: jest.fn().mockResolvedValue(0),
      hGet: jest.fn(),
    };
    const { repo, albumRepository, songRepository } = repository(redis);

    const song = await repo.findSongByJoinTimestamp(
      'album-1',
      releaseDate.getTime() + 1_000,
    );

    expect(song).toEqual({
      id: '1',
      startTime: releaseDate.getTime(),
      duration: 10,
    });
    expect(albumRepository.findById).toHaveBeenCalledWith('album-1');
    expect(songRepository.getAlbumTracksSorted).toHaveBeenCalled();
    expect(redis.hGet).not.toHaveBeenCalled();
  });

  it('throws when Redis and the database both have no session', async () => {
    const redis = {
      isReady: true,
      exists: jest.fn().mockResolvedValue(0),
      hGet: jest.fn(),
    };
    const { repo } = repository(redis, null, []);

    await expect(
      repo.findSongByJoinTimestamp('album-1', releaseDate.getTime()),
    ).rejects.toBeInstanceOf(AlbumNotFoundException);
  });

  it('falls back to the database when Redis is down', async () => {
    const redis = {
      isReady: false,
      exists: jest.fn(),
      hGet: jest.fn(),
    };
    const { repo, songRepository } = repository(redis);

    const song = await repo.findSongByJoinTimestamp(
      'album-1',
      releaseDate.getTime() + 11_000,
    );

    expect(song).toEqual({
      id: '2',
      startTime: releaseDate.getTime() + 10_000,
      duration: 20,
    });
    expect(songRepository.getAlbumTracksSorted).toHaveBeenCalledWith(
      'album-1',
      'ASC',
    );
    expect(redis.exists).not.toHaveBeenCalled();
  });

  it('falls back to the database when the socket closes', async () => {
    const redis = {
      isReady: true,
      exists: jest.fn().mockRejectedValue(
        Object.assign(new Error('Socket closed unexpectedly'), {
          name: 'SocketClosedUnexpectedlyError',
        }),
      ),
      hGet: jest.fn(),
    };
    const { repo } = repository(redis);

    const song = await repo.findSongByJoinTimestamp(
      'album-1',
      releaseDate.getTime(),
    );

    expect(song.id).toBe('1');
  });
});
