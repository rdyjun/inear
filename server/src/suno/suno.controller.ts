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

  constructor(
    private readonly adminTransactionService: AdminTransactionService,
    private readonly adminService: AdminService,
    private readonly sunoService: SunoService,
  ) {
  }

  @ApiOperation({ summary: 'suno 음원 생성 콜백 API' })
  @ApiResponse({ status: 200, description: 'Music generate success' })
  @Post('/callback')
  async callbackSunoAi(@Body() body: Record<string, any>): Promise<any> {
    for (const data of body.data.data) {
      const albumData = await this.sunoService.getAlbumData(data);
      const files = await this.sunoService.getFiles(data);

      // 파일 생성 로직 호출
      if (!files.songs) {
        throw new MissingSongFiles();
      }
      const album = await this.adminTransactionService.saveInitialAlbum(
        new Album(albumData),
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
      return {
        albumId: album.id,
        message: 'Album songs updated to object storage successfully',
      };
    }
  }
}
