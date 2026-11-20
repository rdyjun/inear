import { DatabaseConnectionService } from '@/common/database/database-connection.service';

describe('DatabaseConnectionService', () => {
  function dataSource() {
    return {
      isInitialized: false,
      initialize: jest.fn(),
      query: jest.fn(),
      destroy: jest.fn(),
      driver: {},
    };
  }

  it('retries after the first connection failure without throwing', async () => {
    const source = dataSource();
    source.initialize
      .mockRejectedValueOnce(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      )
      .mockImplementationOnce(async () => {
        source.isInitialized = true;
      });
    const service = new DatabaseConnectionService(source as never);

    await expect(service.checkOnce()).resolves.toBeUndefined();
    expect(source.isInitialized).toBe(false);
    await service.checkOnce();
    expect(source.isInitialized).toBe(true);
    await expect(service.isReachable()).resolves.toBe(true);
  });

  it('drops a dead pool so the next attempt can connect again', async () => {
    const source = dataSource();
    source.isInitialized = true;
    source.query.mockRejectedValue(
      Object.assign(new Error('Connection lost'), {
        code: 'PROTOCOL_CONNECTION_LOST',
      }),
    );
    source.destroy.mockImplementation(async () => {
      source.isInitialized = false;
    });
    const service = new DatabaseConnectionService(source as never);

    await service.checkOnce();
    expect(source.destroy).toHaveBeenCalled();
    await expect(service.isReachable()).resolves.toBe(false);
  });
});
