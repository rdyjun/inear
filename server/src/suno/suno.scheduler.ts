import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SunoService } from '@/suno/suno.service';

@Injectable()
export class SunoScheduler {

  constructor(
    private readonly sunoService: SunoService,
  ) {
  }

  // suno ai는 50크레딧 지급 및 2곡당 12크레딧 소모 (8곡 생성 가능)
  // 10:30, 13:30, 16:30, 19:30에 실행
  // 11시, 12시, 14시, 15시, 17시, 18시, 20시, 21시에 실행
  @Cron('30 10,13,16,19 * * *')
  async generateMusic() {
    const currentTime = new Date();
    console.log(
      `SCHEDULAR add to music by suno ai, Current time (KST): ${currentTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
    );

    const request = {
      prompt: '모든 음악 장르 중 랜덤으로 생성', // 음악 생성에 사용할 프롬프트
      customMode: false,   // 사용자 정의 모드 사용 여부(가사, 분위기 등)
      instrumental: false, // 오디오를 가사 없는 반주로 할지 여부를 결정
      model: 'V5',         // 사용할 모델 선택
      callBackUrl: 'https://inear.live/api/suno/callback', // 생성 완료 후 콜백 URL
    };

    const response = await this.sunoService.generateMusic(request);
    console.log('Generated Suno AI music response:', response);
  }
}
