import { Module } from '@nestjs/common';
import { SunoService } from './suno.service';
import { SunoScheduler } from '@/suno/suno.scheduler';
import { SunoController } from '@/suno/suno.controller';
import { HttpModule } from '@nestjs/axios';
import { AdminModule } from '@/admin/admin.module';
import { FileModule } from '@/common/converter/file.module';

@Module({
  imports: [HttpModule, AdminModule, FileModule],
  controllers: [SunoController],
  providers: [SunoService, SunoScheduler],
  exports: [SunoService],
})
export class SunoModule {
}
