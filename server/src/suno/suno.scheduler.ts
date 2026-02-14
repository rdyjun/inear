import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SunoService } from '@/suno/suno.service';

@Injectable()
export class SunoScheduler {

  constructor(
    private readonly sunoService: SunoService,
  ) {
  }

  // 11시 30분, 12시 30분, 17시 30분, 19시 30분에 실행
  // 12시, 13시, 18시, 20시에 스트리밍
  @Cron('30 11,12,17,19 * * *')
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

    const response = await this.sunoService.generateMusic(request);
    console.log('Generated Suno AI music response:', response);
  }
}
