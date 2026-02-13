import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SunoService } from '@/suno/suno.service';

@Injectable()
export class SunoScheduler {

  constructor(
    private readonly sunoService: SunoService,
  ) {
  }

  // 9시 30분부터 18시 30분까지 매 시간 30분에 실행
  @Cron('30 9-18 * * *')
  async generateMusic() {
    const currentTime = new Date();
    console.log(
      `SCHEDULAR add to music by suno ai, Current time (KST): ${currentTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
    );

    const request = {
      customMode: false,   // 사용자 정의 모드 사용 여부(가사, 분위기 등)
      instrumental: false, // 오디오를 가사 없는 반주로 할지 여부를 결정
      model: 'V5',         // 사용할 모델 선택
      callBackUrl: 'https://inear.live/api/suno/callback', // 생성 완료 후 콜백 URL
    };

    const taskId = await this.sunoService.generateMusic(request);
    console.log('Generated Suno AI music taskId:', taskId);
  }
}
