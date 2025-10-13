import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Song } from '@/song/song.entity';
import { SongSaveDto } from '@/song/dto/song-save.dto';
import { SongRepository } from '@/song/song.repository';
import { AlbumRepository } from '@/album/album.repository';
import { UploadedFiles } from '@/admin/admin.controller';
import { AdminRedisRepository } from '@/admin/admin.redis.repository';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { S3Bucket } from '@/common/s3/s3.bucket';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Album } from '@/album/album.entity';

@Injectable()
export class AdminService {
  private s3: S3Client;

  constructor(
    private configService: ConfigService,
    private readonly songRepository: SongRepository,
    private readonly albumRepository: AlbumRepository,
    private readonly adminRedisRepository: AdminRedisRepository,
    private jwtService: JwtService,
    private readonly s3Bucket: S3Bucket,
  ) {
    this.s3 = s3Bucket.getInstance();
  }

  async login(adminKey: string) {
    const correctHash = this.configService.get<string>('ADMIN_KEY');
    const isValid = await bcrypt.compare(adminKey, correctHash);

    if (!isValid) {
      throw new UnauthorizedException('Invalid admin key');
    }
    const expiration = parseInt(this.configService.get('TOKEN_EXPIRATION'));
    const now = Math.floor(Date.now() / 1000);

    const payload = {
      role: 'admin',
      iat: now,
      exp: now + expiration,
    };

    return {
      token: await this.jwtService.signAsync(payload),
      expiresIn: expiration,
    };
  }

  async uploadFile(
    file: Express.Multer.File,
    folder: string,
    fileType: 'cover' | 'banner',
  ): Promise<string> {
    const bucket = this.configService.get<string>('S3_BUCKET_NAME');
    const fileExtension = file.originalname.split('.').pop();
    const key = `${folder}/${fileType}.${fileExtension}`;

    try {
      const parallelUploads3 = new Upload({
        client: this.s3,
        params: {
          Bucket: bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'public-read',
        },
      });

      const result: { Location: string } = await parallelUploads3.done() as { Location: string };
      const location = result.Location;
      const endpoint = this.configService.get<string>('S3_END_POINT');
      const s3CdnPrefix = this.configService.get<string>('S3_CDN_PREFIX');

      return `${s3CdnPrefix}/${location.replace(endpoint, '')}`;

    } catch (e) {
      console.error('S3 Upload Error:', e);
      throw e;
    }
  }

  async saveSongs(songs: Song[], albumId: string) {
    const songsToSave = songs.map(
      (song) => new Song(new SongSaveDto({ ...song, albumId: albumId })),
    );

    await this.songRepository.saveSongList(songsToSave);
  }

  async saveAlbumCoverAndBanner(files: UploadedFiles, albumId: string) {
    const imageUrls: {
      albumCoverURL?: string;
      bannerCoverURL?: string;
    } = await this.uploadImageFiles(
      files.albumCover?.[0],
      files.bannerCover?.[0],
      `converted/${albumId}`,
    );

    await this.saveAlbumImages(
      albumId,
      imageUrls.albumCoverURL,
      imageUrls.bannerCoverURL,
    );
  }

  async initializeStreamingSession(processedSongs: Song[], album: Album) {
    const songDurations = processedSongs.map((song) => song.duration);
    const releaseTimestamp = album.releaseDate.getTime();

    await this.adminRedisRepository.createStreamingSession(
      album.id,
      releaseTimestamp,
      songDurations,
    );

    const totalDuration = songDurations.reduce((acc, cur) => acc + cur, 0);
    await this.albumRepository.saveTotalDuration(album.id, totalDuration);
  }

  private async uploadImageFiles(
    albumCoverFile: Express.Multer.File,
    bannerCoverFile: Express.Multer.File,
    prefix: string,
  ): Promise<{
    albumCoverURL?: string;
    bannerCoverURL?: string;
  }> {
    const results: {
      albumCoverURL?: string;
      bannerCoverURL?: string;
    } = {};

    if (albumCoverFile) {
      results.albumCoverURL = await this.uploadFile(
        albumCoverFile,
        prefix,
        'cover',
      );
    }

    if (bannerCoverFile) {
      results.bannerCoverURL = await this.uploadFile(
        bannerCoverFile,
        prefix,
        'banner',
      );
    }

    return results;
  }

  private async saveAlbumImages(
    albumId: string,
    coverUrl?: string,
    bannerUrl?: string,
  ) {
    if (coverUrl) {
      await this.albumRepository.updateCoverById(albumId, coverUrl);
    }
    if (bannerUrl) {
      await this.albumRepository.updateBannerById(albumId, bannerUrl);
    }
  }
}
