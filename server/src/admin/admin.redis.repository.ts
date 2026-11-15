import { REDIS_CLIENT } from '@/common/redis/redis.module';
import { withRedisOrUnavailable } from '@/common/redis/redis.client';
import { Inject, Injectable } from '@nestjs/common';
import { RedisClientType } from 'redis';

@Injectable()
export class AdminRedisRepository {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: RedisClientType,
  ) {}

  private getStreamingSessionKey(albumId: string): string {
    return `rooms:${albumId}:session`;
  }

  async createStreamingSession(
    albumId: string,
    releaseTimestamp: number,
    songDurations: number[],
  ): Promise<void> {
    await withRedisOrUnavailable(
      this.redisClient,
      async () => {
        const key = this.getStreamingSessionKey(albumId);
        const multi = this.redisClient.multi();

        multi
          .hSet(key, 'releaseTimestamp', releaseTimestamp.toString())
          .hSet(key, 'songs', JSON.stringify(songDurations));

        await multi.exec();
      },
      `create streaming session ${albumId}`,
    );
  }

  async deleteStreamingSession(albumId: string): Promise<void> {
    await withRedisOrUnavailable(
      this.redisClient,
      async () => {
        const key = this.getStreamingSessionKey(albumId);
        await this.redisClient.del(key);
      },
      `delete streaming session ${albumId}`,
    );
  }
}
