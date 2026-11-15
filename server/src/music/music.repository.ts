import { AlbumNotFoundException } from '@/common/exceptions/domain/album/album-not-found.exception';
import { REDIS_CLIENT } from '@/common/redis/redis.module';
import { isRedisUnavailableError } from '@/common/redis/redis.client';
import { ORDER } from '@/common/constants/repository.constant';
import { AlbumRepository } from '@/album/album.repository';
import { SongRepository } from '@/song/song.repository';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { RedisClientType } from 'redis';

interface RoomSession {
  releaseTimestamp: number;
  songs: number[];
}

interface SongMetadata {
  id: string;
  startTime: number;
  duration: number;
}

@Injectable()
export class MusicRepository {
  private readonly logger = new Logger(MusicRepository.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: RedisClientType,
    private readonly albumRepository: AlbumRepository,
    private readonly songRepository: SongRepository,
  ) {}

  private albumKey(albumId: string): string {
    return `rooms:${albumId}:session`;
  }

  private async getRoomSession(albumId: string): Promise<RoomSession> {
    if (this.redisClient.isReady) {
      try {
        const session = await this.readRedisSession(albumId);
        if (session) {
          return session;
        }
      } catch (error) {
        if (!isRedisUnavailableError(error)) {
          throw error;
        }
        this.logger.warn(
          `Redis session read failed for ${albumId}; falling back to the database`,
        );
      }
    } else {
      this.logger.warn(
        `Redis is not ready for ${albumId}; falling back to the database`,
      );
    }

    return this.readDatabaseSession(albumId);
  }

  /**
   * A missing key is not a missing album. Redis can drop the session while
   * the album rows are still in MySQL, so rebuild from the database.
   */
  private async readRedisSession(
    albumId: string,
  ): Promise<RoomSession | null> {
    const albumKey = this.albumKey(albumId);
    const exists = await this.redisClient.exists(albumKey);

    if (!exists) {
      this.logger.warn(
        `Redis session key missing for ${albumId}; falling back to the database`,
      );
      return null;
    }

    const [releaseTimestampStr, songStr] = await Promise.all([
      this.redisClient.hGet(albumKey, 'releaseTimestamp'),
      this.redisClient.hGet(albumKey, 'songs'),
    ]);
    if (!releaseTimestampStr || !songStr) {
      throw new AlbumNotFoundException(albumId);
    }

    return {
      releaseTimestamp: parseInt(releaseTimestampStr, 10),
      songs: JSON.parse(songStr),
    };
  }

  /**
   * The streaming session written to Redis is the album release time plus
   * each track's duration. Those rows live in MySQL, so playback can
   * continue from the database while Redis is down or the key is gone.
   */
  private async readDatabaseSession(albumId: string): Promise<RoomSession> {
    const album = await this.albumRepository.findById(albumId);
    if (!album?.releaseDate) {
      throw new AlbumNotFoundException(albumId);
    }

    const songs = await this.songRepository.getAlbumTracksSorted(
      albumId,
      ORDER.ASC,
    );
    if (!songs.length) {
      throw new AlbumNotFoundException(albumId);
    }

    return {
      releaseTimestamp: new Date(album.releaseDate).getTime(),
      songs: songs.map((song) => song.duration),
    };
  }

  async findSongByJoinTimestamp(
    albumId: string,
    joinTimestamp: number,
  ): Promise<SongMetadata> {
    const session = await this.getRoomSession(albumId);

    let currentTime = session.releaseTimestamp;
    // TODO : 고차함수로 반복
    for (let i = 0; i < session.songs.length; i++) {
      const songEndTime = currentTime + session.songs[i] * 1000;

      if (joinTimestamp >= currentTime && joinTimestamp < songEndTime) {
        return {
          id: `${i + 1}`,
          startTime: currentTime,
          duration: session.songs[i],
        };
      }
      currentTime = songEndTime;
    }
    return undefined;
    // throw new AlbumNotFoundByTimestampException(albumId, joinTimestamp);
  }
}
