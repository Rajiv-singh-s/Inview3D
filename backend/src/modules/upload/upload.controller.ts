import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

/**
 * POST /upload — multipart form field name `video`.
 *
 * Multer streams the file to a temp location on disk (configured in
 * UploadModule); UploadService then validates, transcodes-if-needed and
 * enqueues processing. Returns the created project so the client can navigate
 * straight to the processing page.
 */
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(FileInterceptor('video'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    const project = await this.uploadService.handleUpload(file);
    return {
      id: project.id,
      status: project.status,
      videoInfo: project.videoInfo,
      originalName: project.originalName,
    };
  }
}
