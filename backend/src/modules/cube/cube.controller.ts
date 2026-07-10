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
  @UseInterceptors(FilesInterceptor('faces', 6))
  async capture(@UploadedFiles() faces: Express.Multer.File[], @Body('name') name?: string) {
    const project = await this.cube.storeCapture(faces, name);
    return {
      id: project.id,
      status: project.status,
      faceCount: project.faces.length,
      originalName: project.originalName,
    };
  }

  /** GET /cube/:id/faces/:face — stream a stored face image. */
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
