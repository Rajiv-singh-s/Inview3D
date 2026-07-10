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

  constructor(
    config: ConfigService,
    private readonly projects: ProjectsService,
  ) {
    this.outputPath = config.getOrThrow<AppConfig>('app').outputPath;
  }

  faceDir(id: string): string {
    return path.join(this.outputPath, id, 'cube');
  }

  async storeCapture(files: Express.Multer.File[], name?: string): Promise<Project> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No cube faces were uploaded');
    }

    // Map each upload to a known face; the last write for a face wins.
    const byFace = new Map<CubeFaceName, Express.Multer.File>();
    for (const file of files) {
      const face = faceFromFilename(file.originalname);
      if (!face) {
        throw new BadRequestException(`Unexpected face file: ${file.originalname}`);
      }
      byFace.set(face, file);
    }
    if (byFace.size === 0) {
      throw new BadRequestException('No recognizable cube faces were uploaded');
    }

    const project = this.projects.create({
      originalName: name?.trim() || `Room ${new Date().toLocaleString()}`,
    });

    const dir = this.faceDir(project.id);
    fs.mkdirSync(dir, { recursive: true });
    const stored: CubeFaceName[] = [];
    // Persist in canonical order for stable listings.
    for (const face of CUBE_FACES) {
      const file = byFace.get(face);
      if (!file) continue;
      fs.writeFileSync(path.join(dir, `${face}.jpg`), file.buffer);
      stored.push(face);
    }

    const completed = this.projects.update(project.id, {
      faces: stored,
      status: 'completed',
    });
    this.logger.log(`Stored cube ${project.id} with faces: ${stored.join(', ')}`);
    return completed;
  }

  /** Absolute path to a stored face image, or null if absent. */
  facePath(project: Project, face: string): string | null {
    if (!(CUBE_FACES as readonly string[]).includes(face)) return null;
    if (!project.faces.includes(face as CubeFaceName)) return null;
    const abs = path.join(this.faceDir(project.id), `${face}.jpg`);
    return fs.existsSync(abs) ? abs : null;
  }
}
