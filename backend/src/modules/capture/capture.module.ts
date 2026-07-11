import { Module } from '@nestjs/common';
import { CaptureController } from './capture.controller';
import { CaptureService } from './capture.service';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ProjectsModule],
  controllers: [CaptureController],
  providers: [CaptureService],
})
export class CaptureModule {}
