import {
  isDependencyUnavailable,
  reconnectDelayMs,
  shouldKeepProcessAlive,
} from '@/common/runtime/dependency';

describe('dependency failures', () => {
  it('recognises redis and mysql connection failures', () => {
    expect(
      isDependencyUnavailable(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), {
          code: 'ECONNREFUSED',
        }),
      ),
    ).toBe(true);
    expect(
      isDependencyUnavailable({
        name: 'SocketClosedUnexpectedlyError',
        message: 'Socket closed unexpectedly',
      }),
    ).toBe(true);
    expect(
      isDependencyUnavailable({
        name: 'ClientOfflineError',
        message: 'The client is offline',
      }),
    ).toBe(true);
    expect(
      isDependencyUnavailable({
        message: 'Connection is not established with mysql database',
      }),
    ).toBe(true);
    expect(
      isDependencyUnavailable(
        new TypeError(
          "Class constructor Album cannot be invoked without 'new'",
        ),
      ),
    ).toBe(true);
    expect(
      isDependencyUnavailable({
        driverError: { code: 'PROTOCOL_CONNECTION_LOST' },
        message: 'Query failed',
      }),
    ).toBe(true);
  });

  it('keeps the process up when the redis client throws internally', () => {
    const error = new TypeError(
      "Cannot destructure property 'resolve' of 'shift(...)' as it is undefined.",
    );
    error.stack = `TypeError: boom\n    at Object.onReply (/app/node_modules/@redis/client/dist/lib/client/commands-queue.js:62:25)`;
    expect(shouldKeepProcessAlive(error)).toBe(true);
    expect(shouldKeepProcessAlive(new Error('album not found'))).toBe(false);
  });

  it('does not treat application errors as dependency failures', () => {
    expect(isDependencyUnavailable(new Error('album not found'))).toBe(false);
    expect(isDependencyUnavailable(null)).toBe(false);
    expect(isDependencyUnavailable('down')).toBe(false);
  });

  it('backs off and stays capped', () => {
    for (let i = 0; i < 20; i += 1) {
      const delay = reconnectDelayMs(0);
      expect(delay).toBeGreaterThanOrEqual(100);
      expect(delay).toBeLessThan(200);
    }
    for (let i = 0; i < 20; i += 1) {
      const delay = reconnectDelayMs(12);
      expect(delay).toBeGreaterThanOrEqual(5000);
      expect(delay).toBeLessThan(5100);
    }
  });
});
