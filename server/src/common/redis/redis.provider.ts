import 'dotenv/config';
import { RedisClientType } from 'redis';
import { createResilientRedisClient } from './redis.client';

export const createRedisProvider = async (): Promise<RedisClientType> => {
  const client = createResilientRedisClient({
    name: 'app',
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT),
    password: process.env.REDIS_PASSWORD || undefined,
  });

  await client.connect();
  return client;
};
