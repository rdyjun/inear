import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3 } from 'aws-sdk';
import { EmojiRequestDto } from './dto/emoji-request.dto';
import { S3Bucket } from '@/common/s3/s3.bucket';

@Injectable()
export class EmojiService {
  private readonly s3: S3;

  constructor(private readonly configService: ConfigService,
              private readonly s3Bucket: S3Bucket) {
    this.s3 = s3Bucket.getInstance();
  }

  async generateImageUrl(req: EmojiRequestDto): Promise<string> {
    // URL 유효 시간 = 5분
    const key = `emoji/${req.sessionId}/${req.emojiId}/${req.emojiName}.png`; // TODO : 이모지는 무슨 형식으로 저장해야 하는지 확인

    const s3Params = {
      Bucket: this.configService.get('S3_BUCKET_NAME'),
      Key: key,
      Expires: this.configService.get<number>('S3_URL_EXPIRATION_SECONDS'),
      ContentType: 'image/png',
    };

    return this.s3.getSignedUrlPromise('putObject', s3Params);
  }
}
