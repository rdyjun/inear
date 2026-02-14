import { IsArray, IsDate, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { SongDto } from './song.dto';
import { Expose, Transform, Type } from 'class-transformer';

export class AlbumDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  artist: string;

  @IsNotEmpty()
  @IsDate()
  @Type(() => Date)
  releaseDate: Date;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @IsOptional()
  totalTracks?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SongDto)
  songs: SongDto[];

  @IsString()
  @Expose({ name: 'albumTag' })
  @Transform(({ value, obj }) => value || obj.tags || '')
  tags: string;

  @IsNumber()
  totalDuration: number;

  @IsString()
  bannerUrl: string;

  @IsString()
  jacketUrl: string;

  public constructor(
    title: string,
    artist: string,
    releaseDate: Date,
    totalTracks: number,
    songs: SongDto[],
    tags: string,
    totalDuration: number,
    bannerUrl: string,
    jacketUrl: string,
  ) {
    this.title = title;
    this.artist = artist;
    this.releaseDate = releaseDate;
    this.totalTracks = totalTracks;
    this.songs = songs;
    this.tags = tags;
    this.totalDuration = totalDuration;
    this.bannerUrl = bannerUrl;
    this.jacketUrl = jacketUrl;
  }

  public setBannerUrl(url: string) {
    this.bannerUrl = url;
  }

  public setJacketUrl(url: string) {
    this.jacketUrl = url;
  }
}
