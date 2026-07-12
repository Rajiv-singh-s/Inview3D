import {
  Controller,
  Post,
  Get,
  Header,
  Param,
  UseInterceptors,
  UploadedFiles,
  Body,
  StreamableFile,
  NotFoundException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { CaptureService } from './capture.service';

@Controller('capture')
export class CaptureController {
  constructor(private readonly captureService: CaptureService) {}

  @Post()
  @UseInterceptors(FilesInterceptor('photos', 16))
  async createCapture(
    @UploadedFiles() files: Express.Multer.File[],
    @Body('name') name: string,
    @Body('location') locationStr?: string,
    @Body('poses') posesStr?: string,
    @Body('isPrivate') isPrivateStr?: string,
  ) {
    const location = locationStr ? JSON.parse(locationStr) : undefined;
    const poses = posesStr ? JSON.parse(posesStr) : undefined;
    const isPrivate = isPrivateStr === 'true';

    return this.captureService.storeCapture(files, name, location, poses, isPrivate);
  }

  /** GET /capture/:id/panorama — stream the stitched 360° equirectangular image. */
  @Get(':id/panorama')
  @Header('Content-Type', 'image/jpeg')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getPanorama(@Param('id') id: string): Promise<StreamableFile> {
    const stream = await this.captureService.getPanoramaStream(id);
    if (!stream) {
      throw new NotFoundException(`Panorama for project ${id} is not ready.`);
    }
    return new StreamableFile(stream);
  }

  @Get(':id/status')
  async getStatus(@Param('id') id: string) {
    return this.captureService.getStatus(id);
  }
}
