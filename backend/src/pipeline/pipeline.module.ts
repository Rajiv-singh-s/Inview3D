import { Module } from '@nestjs/common';
import { PipelineLoggerFactory } from '../common/logger/pipeline-logger.service';
import { PipelineService } from './pipeline.service';

/** Provides the pipeline runner and its logger factory. */
@Module({
  providers: [PipelineService, PipelineLoggerFactory],
  exports: [PipelineService],
})
export class PipelineModule {}
