import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmojiRequestDto } from './dto/emoji-request.dto';
import { S3Bucket } from '@/common/s3/s3.bucket';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class EmojiService {
  private readonly s3: S3Client;

  constructor(private readonly configService: ConfigService,
              private readonly s3Bucket: S3Bucket) {
    this.s3 = s3Bucket.getInstance();
  }

  async generateImageUrl(req: EmojiRequestDto): Promise<string> {
    const key = `emoji/${req.sessionId}/${req.emojiId}/${req.emojiName}.png`; // TODO : 이모지는 무슨 형식으로 저장해야 하는지 확인

    const s3Params = {
      Bucket: this.configService.get<string>('S3_BUCKET_NAME'),
      Key: key,
      ContentType: 'image/png',
    };

    const command = new PutObjectCommand(s3Params);

    const expiresIn = this.configService.get<number>('S3_URL_EXPIRATION_SECONDS');

    return getSignedUrl(this.s3, command, {
      expiresIn: expiresIn,
    });
  }
}
