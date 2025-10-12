import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmojiService } from './emoji.service';
import { EmojiController } from './emoji.controller';
import { S3Module } from '@/common/s3/s3.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    S3Module,
  ],
  controllers: [EmojiController],
  providers: [EmojiService],
  exports: [EmojiService],
})
export class EmojiModule {
}
