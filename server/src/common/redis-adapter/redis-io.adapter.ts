import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';
import {
  attachRedisErrorHandlers,
  createResilientRedisClient,
} from '@/common/redis/redis.client';
import { RedisClientType } from 'redis';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private pubClient: ReturnType<typeof createClient>;
  private subClient: ReturnType<typeof createClient>;

  async connectToRedis(): Promise<void> {
    const host = process.env.REDIS_HOST || 'redis';
    const port = Number(process.env.REDIS_PORT || 6379);
    this.pubClient = createResilientRedisClient({
      name: 'socket.io-pub',
      host,
      port,
      password: process.env.REDIS_PASSWORD || undefined,
    });
    // duplicate() copies socket options, including reconnectStrategy, but
    // not event listeners. The subscriber needs its own error handler or a
    // Redis restart crashes the process.
    this.subClient = this.pubClient.duplicate();
    attachRedisErrorHandlers(
      this.subClient as RedisClientType,
      'socket.io-sub',
    );

    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);

    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  // main.ts에서 redis 어댑터 생성시 호출됨
  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }

  async disconnectFromRedis(): Promise<void> {
    await Promise.all([
      this.pubClient?.disconnect(),
      this.subClient?.disconnect(),
    ]);
  }
}
