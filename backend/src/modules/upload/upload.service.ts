import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../../config/configuration';
import { Project } from '../../common/interfaces';
import { ProjectsService } from '../projects/projects.service';
import { ReconstructionQueue } from '../queue/reconstruction.queue';
import { VideoValidationService } from './video-validation.service';

/**
 * Orchestrates the upload use case:
 *  1. validate the incoming file (FFprobe-based),
 *  2. create a project + canonical directory layout,
 *  3. move the preserved original into place,
 *  4. enqueue the reconstruction job.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadPath: string;

  constructor(
    config: ConfigService,
    private readonly validation: VideoValidationService,
    private readonly projects: ProjectsService,
    private readonly queue: ReconstructionQueue,
  ) {
    this.uploadPath = config.getOrThrow<AppConfig>('app').uploadPath;
  }

  async handleUpload(file: Express.Multer.File): Promise<Project> {
    if (!file) {
      throw new BadRequestException('No file was received');
    }

    const tempPath = file.path;
    try {
      // 1. Validate the file content.
      const { videoInfo, needsTranscode } = await this.validation.validate(tempPath);

      // 2. Create the project (allocates the id we key directories by).
      const project = this.projects.create({
        originalName: file.originalname,
        originalPath: tempPath, // updated below once moved
        videoInfo,
      });

      // 3. Build the canonical upload workspace and move the original in.
      const workspace = this.createWorkspace(project.id);
      const preservedOriginal = path.join(
        workspace.originalVideo,
        this.safeName(file.originalname),
      );
      fs.renameSync(tempPath, preservedOriginal);

      this.projects.update(project.id, {
        originalPath: preservedOriginal,
        // If no transcode is needed the working video is the original.
        workingVideoPath: needsTranscode ? undefined : preservedOriginal,
        status: 'queued',
      });
      // Record the transcode decision on the step for transparency.
      if (!needsTranscode) {
        this.projects.updateStep(project.id, 'transcode', { status: 'skipped' });
      }

      // 4. Enqueue background reconstruction.
      await this.queue.enqueue(project.id);
      this.logger.log(`Project ${project.id} queued for reconstruction`);

      return this.projects.findOne(project.id);
    } catch (err) {
      // Clean up the temp file on any validation failure.
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      throw err;
    }
  }

  /** Creates `uploads/<id>/{original-video,frames,colmap,dense,mesh,textures,glb,logs}`. */
  private createWorkspace(projectId: string) {
    const root = path.join(this.uploadPath, projectId);
    const dirs = {
      root,
      originalVideo: path.join(root, 'original-video'),
      frames: path.join(root, 'frames'),
      colmap: path.join(root, 'colmap'),
      dense: path.join(root, 'dense'),
      mesh: path.join(root, 'mesh'),
      textures: path.join(root, 'textures'),
      glb: path.join(root, 'glb'),
      logs: path.join(root, 'logs'),
    };
    for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
    return dirs;
  }

  private safeName(name: string): string {
    return name.replace(/[^\w.\-]+/g, '_');
  }
}
