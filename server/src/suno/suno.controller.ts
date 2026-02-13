import { Body, Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminService } from '@/admin/admin.service';
import { FileService } from '@/common/converter/file.service';
import { AdminController, UploadedFiles } from '@/admin/admin.controller';

@ApiTags('suno 관련 API')
@Controller('suno')
export class SunoController {

  // 음원 실행 주기 설정 (1시간)
  private readonly cycle = 60 * 60 * 1000;

  constructor(
    private readonly adminService: AdminService,
    private readonly adminController: AdminController,
    private readonly fileService: FileService,
  ) {
  }

  @ApiOperation({ summary: 'suno 음원 생성 콜백 API' })
  @ApiResponse({ status: 200, description: 'Music generate success' })
  @Get('/callback')
  async callbackSunoAi(@Body() body: Record<string, any>): Promise<any> {
    for (const data of body.data) {
      const id: string = data.id;
      const audioUrl: string = data.audio_url;
      const albumCoverUrl: string = data.image_url;
      const title: string = data.title;
      const tags: string = data.tags;
      const createTime: Date = data.createTime;
      const duration: number = data.duration;
      const prompt: string = data.prompt; // 가사

      if (!audioUrl) {
        console.error(`Audio URL is missing for generated music with ID: ${id}`);
        continue;
      }

      // 음원 파일
      const song: Express.Multer.File = await this.fileService.getAudioAsMulterFile(audioUrl);

      const files: UploadedFiles = {
        songs: [song],
      };

      // 앨범 커버 경로가 있는 경우 files에 추가
      if (albumCoverUrl) {
        files.albumCover = await this.fileService.getImageAsMulterFile(albumCoverUrl);
      }

      const now = (new Date()).getTime();
      // 9시 34분인 경우 -> 10시 정각
      const releaseDate = new Date(Math.floor(now / this.cycle) * this.cycle + this.cycle);

      const albumData = {
        title,
        artist: '버그사냥단',
        releaseDate,
        totalTracks: 1,
        songs: [{
          title,
          trackNumber: 1,
          lyrics: prompt,
          producer: '버그사냥단',
          composer: 'Suno AI',
          writer: 'Suno AI',
          instrument: 'Suno AI',
          source: 'Suno AI',
        }],
        tags,
        totalDuration: duration,
        bannerUrl: '',
        jacketUrl: '', // 나중에 초기화
      };

      // 파일 생성 로직 호출
      await this.adminController.createAlbum(files, JSON.stringify(albumData));

      console.log(`[${createTime}] Processed generated music with ID: ${id}`);
    }
  }
}
