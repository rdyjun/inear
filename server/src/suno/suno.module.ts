import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SunoService } from './suno.service';
import { SunoScheduler } from '@/suno/suno.scheduler';
import { SunoController } from '@/suno/suno.controller';

@Module({
  imports: [HttpModule],
  controllers: [SunoController],
  providers: [SunoService, SunoScheduler],
  exports: [SunoService],
})
export class SunoModule {
}
