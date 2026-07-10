import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../../config/configuration';
import { ProjectsService } from '../projects/projects.service';
import { PanoramaCaptureService } from './panorama-capture.service';

/** Upper bound on photos per capture; the guided UI shoots ~16. */
const MAX_PHOTOS = 48;

@Controller()
export class PanoramaController {
  private readonly outputPath: string;

  constructor(
    private readonly capture: PanoramaCaptureService,
    private readonly projects: ProjectsService,
    config: ConfigService,
  ) {
    this.outputPath = config.getOrThrow<AppConfig>('app').outputPath;
  }

  /**
   * POST /panorama/capture — multipart with repeated `photos` fields, in
   * capture order, plus an optional `name`.
   */
  @Post('panorama/capture')
  @UseInterceptors(FilesInterceptor('photos', MAX_PHOTOS))
  async createCapture(
    @UploadedFiles() photos: Express.Multer.File[],
    @Body('name') name?: string,
    /** JSON-encoded array of `{ yaw, pitch }`, one per photo, in capture order. */
    @Body('poses') poses?: string,
  ) {
    const project = await this.capture.handleCapture(photos, name, poses);
    return {
      id: project.id,
      status: project.status,
      photoCount: project.photoCount,
      originalName: project.originalName,
    };
  }

  /** GET /panorama/:id/faces/:face — stream the stitched cubemap face JPEG. */
  @Get('panorama/:id/faces/:face')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  panoramaFace(
    @Param('id') id: string,
    @Param('face') face: string,
    @Res({ passthrough: true }) res: Response
  ): StreamableFile {
    const project = this.projects.findOne(id);
    if (!project.facesPath || !project.cubemapReady) {
      throw new NotFoundException('Cubemap is not available yet');
    }
    const abs = path.join(this.outputPath, project.facesPath, `${face}.jpg`);
    if (!fs.existsSync(abs)) throw new NotFoundException(`Face ${face} is missing on disk`);
    res.set('Content-Disposition', `inline; filename="${id}_${face}.jpg"`);
    return new StreamableFile(fs.createReadStream(abs));
  }
}
