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
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { CubeService } from './cube.service';
import { ProjectsService } from '../projects/projects.service';

@Controller()
export class CubeController {
  constructor(
    private readonly cube: CubeService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * POST /cube/capture — multipart with up to 6 `faces` files named
   * `<face>.jpg` (front|right|back|left|top|bottom), plus an optional `name`.
   */
  @Post('cube/capture')
  @UseInterceptors(FilesInterceptor('photos', 16))
  async capture(@UploadedFiles() photos: Express.Multer.File[], @Body('name') name?: string) {
    const project = await this.cube.storeCapture(photos, name);
    return {
      id: project.id,
      status: project.status,
      originalName: project.originalName,
    };
  }

  /** GET /cube/:id/splat — stream the stored .splat file. */
  @Get('cube/:id/splat')
  @Header('Content-Type', 'application/octet-stream')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  splat(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const project = this.projects.findOne(id);
    const abs = path.join(this.cube.faceDir(project.id), 'scene.splat');
    if (!fs.existsSync(abs)) throw new NotFoundException(`Splat file not found for this room`);
    res.set('Content-Disposition', `inline; filename="${id}-scene.splat"`);
    return new StreamableFile(fs.createReadStream(abs));
  }

  /** GET /cube/:id/faces/:face — stream a stored face image (legacy/unused). */
  @Get('cube/:id/faces/:face')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  face(
    @Param('id') id: string,
    @Param('face') face: string,
    @Res({ passthrough: true }) res: Response,
  ): StreamableFile {
    const project = this.projects.findOne(id);
    const abs = this.cube.facePath(project, face);
    if (!abs) throw new NotFoundException(`Face ${face} not available for this room`);
    res.set('Content-Disposition', `inline; filename="${id}-${face}.jpg"`);
    return new StreamableFile(fs.createReadStream(abs));
  }
}
