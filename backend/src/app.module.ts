import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PanoramaModule } from './modules/panorama/panorama.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { QueueModule } from './modules/queue/queue.module';
import { UploadModule } from './modules/upload/upload.module';
import { HealthController } from './health.controller';

/**
 * Root module. ConfigModule is global; ProjectsModule is @Global so its
 * service is available everywhere. QueueModule owns BullMQ + the pipeline
 * worker; UploadModule owns ingestion.
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
    UploadModule,
    PanoramaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
