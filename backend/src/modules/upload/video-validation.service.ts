import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { AppConfig } from '../../config/configuration';
import { VideoInfo } from '../../common/interfaces';
import { FfprobeService } from './ffprobe.service';

/**
 * Codecs the COLMAP/OpenMVS pipeline can consume directly after frame
 * extraction. Anything outside this set is transcoded to H.264/MP4 first.
 */
const PIPELINE_FRIENDLY_CODECS = new Set(['h264', 'hevc', 'mpeg4', 'vp9', 'vp8', 'av1']);

export interface ValidationResult {
  videoInfo: VideoInfo;
  /** True when the source must be transcoded to H.264 MP4 before processing. */
  needsTranscode: boolean;
}

/**
 * Validates an uploaded file is a genuine, non-corrupted, in-limits video and
 * decides whether it needs transcoding. Content-based (FFprobe), never
 * extension-based.
 */
@Injectable()
export class VideoValidationService {
  private readonly app: AppConfig;

  constructor(
    config: ConfigService,
    private readonly ffprobe: FfprobeService,
  ) {
    this.app = config.getOrThrow<AppConfig>('app');
  }

  async validate(filePath: string): Promise<ValidationResult> {
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException('Uploaded file does not exist on disk');
    }

    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      throw new BadRequestException('Uploaded file is empty (0 bytes)');
    }
    if (stat.size > this.app.maxUploadSize) {
      throw new BadRequestException(
        `File is too large (${this.formatBytes(stat.size)}). Maximum is ${this.formatBytes(
          this.app.maxUploadSize,
        )}.`,
      );
    }

    // FFprobe is the real validity check — throws if unreadable/corrupted.
    let videoInfo: VideoInfo;
    try {
      videoInfo = await this.ffprobe.probe(filePath);
    } catch (err) {
      throw new BadRequestException(
        `File is not a valid or is a corrupted video: ${(err as Error).message}`,
      );
    }

    if (videoInfo.durationSeconds <= 0) {
      throw new BadRequestException('Video has no measurable duration — it may be corrupted');
    }
    if (videoInfo.durationSeconds > this.app.maxDurationSeconds) {
      throw new BadRequestException(
        `Video is too long (${Math.round(videoInfo.durationSeconds)}s). Maximum is ${
          this.app.maxDurationSeconds
        }s.`,
      );
    }
    if (videoInfo.width <= 0 || videoInfo.height <= 0) {
      throw new BadRequestException('Video has no valid resolution');
    }

    const needsTranscode = !PIPELINE_FRIENDLY_CODECS.has(videoInfo.videoCodec.toLowerCase());
    return { videoInfo, needsTranscode };
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i++;
    }
    return `${value.toFixed(1)} ${units[i]}`;
  }
}
