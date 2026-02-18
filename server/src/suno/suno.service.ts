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

  async generateMusic(request: Record<string, any>): Promise<any> {
    const response = await lastValueFrom(
      this.httpService.post(
        `${this.baseUrl}/api/v1/generate`,
        request,
        {
          headers: {
            'Authorization': `Bearer ${process.env.SUNO_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30 * 1000, // 30초 타임아웃(응답은 콜백)
        },
      ),
    );

    if (response.status !== 200) {
      throw new Error(`Suno AI music generation failed: ${STATUS_CODES[response.status]} (${response.status})`);
    }

    return response;
  }

  /**
   * AlbumData 생성
   *
   * @param data          앨범 정보
   * @param streamingHour 스트리밍할 시간
   */
  async getAlbumData(data: Record<string, any>, streamingHour: number): Promise<AlbumDto> {
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

    // 오늘 날짜의 재생할 시간 설정
    const releaseDate = new Date();
    releaseDate.setHours(streamingHour, 0, 0, 0);

    // 1시간짜리 음악 정보 생성
    const song = {
      title,
      trackNumber: 1,
      lyrics: prompt,
      producer: '버그사냥단',
      composer: 'Suno AI',
      writer: 'Suno AI',
      instrument: 'Suno AI',
      source: 'Suno AI',
    };

    // 1시간짜리 음악 정보 생성
    const songs = this.generateHourSongInfo(song, 60 * 60, duration);

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

  async hasRemainingCredit(): Promise<boolean> {
    const response = await lastValueFrom(
      this.httpService.post(
        'https://api.sunoapi.org/api/v1/generate/credit',
        {
          headers: {
            'Authorization': `Bearer ${process.env.SUNO_API_KEY}`,
          },
          timeout: 30 * 1000, // 30초 타임아웃(응답은 콜백)
        },
      ),
    );

    if (response.status !== 200) {
      throw new Error(`Suno AI music generation failed: ${STATUS_CODES[response.status]} (${response.status})`);
    }

    return response.data.data >= 12; // 12크레딧 이상 남아있어야 다음 곡 생성 가능
  }

  private generateHourSongInfo(song: Record<string, any>, hour: number, duration: number) {
    const loopCount = hour / duration;
    const songs = [];

    for (let i = 1; i <= loopCount; i++) {
      song.totalTracks = i; // 트랙 번호 설정
      songs.push(song);
    }
    return songs;
  }
}
