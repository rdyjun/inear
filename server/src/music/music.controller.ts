import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import { MusicService } from './music.service';

@Controller('music')
export class MusicController {

  private loopRegex = /^-%d-l$/;

  constructor(private readonly musicService: MusicService) {
  }

  @Get(':albumId/playlist.m3u8')
  @Header('Content-Type', 'application/x-mpegURL')
  async getMusicFile(@Param('albumId') albumId: string) {
    return await this.musicService.generateMusicFile(albumId);
  }

  @Get(':albumId/:songIndex/playlist:segmentId.ts')
  @Header('Content-Type', 'video/MP2T')
  async getSegment(
    @Param('albumId') albumId: string,
    @Param('songIndex') songIndex: string,
    @Param('segmentId') segmentId: string,
  ) {
    // -1-l, -2-1, ... 포함된 경우 같은 음악 재생을 위한 처리
    if (this.loopRegex.test(albumId)) {
      return new StreamableFile(
        await this.musicService.getSegmentContentForLoop(albumId, segmentId),
        { type: 'video/MP2T' },
      );
    }

    return new StreamableFile(
      await this.musicService.getSegmentContent(albumId, songIndex, segmentId),
      { type: 'video/MP2T' },
    );
  }
}
