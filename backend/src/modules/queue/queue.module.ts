import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { PipelineModule } from '../../pipeline/pipeline.module';
import { STITCH_QUEUE } from './queue.constants';
import { StitchProcessor } from './stitch.processor';
import { StitchQueue } from './stitch.queue';

/**
 * Wires BullMQ to Redis and registers the stitching queue, its worker
 * (processor) and the enqueue facade.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const { redis } = config.getOrThrow<AppConfig>('app');
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: STITCH_QUEUE }),
    PipelineModule,
  ],
  providers: [StitchProcessor, StitchQueue],
  exports: [StitchQueue, BullModule],
})
export class QueueModule {}
