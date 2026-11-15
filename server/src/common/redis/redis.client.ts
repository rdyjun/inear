import {
  HttpException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createClient, RedisClientOptions, RedisClientType } from 'redis';

const logger = new Logger('RedisClient');

export const REDIS_RECONNECT_BASE_DELAY_MS = 100;
export const REDIS_RECONNECT_MAX_DELAY_MS = 5_000;

/**
 * Exponential backoff with jitter. Returns a delay so the client keeps
 * reconnecting after Redis restarts instead of giving up.
 * A configuration error (bad port or URL) is returned as an Error so
 * bootstrap fails instead of retrying forever.
 * node-redis calls this with retries starting at 0.
 */
function isFatalRedisConfigError(cause: Error | undefined): boolean {
  if (!cause) {
    return false;
  }
  // Invalid host/port is not a transient outage. Retrying it forever
  // keeps the process up but never connects, and Nest bootstrap hangs.
  return (
    cause.name === 'RangeError' ||
    cause.message.includes('Port should be') ||
    cause.message.includes('Invalid URL')
  );
}

export function redisReconnectStrategy(
  retries: number,
  cause?: Error,
): number | Error {
  if (isFatalRedisConfigError(cause)) {
    logger.error(
      `Redis configuration error, not reconnecting: ${cause?.message}`,
    );
    return cause ?? new Error('Redis configuration error');
  }

  const exponential = Math.min(
    REDIS_RECONNECT_BASE_DELAY_MS * 2 ** Math.max(retries, 0),
    REDIS_RECONNECT_MAX_DELAY_MS,
  );
  const jitter = Math.floor(Math.random() * 200);
  const delay = exponential + jitter;
  logger.warn(
    `Redis reconnect scheduled (attempt ${retries + 1}) in ${delay}ms`,
  );
  return delay;
}

export interface ResilientRedisClientOptions {
  name: string;
  host?: string;
  port?: number;
  password?: string;
}

/**
 * node-redis emits connection loss as an 'error' event
 * (SocketClosedUnexpectedlyError when the server process or container
 * restarts). With no listener, Node treats that as an unhandled error
 * and crashes the process even though the client would otherwise reconnect.
 */
type RedisEventClient = {
  on(event: string, listener: (...args: any[]) => void): unknown;
};

export function attachRedisErrorHandlers<T extends RedisEventClient>(
  client: T,
  name: string,
): T {
  client.on('error', (error: Error) => {
    logger.error(
      `Redis client "${name}" error: ${error?.message ?? error}`,
      error?.stack,
    );
  });
  client.on('reconnecting', () => {
    logger.warn(`Redis client "${name}" reconnecting`);
  });
  client.on('ready', () => {
    logger.log(`Redis client "${name}" ready`);
  });
  return client;
}

export function createResilientRedisClient(
  config: ResilientRedisClientOptions,
): RedisClientType {
  const options: RedisClientOptions = {
    // Fail commands immediately while disconnected so HTTP handlers can
    // fall back or return 503 instead of hanging in the offline queue.
    disableOfflineQueue: true,
    socket: {
      host: config.host,
      port: config.port,
      reconnectStrategy: redisReconnectStrategy,
    },
  };
  if (config.password) {
    options.password = config.password;
  }

  const client = createClient(options) as RedisClientType;
  return attachRedisErrorHandlers(client, config.name);
}

const UNAVAILABLE_NAMES = new Set([
  'SocketClosedUnexpectedlyError',
  'ConnectionTimeoutError',
  'ClientClosedError',
  'ClientOfflineError',
  'ReconnectStrategyError',
  'SocketTimeoutError',
  'DisconnectsClientError',
]);

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'NR_CLOSED',
  'CONNECTION_BROKEN',
]);

export function isRedisUnavailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as { name?: string; code?: string; message?: string };
  if (err.name && UNAVAILABLE_NAMES.has(err.name)) {
    return true;
  }
  if (err.code && UNAVAILABLE_CODES.has(String(err.code))) {
    return true;
  }
  const message = err.message ?? '';
  return (
    message.includes('Socket closed unexpectedly') ||
    message.includes('The client is offline') ||
    message.includes('The client is closed') ||
    message.includes('Connection timeout') ||
    message.includes('getaddrinfo')
  );
}

type RedisReady = { isReady: boolean };

export async function withRedisFallback<T>(
  client: RedisReady,
  operation: () => Promise<T>,
  fallback: T,
  context: string,
): Promise<T> {
  if (!client.isReady) {
    logger.warn(`Redis is not ready; using fallback for ${context}`);
    return fallback;
  }
  try {
    return await operation();
  } catch (error) {
    if (!isRedisUnavailableError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Redis failed during ${context}; using fallback: ${message}`);
    return fallback;
  }
}

export async function withRedisOrUnavailable<T>(
  client: RedisReady,
  operation: () => Promise<T>,
  context: string,
): Promise<T> {
  if (!client.isReady) {
    logger.warn(`Redis is not ready; rejecting ${context}`);
    throw new ServiceUnavailableException('Redis is temporarily unavailable');
  }
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpException) {
      throw error;
    }
    if (isRedisUnavailableError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Redis failed during ${context}: ${message}`);
      throw new ServiceUnavailableException('Redis is temporarily unavailable');
    }
    throw error;
  }
}
