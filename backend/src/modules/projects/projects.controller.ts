import { Controller, Delete, Get, NotFoundException, Param } from '@nestjs/common';
import { ProjectsService } from './projects.service';

/**
 * Project listing, details, status polling and viewer metadata.
 * Capture upload and photosphere delivery live in PanoramaController.
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

  /** GET /status/:id — lightweight status/progress for polling. */
  @Get('status/:id')
  status(@Param('id') id: string) {
    const p = this.projects.findOne(id);
    return {
      id: p.id,
      status: p.status,
      progress: p.progress,
      steps: p.steps,
      error: p.error,
      updatedAt: p.updatedAt,
    };
  }

  /**
   * GET /viewer/:id — metadata the photosphere viewer needs. `width`/`height`
   * let the client confirm the image is a 2:1 equirectangular before mapping it
   * onto a sphere.
   */
  @Get('viewer/:id')
  viewer(@Param('id') id: string) {
    const p = this.projects.findOne(id);
    if (p.status !== 'completed' || !p.panoramaPath) {
      throw new NotFoundException('This photosphere is not ready yet');
    }
    return {
      id: p.id,
      originalName: p.originalName,
      panoramaUrl: `/panorama/${p.id}`,
      panoramaSizeBytes: p.panoramaSizeBytes,
      width: p.panoramaWidth,
      height: p.panoramaHeight,
      photoCount: p.photoCount,
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
