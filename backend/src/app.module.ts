import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PanoramaModule } from './modules/panorama/panorama.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { QueueModule } from './modules/queue/queue.module';
import { HealthController } from './health.controller';

/**
 * Root module. ConfigModule is global; ProjectsModule is @Global so its service
 * is available everywhere. QueueModule owns BullMQ + the stitching worker;
 * PanoramaModule owns capture ingestion and photosphere delivery.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['../.env', '.env'],
    }),
    ProjectsModule,
    QueueModule,
    PanoramaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
