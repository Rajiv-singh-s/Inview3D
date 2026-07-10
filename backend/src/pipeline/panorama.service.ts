import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../config/configuration';
import { PipelineLoggerFactory, ProjectLogger } from '../common/logger/pipeline-logger.service';
import { PipelineStepId } from '../common/interfaces';
import { ProjectsService } from '../modules/projects/projects.service';
import { CommandError, runCommand } from './command.util';

/** On-disk layout for one cubemap capture. */
interface CubemapWorkspace {
  root: string;
  photos: string;
  faces: string;
  logs: string;
}

const CUBE_FACES = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/**
 * Builds a cubemap from 18 guided photos (3 per face).
 */
@Injectable()
export class PanoramaService {
  private readonly logger = new Logger(PanoramaService.name);
  private readonly app: AppConfig;

  constructor(
    config: ConfigService,
    private readonly projects: ProjectsService,
    private readonly loggerFactory: PipelineLoggerFactory,
  ) {
    this.app = config.getOrThrow<AppConfig>('app');
  }

  workspace(projectId: string): CubemapWorkspace {
    const root = path.join(this.app.uploadPath, projectId);
    return {
      root,
      photos: path.join(root, 'photos'),
      faces: path.join(root, 'faces'),
      logs: path.join(root, 'logs'),
    };
  }

  /** Creates the capture workspace up front so the controller can stream photos into it. */
  createWorkspace(projectId: string): CubemapWorkspace {
    const ws = this.workspace(projectId);
    for (const dir of Object.values(ws)) fs.mkdirSync(dir, { recursive: true });
    return ws;
  }

  async run(projectId: string): Promise<void> {
    const ws = this.workspace(projectId);
    const log = this.loggerFactory.create(projectId, ws.logs);

    this.projects.setStatus(projectId, 'processing');
    log.info('Cubemap pipeline started');

    await this.step(projectId, 'validate-photos', log, async () => {
      const count = this.countPhotos(ws.photos);
      if (count !== 18) {
        throw new Error(
          `Expected exactly 18 photos (3 per face) for cubemap, but found ${count}.`
        );
      }
      this.projects.update(projectId, { photoCount: count });
      log.info(`Validated 18 photos grouped by face`);
    });

    await this.step(projectId, 'stitch-panorama', log, async () => {
      // Stitch each face independently
      for (const face of CUBE_FACES) {
        const faceInput = path.join(ws.photos, face);
        const faceOutput = path.join(ws.faces, `${face}.jpg`);
        
        // Only run if the face folder exists (which it should)
        if (fs.existsSync(faceInput)) {
          log.info(`Stitching face: ${face}`);
          await this.stitchFace(faceInput, faceOutput, log);
        }
      }
    });

    await this.step(projectId, 'optimize-panorama', log, async () => {
      for (const face of CUBE_FACES) {
        const faceOutput = path.join(ws.faces, `${face}.jpg`);
        this.assertExists(faceOutput, `stitched face ${face}`);
      }
      log.info('All 6 faces optimized and verified');
    });

    await this.step(projectId, 'store-output', log, async () => {
      const outDir = path.join(this.app.outputPath, projectId, 'faces');
      fs.mkdirSync(outDir, { recursive: true });
      
      let totalSize = 0;
      for (const face of CUBE_FACES) {
        const src = path.join(ws.faces, `${face}.jpg`);
        const dest = path.join(outDir, `${face}.jpg`);
        fs.copyFileSync(src, dest);
        totalSize += fs.statSync(dest).size;
      }
      
      this.projects.update(projectId, {
        facesPath: path.join(projectId, 'faces'),
        cubemapReady: true,
      });
      log.info(`Stored 6 faces (${totalSize} bytes total) at ${outDir}`);
    });

    this.projects.setStatus(projectId, 'completed');
    log.info('Cubemap pipeline completed successfully');
  }

  private countPhotos(dir: string): number {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const res = path.resolve(dir, entry.name);
      if (entry.isDirectory()) {
        count += this.countPhotos(res);
      } else if (/\.(jpe?g|png)$/i.test(entry.name)) {
        count++;
      }
    }
    return count;
  }

  private stitchFace(inputDir: string, outputPath: string, log: ProjectLogger): Promise<void> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const script = path.join(this.app.pipelineScriptsDir, 'stitch_cubemap.py');
    const args = [
      script,
      '--input',
      inputDir,
      '--output',
      outputPath,
      '--max-dim',
      String(this.app.stitchMaxDim),
    ];
    
    // On Windows, 'python' is the standard executable, whereas 'python3' is common on Unix.
    const primaryCmd = process.platform === 'win32' ? 'python' : 'python3';
    const fallbackCmd = process.platform === 'win32' ? 'python3' : 'python';

    return runCommand(primaryCmd, args, log).catch((err) => {
      if (err instanceof CommandError && err.code === null) {
        return runCommand(fallbackCmd, args, log);
      }
      throw err;
    });
  }

  private async step(
    projectId: string,
    stepId: PipelineStepId,
    log: ProjectLogger,
    fn: () => Promise<void>,
  ): Promise<void> {
    const started = Date.now();
    this.projects.updateStep(projectId, stepId, { status: 'running' });
    log.info(`[${stepId}] start`);
    try {
      await fn();
      this.projects.updateStep(projectId, stepId, { status: 'completed' });
      log.info(`[${stepId}] done`, { durationMs: Date.now() - started });
    } catch (err) {
      const message =
        err instanceof CommandError ? `${err.message}\n${err.stderrTail}` : (err as Error).message;
      this.projects.updateStep(projectId, stepId, { status: 'failed', error: message });
      log.error(`[${stepId}] failed`, { error: message });
      throw err;
    }
  }

  private assertExists(file: string, what: string): void {
    if (!fs.existsSync(file)) throw new Error(`Expected ${what} was not produced at ${file}`);
  }
}
