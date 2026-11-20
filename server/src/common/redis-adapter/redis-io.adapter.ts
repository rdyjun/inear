import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';
import {
  buildRedisClient,
  watchRedisClient,
} from '@/common/redis/redis.provider';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private pubClient: ReturnType<typeof createClient>;
  private subClient: ReturnType<typeof createClient>;

  async connectToRedis(): Promise<void> {
    const host = process.env.REDIS_HOST || 'redis';
    const port = Number(process.env.REDIS_PORT) || 6379;
    this.pubClient = buildRedisClient({
      host,
      port,
      disableOfflineQueue: false,
    });
    this.subClient = this.pubClient.duplicate();
    watchRedisClient(this.subClient);
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);

    const connecting = Promise.all([
      this.pubClient.connect(),
      this.subClient.connect(),
    ]).catch(() => undefined);
    await Promise.race([
      connecting,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  }

  // main.ts에서 redis 어댑터 생성시 호출됨
  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }

  async disconnectFromRedis(): Promise<void> {
    await Promise.all(
      [this.pubClient, this.subClient].map(async (client) => {
        if (!client) {
          return;
        }
        try {
          await client.disconnect();
        } catch {
          // 이미 끊긴 연결에서 disconnect가 거부해도 프로세스를 유지한다.
        }
      }),
    );
  }
}
