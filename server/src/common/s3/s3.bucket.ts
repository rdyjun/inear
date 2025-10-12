import * as AWS from 'aws-sdk';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class S3Bucket {
  private readonly s3: AWS.S3;

  constructor(    private readonly configService: ConfigService) {
    const endpoint = configService.get<string>('S3_END_POINT');
    const region = configService.get<string>('S3_REGION');
    const accessKeyId = configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = configService.get<string>('S3_SECRET_KEY');

    this.s3 = new AWS.S3({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
    });
  }

  public getInstance() {
    return this.s3;
  }
}
