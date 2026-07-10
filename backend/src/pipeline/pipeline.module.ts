import { Module } from '@nestjs/common';
import { PipelineLoggerFactory } from '../common/logger/pipeline-logger.service';
import { PanoramaService } from './panorama.service';

/** Provides the photosphere stitching runner and its logger factory. */
@Module({
  providers: [PanoramaService, PipelineLoggerFactory],
  exports: [PanoramaService],
})
export class PipelineModule {}
