import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class FileService {
  constructor(private readonly httpService: HttpService) {
  }

  /**
   * URL에서 파일을 가져와 Multer.File 형식으로 변환 (이미지 + 음원 모두 지원)
   */
  async getFileAsMulterFile(fileUrl: string): Promise<Express.Multer.File> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(fileUrl, {
          responseType: 'arraybuffer',
        }),
      );

      const buffer = Buffer.from(response.data);

      // headers 타입 안전하게 처리
      const headers = response.headers as Record<string, string>;
      const contentType = headers['content-type'] || 'application/octet-stream';

      // URL에서 파일명 추출
      const urlParts = fileUrl.split('/');
      const originalFilename = urlParts[urlParts.length - 1].split('?')[0] || 'file';

      // Multer.File 객체 생성
      const multerFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: originalFilename,
        encoding: '7bit',
        mimetype: contentType,
        buffer: buffer,
        size: buffer.length,
        stream: null as any,
        destination: '',
        filename: '',
        path: '',
      };

      return multerFile;
    } catch (error) {
      throw new HttpException(
        `파일 가져오기 실패: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * 이미지 전용 메서드 (기존 호환성 유지)
   */
  async getImageAsMulterFile(imageUrl: string): Promise<Express.Multer.File> {
    return this.getFileAsMulterFile(imageUrl);
  }

  /**
   * 음원 전용 메서드
   */
  async getAudioAsMulterFile(audioUrl: string): Promise<Express.Multer.File> {
    const file = await this.getFileAsMulterFile(audioUrl);

    // 음원 파일인지 검증 (선택사항)
    const audioMimeTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/ogg',
      'audio/flac',
      'audio/aac',
      'audio/m4a',
    ];

    if (!audioMimeTypes.some(type => file.mimetype.includes(type))) {
      console.warn(`경고: ${audioUrl}은 음원 파일이 아닐 수 있습니다. (${file.mimetype})`);
    }

    return file;
  }

  /**
   * 여러 파일 URL을 Multer.File 배열로 변환
   */
  async getFilesAsMulterFiles(fileUrls: string[]): Promise<Express.Multer.File[]> {
    const promises = fileUrls.map(url => this.getFileAsMulterFile(url));
    return Promise.all(promises);
  }

  /**
   * 여러 이미지 URL을 Multer.File 배열로 변환
   */
  async getImagesAsMulterFiles(imageUrls: string[]): Promise<Express.Multer.File[]> {
    return this.getFilesAsMulterFiles(imageUrls);
  }

  /**
   * 여러 음원 URL을 Multer.File 배열로 변환
   */
  async getAudiosAsMulterFiles(audioUrls: string[]): Promise<Express.Multer.File[]> {
    const promises = audioUrls.map(url => this.getAudioAsMulterFile(url));
    return Promise.all(promises);
  }
}
