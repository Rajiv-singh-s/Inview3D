import { Module } from '@nestjs/common';
import { PipelineLoggerFactory } from '../common/logger/pipeline-logger.service';
import { PanoramaService } from './panorama.service';
import { PipelineService } from './pipeline.service';

/** Provides both pipeline runners (mesh + panorama) and their logger factory. */
@Module({
  providers: [PipelineService, PanoramaService, PipelineLoggerFactory],
  exports: [PipelineService, PanoramaService],
})
export class PipelineModule {}
