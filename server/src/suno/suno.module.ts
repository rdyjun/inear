import { Module } from '@nestjs/common';
import { SunoService } from './suno.service';
import { ConfigModule } from '@nestjs/config';
import { SunoScheduler } from '@/suno/suno.scheduler';
import { SunoController } from '@/suno/suno.controller';

@Module({
  imports: [ConfigModule],
  controllers: [SunoController],
  providers: [SunoService, SunoScheduler],
  exports: [SunoService],
})
export class SunoModule {
}
