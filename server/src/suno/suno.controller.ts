import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SunoService } from '@/suno/suno.service';
import { MissingSongFiles } from '@/common/exceptions/domain/song/missing-song-files.exception';
import { Album } from '@/album/album.entity';
import { AlbumCreationFailedException } from '@/common/exceptions/domain/album/album-creation-fail.exception';
import { AdminTransactionService } from '@/admin/admin.transaction.service';
import { AdminService } from '@/admin/admin.service';

@ApiTags('suno 관련 API')
@Controller('suno')
export class SunoController {

  // 스트리밍 시간 우선순위(시간 단위)
  private streamingTime: number[] = [
    12,
    18,
    20,
    13,
    11,
    10,
    19,
    14,
    15,
    16,
    17,
    9,
    21,
    22,
  ];

  // 현재 시간 인덱스
  private timeIndex = 0;

  constructor(
    private readonly adminTransactionService: AdminTransactionService,
    private readonly adminService: AdminService,
    private readonly sunoService: SunoService,
  ) {
  }

  @ApiOperation({ summary: 'suno 음원 생성 콜백 API' })
  @ApiResponse({ status: 200, description: 'Music generate success' })
  @Post('/callback')
  async callbackSunoAi(@Body() body: Record<string, any>): Promise<void> {
    for (let songIndex = 0; songIndex < body.data.data.length; songIndex++) {
      const data = body.data.data[songIndex];
      // timeIndex가 1씩 증가하며 음악이 재생될 시간대 선택
      const streamingHour = this.streamingTime[this.timeIndex++ % this.streamingTime.length];
      const albumData = await this.sunoService.getAlbumData(data, streamingHour);
      const files = await this.sunoService.getFiles(data);

      // 파일 생성 로직 호출
      if (!files.songs) {
        throw new MissingSongFiles();
      }
      const album = await this.adminTransactionService.saveInitialAlbum(
        // 접미사 -1-l 는 음악 순서 및 루프를 의미
        new Album(albumData, `${data.task_id}-${songIndex + 1}-l`),
      );

      const processedSongs = await this.adminService.processSongFiles(
        files.songs,
        albumData,
        album.id,
      );

      await this.adminTransactionService
        .saveRemainingData(album, processedSongs, files)
        .catch(async () => {
          await this.adminTransactionService.deleteCreatedAlbum(album.id);
          throw new AlbumCreationFailedException();
        });
    }
  }
}
