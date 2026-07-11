import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import configuration from './config/configuration';
import { HealthController } from './health.controller';
import { ProjectsModule } from './modules/projects/projects.module';
import { CaptureModule } from './modules/capture/capture.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'data'),
      serveRoot: '/data',
    }),
    ProjectsModule,
    CaptureModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
