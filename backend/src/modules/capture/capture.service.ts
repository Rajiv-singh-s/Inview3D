import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { AppConfig } from '../../config/configuration';
import { ProjectsService } from '../projects/projects.service';

/**
 * Turns the 16 photos captured while rotating in place into a 360° equirectangular
 * panorama using the local OpenCV stitcher. No GPU, no cloud — a panorama is the
 * correct reconstruction for a fixed-point rotation capture (no parallax to solve).
 */
@Injectable()
export class CaptureService {
  private readonly logger = new Logger(CaptureService.name);
  private readonly app: AppConfig;

  constructor(
    private readonly projectsService: ProjectsService,
    configService: ConfigService,
  ) {
    this.app = configService.getOrThrow<AppConfig>('app');
  }

  private dataDir(id: string): string {
    return path.join(process.cwd(), 'data', id);
  }

  async storeCapture(
    files: Express.Multer.File[],
    name: string,
    location?: any,
    _poses?: any,
    _isPrivate?: boolean,
  ) {
    if (!files || files.length < 2) {
      // Surface a clear client error rather than a silent failure downstream.
      throw new Error(`Need at least 2 photos to build a panorama, received ${files?.length ?? 0}`);
    }

    const project = this.projectsService.createProject(name);
    this.projectsService.updateProject(project.id, { location, status: 'uploading', progress: 0 });

    const dir = path.join(this.dataDir(project.id), 'photos');
    await fs.mkdir(dir, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      await fs.writeFile(path.join(dir, `photo_${String(i).padStart(3, '0')}.jpg`), files[i].buffer);
    }

    // Stitch in the background; return immediately so the client can poll status.
    this.stitch(project.id, dir).catch((err) => {
      this.logger.error(`Stitch failed for ${project.id}: ${err.message}`);
      this.projectsService.updateProject(project.id, { status: 'failed', error: err.message });
    });

    return { id: project.id, status: 'processing', originalName: project.originalName };
  }

  private async stitch(projectId: string, photosDir: string): Promise<void> {
    this.projectsService.updateProject(projectId, { status: 'processing', progress: 10 });

    const script = path.join(this.app.pipelineScriptsDir, 'stitch_panorama.py');
    const output = path.join(this.dataDir(projectId), 'panorama.jpg');
    const args = [
      script,
      '--input',
      photosDir,
      '--output',
      output,
      '--max-dim',
      String(this.app.stitchMaxDim),
      '--max-width',
      String(this.app.panoramaMaxWidth),
    ];

    // Coarse progress heartbeat while the stitcher runs (it is not chatty).
    let progress = 10;
    const heartbeat = setInterval(() => {
      progress = Math.min(90, progress + 8);
      this.projectsService.updateProject(projectId, { progress });
    }, 2500);

    const stderr = await this.run('python3', args).catch(async (err) => {
      // Some images ship `python` rather than `python3`.
      if (String(err.message).includes('ENOENT')) return this.run('python', args);
      throw err;
    });
    clearInterval(heartbeat);

    try {
      await fs.access(output);
    } catch {
      throw new Error(`Stitcher produced no panorama.\n${stderr.slice(-500)}`);
    }
    this.projectsService.updateProject(projectId, { status: 'completed', progress: 100 });
    this.logger.log(`Panorama ready for ${projectId}`);
  }

  /** Runs a command, resolving with captured stderr on exit 0, rejecting otherwise. */
  private run(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { shell: false });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.stdout.on('data', (d) => this.logger.debug(d.toString().trim()));
      child.on('error', (e) => reject(new Error(`${cmd}: ${e.message}`)));
      child.on('close', (code) =>
        code === 0 ? resolve(stderr) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`)),
      );
    });
  }

  async getPanoramaStream(id: string) {
    const p = path.join(this.dataDir(id), 'panorama.jpg');
    try {
      await fs.access(p);
      return createReadStream(p);
    } catch {
      return null;
    }
  }

  async getStatus(id: string) {
    const p = this.projectsService.getProject(id);
    if (!p) return null;
    return { status: p.status, progress: p.progress, error: p.error };
  }
}
