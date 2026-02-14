import { Injectable } from '@nestjs/common';
import { MusicRepository } from './music.repository';
import { M3U8Parser } from './parser/m3u8-parser';
import { S3CacheService } from '@/common/s3Cache/s3Cache.service';

@Injectable()
export class MusicService {
  private readonly SEGMENT_DURATION = 2;

  constructor(
    private readonly musicRepository: MusicRepository,
    private readonly m3u8Parser: M3U8Parser,
    private readonly s3CacheService: S3CacheService,
  ) {
  }

  async getSegmentContentForLoop(
    albumId: string,
    segmentId: string,
  ): Promise<Buffer> {
    const fixedSongIndex = 1; // 루프용 고정된 곡 인덱스

    return this.s3CacheService.fetchFromS3({
      cacheKey: `segment:${albumId}:${fixedSongIndex}:${segmentId}`,
      s3Key: `converted/${albumId}/${fixedSongIndex}/playlist${segmentId}.ts`,
      cacheTTL: 3600000,
      transform: (buffer) => buffer,
    });
  }

  async getSegmentContent(
    albumId: string,
    songIndex: string,
    segmentId: string,
  ): Promise<Buffer> {
    return this.s3CacheService.fetchFromS3({
      cacheKey: `segment:${albumId}:${songIndex}:${segmentId}`,
      s3Key: `converted/${albumId}/${parseInt(songIndex, 10)}/playlist${segmentId}.ts`,
      cacheTTL: 3600000,
      transform: (buffer) => buffer,
    });
  }

  async generateMusicFile(albumId: string): Promise<string> {
    const joinTimestamp = Date.now();
    const songMetadata = await this.musicRepository.findSongByJoinTimestamp(
      albumId,
      joinTimestamp,
    );
    const m3u8Content = await this.getM3U8Content(albumId, songMetadata);
    const skipSegments = Math.floor(
      (joinTimestamp - songMetadata.startTime) / (this.SEGMENT_DURATION * 1000),
    );

    return this.m3u8Parser.parse(
      m3u8Content,
      skipSegments,
      albumId,
      songMetadata.id,
    );
  }

  private async getM3U8Content(
    albumId: string,
    songMetadata: { id: string; duration: number },
  ): Promise<string> {
    return this.s3CacheService.fetchFromS3({
      cacheKey: `m3u8:${albumId}:${songMetadata.id}`,
      s3Key: `converted/${albumId}/${parseInt(songMetadata.id, 10)}/playlist.m3u8`,
      cacheTTL: songMetadata.duration * 1000,
      transform: (buffer) => buffer.toString(),
    });
  }
}
