import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { customAlphabet } from 'nanoid';
import { AppConfig } from '../../config/configuration';
import { QueueModule } from '../queue/queue.module';
import { FfprobeService } from './ffprobe.service';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';
import { VideoValidationService } from './video-validation.service';

const tempName = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

@Module({
  imports: [
    QueueModule,
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const app = config.getOrThrow<AppConfig>('app');
        const incoming = path.join(app.uploadPath, '_incoming');
        fs.mkdirSync(incoming, { recursive: true });
        return {
          storage: diskStorage({
            destination: incoming,
            filename: (_req, file, cb) => {
              const ext = path.extname(file.originalname) || '.bin';
              cb(null, `${tempName()}${ext}`);
            },
          }),
          limits: { fileSize: app.maxUploadSize },
        };
      },
    }),
  ],
  controllers: [UploadController],
  providers: [UploadService, VideoValidationService, FfprobeService],
  exports: [FfprobeService],
})
export class UploadModule {}
