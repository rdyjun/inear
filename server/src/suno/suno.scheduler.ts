import { Injectable } from '@nestjs/common';
import { SunoService } from '@/suno/suno.service';

@Injectable()
export class SunoScheduler {

  constructor(
    private readonly sunoService: SunoService,
  ) {
  }

  // suno ai는 50크레딧 지급 및 2곡당 12크레딧 소모 (8곡 생성 가능)
  // 매일 자정마다 8곡 생성하여 콜백 URL로 전송
  // @Cron('0 0 * * *')
  async generateMusic() {
    const currentTime = new Date();
    console.log(
      `SCHEDULAR add to music by suno ai, Current time (KST): ${currentTime.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
    );

    let musicCount = 0;

    // 음악이 생성될 때마다 콜백 URL로 전송되므로, 8곡이 생성될 때까지 반복하여 요청
    while (true) {
      const request = {
        prompt: '모든 음악 장르 중 랜덤으로 생성', // 음악 생성에 사용할 프롬프트
        customMode: false,   // 사용자 정의 모드 사용 여부(가사, 분위기 등)
        instrumental: false, // 오디오를 가사 없는 반주로 할지 여부를 결정
        model: 'V5',         // 사용할 모델 선택
        callBackUrl: 'https://inear.live/api/suno/callback', // 생성 완료 후 콜백 URL
      };

      const response = await this.sunoService.generateMusic(request);
      if (response.status == 200) {
        console.log(`Generated ${++musicCount} Suno AI music response:`, response);
        continue;
      }

      console.log(`Failed to generate music, status: ${response.status}, response: ${response.data}`);
      break;
    }
  }
}
