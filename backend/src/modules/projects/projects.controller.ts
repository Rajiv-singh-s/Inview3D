import { Controller, Delete, Get, NotFoundException, Param } from '@nestjs/common';
import { ProjectsService } from './projects.service';

/**
 * Project listing, details and viewer metadata. Cube capture ingestion and
 * face delivery live in CubeController.
 */
@Controller()
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** GET /projects — list all projects (newest first). */
  @Get('projects')
  list() {
    return this.projects.findAll();
  }

  /** GET /project/:id — full project record. */
  @Get('project/:id')
  detail(@Param('id') id: string) {
    return this.projects.findOne(id);
  }

  /** GET /viewer/:id — metadata the cube viewer needs: which faces to load. */
  @Get('viewer/:id')
  viewer(@Param('id') id: string) {
    const p = this.projects.findOne(id);
    if (p.status !== 'completed') {
      throw new NotFoundException('This room is not ready yet');
    }
    return {
      id: p.id,
      originalName: p.originalName,
      faces: p.faces,
      completedAt: p.updatedAt,
    };
  }

  /** DELETE /project/:id — remove record and all artifacts. */
  @Delete('project/:id')
  remove(@Param('id') id: string) {
    this.projects.remove(id);
    return { id, deleted: true };
  }
}
