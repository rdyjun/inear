import 'dotenv/config';
import { createClient, RedisClientType } from 'redis';
import {
  createThrottledLogger,
  reconnectDelayMs,
} from '@/common/runtime/dependency';

const logRedisError = createThrottledLogger('Redis');

export interface RedisClientOptions {
  host?: string;
  port?: number;
  password?: string;
  disableOfflineQueue?: boolean;
}

export function buildRedisClient(
  options: RedisClientOptions = {},
): RedisClientType {
  const host = options.host ?? process.env.REDIS_HOST ?? 'redis';
  const port = options.port ?? (Number(process.env.REDIS_PORT) || 6379);
  const password =
    options.password ??
    (process.env.REDIS_PASSWORD ? process.env.REDIS_PASSWORD : undefined);

  const client = createClient({
    password,
    disableClientInfo: true,
    disableOfflineQueue: options.disableOfflineQueue ?? true,
    socket: {
      host,
      port,
      reconnectStrategy(retries: number) {
        return reconnectDelayMs(retries);
      },
    },
  }) as RedisClientType;

  watchRedisClient(client);
  return client;
}

export function watchRedisClient(client: {
  on(event: 'error', listener: (error: unknown) => void): unknown;
}): void {
  client.on('error', (error) => logRedisError(error));
}

export function connectRedisInBackground(client: RedisClientType): void {
  client.connect().catch((error) => logRedisError(error));
}

export const createRedisProvider = async (): Promise<RedisClientType> => {
  const client = buildRedisClient({ disableOfflineQueue: true });
  connectRedisInBackground(client);
  return client;
};
