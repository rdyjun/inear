import { RoomController } from './room.controller';

describe('RoomController room info fallback', () => {
  it('returns zero listeners and the configured capacity when Redis is down', async () => {
    const previousCapacity = process.env.MAX_CAPACITY;
    process.env.MAX_CAPACITY = '40';
    const redis = {
      isReady: false,
      hGetAll: jest.fn(),
    };
    const controller = new RoomController(
      redis as never,
      {} as never,
      { findById: jest.fn().mockResolvedValue(null) } as never,
      {
        getAlbumTracksSorted: jest.fn().mockResolvedValue([]),
      } as never,
      { getTrackOrder: jest.fn().mockResolvedValue(null) } as never,
    );

    try {
      const info = await controller.getRoomInfo('room-1');
      expect(info.currentUsers).toBe('0');
      expect(info.maxCapacity).toBe('40');
      expect(info.success).toBe(true);
      expect(redis.hGetAll).not.toHaveBeenCalled();
    } finally {
      if (previousCapacity === undefined) {
        delete process.env.MAX_CAPACITY;
      } else {
        process.env.MAX_CAPACITY = previousCapacity;
      }
    }
  });
});
