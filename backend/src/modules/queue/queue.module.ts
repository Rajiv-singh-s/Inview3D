import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { PipelineModule } from '../../pipeline/pipeline.module';
import { RECONSTRUCTION_QUEUE } from './queue.constants';
import { ReconstructionProcessor } from './reconstruction.processor';
import { ReconstructionQueue } from './reconstruction.queue';

/**
 * Wires BullMQ to Redis and registers the reconstruction queue, its worker
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
    BullModule.registerQueue({ name: RECONSTRUCTION_QUEUE }),
    PipelineModule,
  ],
  providers: [ReconstructionProcessor, ReconstructionQueue],
  exports: [ReconstructionQueue, BullModule],
})
export class QueueModule {}
