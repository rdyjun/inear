import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { S3Bucket } from '@/common/s3/s3.bucket';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class S3CacheService {
  private readonly s3: S3Client;

  constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly s3Bucket: S3Bucket,
  ) {
    this.s3 = s3Bucket.getInstance();
  }

  async fetchFromS3<T extends string | Buffer>({
                                                 cacheKey,
                                                 s3Key,
                                                 cacheTTL,
                                                 transform,
                                               }: {
    cacheKey: string;
    s3Key: string;
    cacheTTL: number;
    transform: (data: Buffer) => T;
  }): Promise<T> {
    const cached = await this.cacheManager.get<T>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.configService.get<string>('S3_BUCKET_NAME'),
        Key: s3Key,
      });

      const response = await this.s3.send(command);

      const stream = response.Body as NodeJS.ReadableStream;
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const bodyBuffer = Buffer.concat(chunks);

      const content = transform(bodyBuffer);
      await this.cacheManager.set(cacheKey, content, cacheTTL);
      return content;

    } catch (e) {
      if (e.name === 'NoSuchKey' || e.name === 'NotFound') {
        const fileType = cacheKey.startsWith('m3u8:') ? 'M3U8' : 'Segment(ts)';
        throw new NotFoundException(`❗ ${fileType} Not Found : ${s3Key}`);
      }
      console.error('S3 GetObject Error:', e);
      throw e;
    }
  }
}
