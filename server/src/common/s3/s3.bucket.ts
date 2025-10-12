import { S3Client } from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3Bucket {
  private readonly s3: S3Client;

  constructor(private readonly configService: ConfigService) {
    const endpoint = configService.get<string>('S3_END_POINT');
    const region = configService.get<string>('S3_REGION');
    const accessKeyId = configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = configService.get<string>('S3_SECRET_KEY');

    this.s3 = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      bucketEndpoint: false,
    });
  }

  public getInstance() {
    return this.s3;
  }
}
