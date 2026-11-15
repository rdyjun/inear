import 'dotenv/config';
import { RedisClientType } from 'redis';
import { createResilientRedisClient } from './redis.client';

export const createRedisProvider = async (): Promise<RedisClientType> => {
  const client = createResilientRedisClient({
    name: 'app',
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
    // HTTP handlers catch ClientOfflineError and fall back or return 503.
    // Socket.IO pub/sub must not copy this flag. The adapter's broadcast()
    // ignores the publish() promise, so an offline publish exits the process.
    disableOfflineQueue: true,
  });

  await client.connect();
  return client;
};
