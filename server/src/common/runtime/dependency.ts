const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ER_CON_COUNT_ERROR',
]);

const CONNECTION_NAMES = new Set([
  'ClientClosedError',
  'ClientOfflineError',
  'SocketClosedUnexpectedlyError',
  'ConnectionTimeoutError',
  'DisconnectsClientError',
  'ReconnectStrategyError',
  'CannotConnectError',
  'CannotExecuteNotConnectedError',
  'ConnectionNotFoundError',
]);

const CONNECTION_MESSAGE =
  /client is offline|socket closed unexpectedly|connection is not established|data source is not initialized|connect ECONNREFUSED|Can't connect to MySQL|Connection lost|server closed the connection|No metadata for|cannot be invoked without 'new'/i;

export function reconnectDelayMs(attempt: number): number {
  const step = Math.max(0, attempt);
  const exponential = Math.min(100 * 2 ** Math.min(step, 6), 5000);
  return exponential + Math.floor(Math.random() * 100);
}

export function isDependencyUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const err = error as {
    name?: string;
    code?: string;
    message?: string;
    driverError?: { code?: string; message?: string };
    constructor?: { name?: string };
  };
  const name = err.name || err.constructor?.name || '';
  const code = String(err.code || err.driverError?.code || '');
  const message = `${err.message || ''} ${err.driverError?.message || ''}`;
  return (
    CONNECTION_CODES.has(code) ||
    CONNECTION_NAMES.has(name) ||
    CONNECTION_MESSAGE.test(message)
  );
}

export function createThrottledLogger(scope: string, intervalMs = 45000) {
  let lastLoggedAt = 0;
  return (error: unknown) => {
    const now = Date.now();
    if (now - lastLoggedAt < intervalMs) {
      return;
    }
    lastLoggedAt = now;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${scope}] ${message}`);
  };
}

export function shouldKeepProcessAlive(error: unknown): boolean {
  if (isDependencyUnavailable(error)) {
    return true;
  }
  const stack = error instanceof Error ? error.stack || '' : '';
  return (
    stack.includes('@redis/client') ||
    stack.includes('@socket.io/redis-adapter')
  );
}

export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
  process.on('uncaughtException', (error) => {
    if (shouldKeepProcessAlive(error)) {
      console.error('[dependency]', error);
      return;
    }
    console.error('[uncaughtException]', error);
    process.exit(1);
  });
}
