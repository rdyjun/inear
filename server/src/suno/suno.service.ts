import { Injectable } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { UploadedFiles } from '@/admin/admin.controller';
import { FileService } from '@/common/converter/file.service';
import { AlbumDto } from '@/admin/dto/album.dto';

export interface SunoGenerationResponse {
  id: string;
  title: string;
  image_url: string;
  lyric: string;
  audio_url: string;
  video_url: string;
  created_at: string;
  model_name: string;
  status: string;
  gpt_description_prompt: string;
  prompt: string;
  type: string;
  tags: string;
  duration?: number;
}

@Injectable()
export class SunoService {
  private readonly baseUrl = 'https://api.sunoapi.org';

  // 음원 실행 주기 설정 (1시간)
  private readonly cycle = 60 * 60 * 1000;

  constructor(private readonly httpService: HttpService,
              private readonly fileService: FileService) {
  }

  async generateMusic(request: Record<string, any>): Promise<string> {
    const response = await lastValueFrom(
      this.httpService.post(
        `${this.baseUrl}/api/v1/generate`,
        request,
        {
          headers: {
            'api-key': process.env.SUNO_API_KEY,
            'Content-Type': 'application/json',
          },
          timeout: 30 * 1000, // 30초 타임아웃(응답은 콜백)
        },
      ),
    );

    if (response.status !== 200) {
      throw new Error(`Suno AI music generation failed: ${STATUS_CODES[response.status]} (${response.status})`);
    }

    return response.data.taskId;
  }

  /**
   * AlbumData 생성
   *
   * @param data
   */
  async getAlbumData(data: Record<string, any>): Promise<AlbumDto> {
    const id: string = data.id;
    const audioUrl: string = data.audio_url;
    const title: string = data.title;
    const tags: string = data.tags;
    const duration: number = data.duration;
    const prompt: string = data.prompt; // 가사

    if (!audioUrl) {
      console.error(`Audio URL is missing for generated music with ID: ${id}`);
      return null;
    }

    const now = (new Date()).getTime();
    // 9시 34분인 경우 -> 10시 정각
    const releaseDate = new Date(Math.floor(now / this.cycle) * this.cycle + this.cycle);

    // 음악 정보
    const songs = [{
      title,
      trackNumber: 1,
      lyrics: prompt,
      producer: '버그사냥단',
      composer: 'Suno AI',
      writer: 'Suno AI',
      instrument: 'Suno AI',
      source: 'Suno AI',
    }];

    return new AlbumDto(
      title,
      '버그사냥단',
      releaseDate,
      1,
      songs,
      tags,
      duration,
      '',
      '', // 나중에 초기화
    );
  }

  /**
   * Files 생성
   *
   * @param data 콜백 데이터
   */
  async getFiles(data: Record<string, any>): Promise<UploadedFiles> {
    const id: string = data.id;
    const audioUrl: string = data.audio_url;
    const albumCoverUrl: string = data.image_url;

    if (!audioUrl) {
      console.error(`Audio URL is missing for generated music with ID: ${id}`);
      return null;
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

    return files;
  }
}
