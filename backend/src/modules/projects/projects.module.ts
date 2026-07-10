import { Global, Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/**
 * ProjectsService is used by upload, queue and viewer modules, so the module
 * is Global to avoid repetitive imports while keeping a single instance.
 */
@Global()
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
