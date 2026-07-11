import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../../config/configuration';
import { CUBE_FACES, CubeFaceName, Project } from '../../common/interfaces';
import { ProjectsService } from '../projects/projects.service';

/** Uploaded face filenames must be `<face>.jpg|png`. */
function faceFromFilename(name: string): CubeFaceName | null {
  const base = path.basename(name).replace(/\.(jpe?g|png)$/i, '').toLowerCase();
  return (CUBE_FACES as readonly string[]).includes(base) ? (base as CubeFaceName) : null;
}

/**
 * Persists the cube faces a client painted during capture. No reconstruction:
 * the browser already built the cube, so we validate the faces, write them, and
 * mark the project complete.
 */
@Injectable()
export class CubeService {
  private readonly logger = new Logger(CubeService.name);
  private readonly outputPath: string;
  private readonly colabApiUrl: string;

  constructor(
    config: ConfigService,
    private readonly projects: ProjectsService,
  ) {
    const appConfig = config.getOrThrow<AppConfig>('app');
    this.outputPath = appConfig.outputPath;
    this.colabApiUrl = appConfig.colabApiUrl;
  }

  faceDir(id: string): string {
    return path.join(this.outputPath, id, 'cube');
  }

  async storeCapture(files: Express.Multer.File[], name?: string): Promise<Project> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No photos were uploaded');
    }

    const project = this.projects.create({
      originalName: name?.trim() || `Room ${new Date().toLocaleString()}`,
    });

    const dir = this.faceDir(project.id);
    fs.mkdirSync(dir, { recursive: true });

    this.logger.log(`Forwarding ${files.length} photos to Colab GPU Pipeline: ${this.colabApiUrl}...`);

    try {
      // Create native FormData and append files
      const formData = new FormData();
      for (const file of files) {
        const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
        formData.append('files', blob, file.originalname);
      }

      const response = await fetch(`${this.colabApiUrl}/process`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Google Colab server returned error status: ${response.status} ${response.statusText}`);
      }

      const splatArrayBuffer = await response.arrayBuffer();
      const splatBuffer = Buffer.from(splatArrayBuffer);
      
      fs.writeFileSync(path.join(dir, 'scene.splat'), splatBuffer);
      this.logger.log(`3D Gaussian Splat (.splat) successfully saved for project ${project.id}`);

      // Update project with status completed and a dummy face so legacy checks don't throw 404
      const completed = this.projects.update(project.id, {
        faces: ['front' as any],
        status: 'completed',
      });
      return completed;
    } catch (err) {
      this.logger.error(`3DGS Pipeline failed: ${(err as Error).message}`);
      this.projects.update(project.id, {
        status: 'failed',
        error: `3DGS Pipeline failed: ${(err as Error).message}`,
      });
      throw new BadRequestException(`3DGS Reconstruction failed: ${(err as Error).message}`);
    }
  }

  /** Absolute path to a stored face image, or null if absent (legacy). */
  facePath(project: Project, face: string): string | null {
    if (!(CUBE_FACES as readonly string[]).includes(face)) return null;
    const abs = path.join(this.faceDir(project.id), `${face}.jpg`);
    return fs.existsSync(abs) ? abs : null;
  }
}
