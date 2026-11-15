import { ServiceUnavailableException } from '@nestjs/common';
import { RoomRepository } from './room.repository';

describe('RoomRepository', () => {
  it('returns 503 instead of calling Redis when the client is down', async () => {
    const client = {
      isReady: false,
      hGet: jest.fn(),
      exists: jest.fn(),
    };
    const repository = new RoomRepository(client as never);

    await expect(repository.getCurrentUsers('room-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(repository.findRoom('room-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(client.hGet).not.toHaveBeenCalled();
    expect(client.exists).not.toHaveBeenCalled();
  });
});
