import {
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../../config/configuration';
import { ProjectsService } from './projects.service';

/**
 * REST surface for project listing, details, status polling, viewer metadata
 * and GLB download. Upload lives in its own module.
 */
@Controller()
export class ProjectsController {
  private readonly outputPath: string;

  constructor(
    private readonly projects: ProjectsService,
    config: ConfigService,
  ) {
    this.outputPath = config.getOrThrow<AppConfig>('app').outputPath;
  }

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

  /** GET /viewer/:id — metadata the 3D viewer needs to load the model. */
  @Get('viewer/:id')
  viewer(@Param('id') id: string) {
    const p = this.projects.findOne(id);
    if (p.status !== 'completed' || !p.glbPath) {
      throw new NotFoundException('Model is not ready for this project yet');
    }
    return {
      id: p.id,
      originalName: p.originalName,
      videoInfo: p.videoInfo,
      modelUrl: `/model/${p.id}`,
      glbSizeBytes: p.glbSizeBytes,
      completedAt: p.updatedAt,
    };
  }

  /** GET /model/:id — stream the generated GLB. */
  @Get('model/:id')
  @Header('Content-Type', 'model/gltf-binary')
  model(@Param('id') id: string, @Res({ passthrough: true }) res: Response): StreamableFile {
    const p = this.projects.findOne(id);
    if (!p.glbPath) throw new NotFoundException('No model available for this project');
    const abs = path.join(this.outputPath, p.glbPath);
    if (!fs.existsSync(abs)) throw new NotFoundException('Model file is missing on disk');
    res.set('Content-Disposition', `inline; filename="${id}.glb"`);
    return new StreamableFile(fs.createReadStream(abs));
  }

  /** DELETE /project/:id — remove record and all artifacts. */
  @Delete('project/:id')
  remove(@Param('id') id: string) {
    this.projects.remove(id);
    return { id, deleted: true };
  }
}
