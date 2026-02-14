import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FileService } from '@/common/converter/file.service';

@Module({
  imports: [HttpModule],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {
}
