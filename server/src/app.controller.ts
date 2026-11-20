import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RedisClientType } from 'redis';
import { REDIS_CLIENT } from '@/common/redis/redis.module';
import { DatabaseConnectionService } from '@/common/database/database-connection.service';

@ApiTags('건강 체크')
@Controller()
export class AppController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: RedisClientType,
    private readonly database: DatabaseConnectionService,
  ) {}

  @ApiOperation({ summary: 'liveness. 프로세스가 살아 있으면 200' })
  @Get('/health')
  healthCheck() {
    return { success: true, health: 'healthy' };
  }

  @ApiOperation({ summary: 'readiness. db와 redis 상태를 보고한다' })
  @Get('/health/ready')
  async readiness() {
    const redis = Boolean(this.redisClient?.isReady);
    const db = await this.database.isReachable();
    const body = {
      success: redis && db,
      db: db ? 'up' : 'down',
      redis: redis ? 'up' : 'down',
    };
    if (!body.success) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }
}
