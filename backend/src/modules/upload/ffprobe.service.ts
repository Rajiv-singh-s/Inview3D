import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import { AppConfig } from '../../config/configuration';
import { VideoInfo } from '../../common/interfaces';

/**
 * Thin wrapper around FFprobe. Inspects a file's actual stream data rather
 * than trusting its extension, and parses the fields the UI displays.
 */
@Injectable()
export class FfprobeService {
  private readonly logger = new Logger(FfprobeService.name);

  constructor(config: ConfigService) {
    const app = config.getOrThrow<AppConfig>('app');
    if (app.bin.ffmpeg) ffmpeg.setFfmpegPath(app.bin.ffmpeg);
    if (app.bin.ffprobe) ffmpeg.setFfprobePath(app.bin.ffprobe);
  }

  /** Runs FFprobe and returns normalized {@link VideoInfo}. Rejects if the file is not a valid video. */
  probe(filePath: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, data) => {
        if (err) {
          return reject(new Error(`FFprobe could not read the file: ${err.message}`));
        }
        const videoStream = data.streams?.find((s) => s.codec_type === 'video');
        if (!videoStream) {
          return reject(new Error('No video stream found — the file is not a valid video'));
        }

        const stat = fs.statSync(filePath);
        const info: VideoInfo = {
          filename: filePath.split(/[\\/]/).pop() ?? filePath,
          sizeBytes: stat.size,
          durationSeconds: this.parseDuration(data, videoStream),
          width: videoStream.width ?? 0,
          height: videoStream.height ?? 0,
          fps: this.parseFps(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
          videoCodec: videoStream.codec_name ?? 'unknown',
          bitrate: Number.parseInt(String(data.format?.bit_rate ?? '0'), 10) || 0,
          container: data.format?.format_name ?? 'unknown',
        };
        resolve(info);
      });
    });
  }

  private parseDuration(data: ffmpeg.FfprobeData, stream: ffmpeg.FfprobeStream): number {
    const fromFormat = Number.parseFloat(String(data.format?.duration ?? ''));
    if (Number.isFinite(fromFormat) && fromFormat > 0) return fromFormat;
    const fromStream = Number.parseFloat(String(stream.duration ?? ''));
    return Number.isFinite(fromStream) ? fromStream : 0;
  }

  private parseFps(rate?: string): number {
    if (!rate) return 0;
    const [num, den] = rate.split('/').map(Number);
    if (!den || den === 0) return num || 0;
    return Math.round((num / den) * 100) / 100;
  }
}
