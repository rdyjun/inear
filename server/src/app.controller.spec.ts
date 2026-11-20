import { HttpException } from '@nestjs/common';
import { AppController } from '@/app.controller';

describe('AppController health', () => {
  it('stays healthy when mysql and redis are down', async () => {
    const database = { isReachable: jest.fn() };
    const controller = new AppController(
      { isReady: false } as never,
      database as never,
    );

    expect(controller.healthCheck()).toEqual({
      success: true,
      health: 'healthy',
    });
    expect(database.isReachable).not.toHaveBeenCalled();

    await expect(controller.readiness()).rejects.toBeInstanceOf(HttpException);
    try {
      await controller.readiness();
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(503);
      expect((error as HttpException).getResponse()).toEqual({
        success: false,
        db: 'down',
        redis: 'down',
      });
    }
  });

  it('reports ready when both dependencies answer', async () => {
    const controller = new AppController({ isReady: true } as never, {
      isReachable: async () => true,
    } as never);
    await expect(controller.readiness()).resolves.toEqual({
      success: true,
      db: 'up',
      redis: 'up',
    });
  });
});