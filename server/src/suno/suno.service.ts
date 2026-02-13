import { Injectable } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

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

  constructor(private readonly httpService: HttpService) {
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
}
