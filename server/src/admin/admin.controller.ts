import { Body, Controller, Get, Post, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { AlbumDto } from './dto/album.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { AdminService } from './admin.service';
import { Album } from '@/album/album.entity';
import { AdminGuard } from './admin.guard';
import { plainToInstance } from 'class-transformer';
import { MissingSongFiles } from '@/common/exceptions/domain/song/missing-song-files.exception';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AdminTransactionService } from './admin.transaction.service';
import { AlbumCreationFailedException } from '@/common/exceptions/domain/album/album-creation-fail.exception';

export interface UploadedFiles {
  albumCover?: Express.Multer.File;
  bannerCover?: Express.Multer.File;
  songs: Express.Multer.File[];
}

@Controller('admin')
export class AdminController {
  constructor(
    private configService: ConfigService,
    private readonly adminService: AdminService,
    private readonly adminTransactionService: AdminTransactionService,
  ) {
  }

  @Post('login')
  async login(
    @Body() body: { adminKey: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adminService.login(body.adminKey);

    response.cookie('admin_token', result.token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: parseInt(this.configService.get('TOKEN_EXPIRATION')) * 1000,
    });

    return { message: 'Login successful' };
  }

  @UseGuards(AdminGuard)
  @Get('verify-token')
  async verifyAdminToken() {
    return { valid: true };
  }

  @UseGuards(AdminGuard)
  @Post('album')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'albumCover' },
      { name: 'bannerCover' },
      { name: 'songs' },
    ]),
  )
  async createAlbum(
    @UploadedFiles() files: UploadedFiles,
    @Body('albumData') albumDataString: string,
  ): Promise<any> {
    const albumData = plainToInstance(AlbumDto, JSON.parse(albumDataString));
    if (!files.songs) {
      throw new MissingSongFiles();
    }
    const album = await this.adminTransactionService.saveInitialAlbum(
      new Album(albumData),
    );

    const processedSongs = await this.adminService.processSongFiles(
      files.songs,
      albumData,
      album.id,
    );

    await this.adminTransactionService
      .saveRemainingData(album, processedSongs, files)
      .catch(async () => {
        await this.adminTransactionService.deleteCreatedAlbum(album.id);
        throw new AlbumCreationFailedException();
      });
    return {
      albumId: album.id,
      message: 'Album songs updated to object storage successfully',
    };
  }
}
