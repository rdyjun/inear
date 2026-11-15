import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MusicProcessingSevice } from './music.processor';
import { CacheModule } from '@nestjs/cache-manager';
import { createKeyv } from 'cacheable';
import { MusicService } from './music.service';
import { MusicController } from './music.controller';
import { MusicRepository } from './music.repository';
import { M3U8Parser } from './parser/m3u8-parser';
import { S3Module } from '@/common/s3/s3.module';
import { AlbumModule } from '@/album/album.module';
import { SongModule } from '@/song/song.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    CacheModule.register({
      ttl: 3_600_000,
      // cache-manager v6 dropped the `max` option. KeyvCacheableMemory keeps
      // the previous 1000-item cap and stores Buffers without JSON serialization.
      stores: createKeyv({
        ttl: 3_600_000,
        lruSize: 1000,
        useClone: false,
      }),
      isGlobal: true,
    }),
    S3Module,
    AlbumModule,
    SongModule,
  ],
  controllers: [MusicController],
  providers: [MusicProcessingSevice, MusicService, MusicRepository, M3U8Parser],
  exports: [MusicProcessingSevice, MusicRepository],
})
export class MusicModule {}
