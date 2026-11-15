import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CLIENT } from '@/common/redis/redis.module';
import { withRedisFallback } from '@/common/redis/redis.client';
import { RedisClientType } from 'redis';

@Injectable()
export class AlbumRedisRepository {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: RedisClientType,
  ) {}

  private roomKey(roomId: string): string {
    return `rooms:${roomId}`;
  }

  async getCurrentUsers(roomId: string): Promise<number> {
    const counts = await this.getCurrentUsersAll([roomId]);
    return counts[0] ?? 0;
  }

  async getCurrentUsersAll(roomIds: string[]): Promise<number[]> {
    if (roomIds.length === 0) {
      return [];
    }

    // Listener counts are display data. A Redis outage should not 500 the
    // main banner; show zero listeners until Redis is back.
    return withRedisFallback(
      this.redisClient,
      async () => {
        if (roomIds.length === 1) {
          const currentUsers = await this.redisClient.hGet(
            this.roomKey(roomIds[0]),
            'currentUsers',
          );
          return [parseInt(currentUsers || '0', 10)];
        }

        const pipeline = this.redisClient.multi();
        roomIds.forEach((roomId) => {
          pipeline.hGet(this.roomKey(roomId), 'currentUsers');
        });
        const results = await pipeline.exec();
        return results.map((result) =>
          result ? parseInt(String(result), 10) : 0,
        );
      },
      roomIds.map(() => 0),
      'album listener counts',
    );
  }
}
