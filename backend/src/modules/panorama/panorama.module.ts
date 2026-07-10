import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PipelineModule } from '../../pipeline/pipeline.module';
import { QueueModule } from '../queue/queue.module';
import { PanoramaCaptureService } from './panorama-capture.service';
import { PanoramaController } from './panorama.controller';

/**
 * Guided-capture ingestion + photosphere delivery.
 *
 * Photos are held in memory (they are small and few) and written to the
 * project workspace in capture order, so the stitcher sees consecutive,
 * overlapping frames.
 */
@Module({
  imports: [
    QueueModule,
    PipelineModule,
    MulterModule.register({
      limits: { fileSize: 20 * 1024 * 1024, files: 48 },
    }),
  ],
  controllers: [PanoramaController],
  providers: [PanoramaCaptureService],
})
export class PanoramaModule {}
