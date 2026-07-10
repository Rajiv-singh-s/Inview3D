import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { CubeModule } from './modules/cube/cube.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { HealthController } from './health.controller';

/**
 * Root module. ConfigModule is global; ProjectsModule is @Global so its service
 * is available everywhere. CubeModule owns capture ingestion and face delivery.
 * No queue/Redis — the cube is built on the client, so nothing runs async here.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['../.env', '.env'],
    }),
    ProjectsModule,
    CubeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
