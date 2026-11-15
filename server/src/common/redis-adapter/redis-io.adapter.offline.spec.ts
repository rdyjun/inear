import net from 'node:net';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisIoAdapter } from './redis-io.adapter';

/**
 * @socket.io/redis-adapter 8.3.0 broadcast() calls publish() and drops the
 * promise. If the pub client has disableOfflineQueue, that call rejects with
 * ClientOfflineError while the client is open but not ready, and Node exits.
 * These clients are the ones RedisIoAdapter.connectToRedis() creates.
 *
 * The stand-in accepts the handshake (+OK) and then drops the sockets, which
 * is the same window as `docker restart redis`: isOpen stays true, isReady
 * is false, and publish is either queued or rejected.
 */
describe('RedisIoAdapter emit while Redis is disconnected', () => {
  async function waitUntil(predicate: () => boolean, timeoutMs: number) {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('timed out waiting for the redis client state');
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  it('does not reject publish while the adapter socket is open but not ready', async () => {
    const accepted: net.Socket[] = [];
    let respond = true;
    const tcp = net.createServer((socket) => {
      accepted.push(socket);
      socket.on('error', () => undefined);
      let buffer = '';
      socket.on('data', (chunk) => {
        if (!respond) {
          return;
        }
        buffer += chunk.toString();
        const lines = buffer.split('\r\n');
        buffer = lines.pop() ?? '';
        const commands = lines.filter((line) => line.startsWith('*')).length;
        if (commands > 0) {
          socket.write('+OK\r\n'.repeat(commands));
        }
      });
    });
    await new Promise<void>((resolve) => tcp.listen(0, '127.0.0.1', resolve));
    const address = tcp.address() as net.AddressInfo;

    const previousHost = process.env.REDIS_HOST;
    const previousPort = process.env.REDIS_PORT;
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = String(address.port);

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);

    const tracked: Array<Promise<unknown>> = [];
    let commandRejected = false;
    let publishCalls = 0;
    let io: Server | undefined;
    let adapter: RedisIoAdapter | undefined;
    const startupErrors: Array<Promise<unknown>> = [];

    try {
      adapter = new RedisIoAdapter({} as never);
      startupErrors.push(adapter.connectToRedis().catch((error) => error));

      const clients = () =>
        adapter as unknown as {
          pubClient?: {
            isOpen: boolean;
            isReady: boolean;
            options?: { disableOfflineQueue?: boolean };
            publish: (...args: any[]) => any;
            subscribe: (...args: any[]) => any;
            pSubscribe: (...args: any[]) => any;
            disconnect: () => Promise<unknown>;
          };
          subClient?: {
            isOpen: boolean;
            isReady: boolean;
            options?: { disableOfflineQueue?: boolean };
            publish: (...args: any[]) => any;
            subscribe: (...args: any[]) => any;
            pSubscribe: (...args: any[]) => any;
            disconnect: () => Promise<unknown>;
          };
        };

      await waitUntil(() => {
        const { pubClient, subClient } = clients();
        return Boolean(pubClient?.isReady && subClient?.isReady);
      }, 2000);

      respond = false;
      accepted.splice(0).forEach((socket) => socket.destroy());

      await waitUntil(() => {
        const { pubClient, subClient } = clients();
        return Boolean(
          pubClient?.isOpen &&
            !pubClient.isReady &&
            subClient?.isOpen &&
            !subClient.isReady,
        );
      }, 2000);

      const { pubClient, subClient } = clients();
      expect(pubClient.options?.disableOfflineQueue).not.toBe(true);
      expect(subClient.options?.disableOfflineQueue).not.toBe(true);

      for (const client of [pubClient, subClient]) {
        for (const method of ['publish', 'subscribe', 'pSubscribe'] as const) {
          const original = client[method].bind(client);
          client[method] = (...args: any[]) => {
            if (method === 'publish') {
              publishCalls += 1;
            }
            const pending = original(...args);
            if (pending && typeof pending.then === 'function') {
              tracked.push(
                pending.then(
                  () => undefined,
                  () => {
                    commandRejected = true;
                  },
                ),
              );
            }
            return pending;
          };
        }
      }

      io = new Server({ serveClient: false });
      io.adapter(
        createAdapter(pubClient as never, subClient as never) as never,
      );
      expect(() => {
        io.emit('broadcast', { message: 'while redis is down' });
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(publishCalls).toBeGreaterThan(0);
      expect(commandRejected).toBe(false);
      expect(rejections).toEqual([]);
    } finally {
      if (io && (io as unknown as { engine?: { close: () => void } }).engine) {
        await io.close();
      }
      await adapter?.disconnectFromRedis().catch(() => undefined);
      await Promise.all(startupErrors);
      await Promise.all(tracked);
      accepted.forEach((socket) => socket.destroy());
      await new Promise<void>((resolve) => tcp.close(() => resolve()));
      process.off('unhandledRejection', onRejection);
      if (previousHost === undefined) {
        delete process.env.REDIS_HOST;
      } else {
        process.env.REDIS_HOST = previousHost;
      }
      if (previousPort === undefined) {
        delete process.env.REDIS_PORT;
      } else {
        process.env.REDIS_PORT = previousPort;
      }
    }
  }, 10_000);
});
