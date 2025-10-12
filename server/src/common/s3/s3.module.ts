import { Module } from '@nestjs/common';
import { S3CacheService } from '@/common/s3Cache/s3Cache.service';
import { S3Bucket } from '@/common/s3/s3.bucket';

@Module({
  providers: [S3Bucket, S3CacheService],
  exports: [S3Bucket, S3CacheService],
})
export class S3Module {
}
