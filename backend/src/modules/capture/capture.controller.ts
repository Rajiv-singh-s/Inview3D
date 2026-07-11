import {
  Controller,
  Post,
  Get,
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

  @Get(':id/splat')
  async getSplat(@Param('id') id: string): Promise<StreamableFile> {
    const stream = await this.captureService.getSplatStream(id);
    if (!stream) {
      throw new NotFoundException(`Splat file for project ${id} not found.`);
    }
    return new StreamableFile(stream);
  }

  @Get(':id/status')
  async getStatus(@Param('id') id: string) {
    return this.captureService.getStatus(id);
  }
}
