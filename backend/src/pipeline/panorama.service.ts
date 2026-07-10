import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig } from '../config/configuration';
import { PipelineLoggerFactory, ProjectLogger } from '../common/logger/pipeline-logger.service';
import { PipelineStepId } from '../common/interfaces';
import { ProjectsService } from '../modules/projects/projects.service';
import { CommandError, runCommand } from './command.util';

/** On-disk layout for one panorama capture. */
interface PanoramaWorkspace {
  root: string;
  photos: string;
  panorama: string;
  logs: string;
}

/** Minimum photos needed for OpenCV to estimate a rotation and stitch. */
const MIN_PHOTOS = 4;

/**
 * Builds a photosphere from photos captured while rotating in place.
 *
 * Purely classical CV: OpenCV's feature-based stitcher (features -> pairwise
 * matching -> bundle adjustment -> spherical warp -> multi-band blending).
 * No AI, no depth estimation. The output is rendered inside a sphere by the
 * viewer, so the imagery stays photoreal rather than being re-derived from
 * reconstructed geometry.
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

  workspace(projectId: string): PanoramaWorkspace {
    const root = path.join(this.app.uploadPath, projectId);
    return {
      root,
      photos: path.join(root, 'photos'),
      panorama: path.join(root, 'panorama'),
      logs: path.join(root, 'logs'),
    };
  }

  /** Creates the capture workspace up front so the controller can stream photos into it. */
  createWorkspace(projectId: string): PanoramaWorkspace {
    const ws = this.workspace(projectId);
    for (const dir of Object.values(ws)) fs.mkdirSync(dir, { recursive: true });
    return ws;
  }

  async run(projectId: string): Promise<void> {
    const ws = this.workspace(projectId);
    const log = this.loggerFactory.create(projectId, ws.logs);

    this.projects.setStatus(projectId, 'processing');
    log.info('Panorama pipeline started');

    await this.step(projectId, 'validate-photos', log, async () => {
      const photos = this.listPhotos(ws);
      if (photos.length < MIN_PHOTOS) {
        throw new Error(
          `Only ${photos.length} photos captured — need at least ${MIN_PHOTOS}. ` +
            'Complete the full rotation so consecutive shots overlap.',
        );
      }
      this.projects.update(projectId, { photoCount: photos.length });
      log.info(`Validated ${photos.length} photos`);
    });

    const panoPath = path.join(ws.panorama, 'panorama.jpg');
    await this.step(projectId, 'stitch-panorama', log, () => this.stitch(ws, panoPath, log));

    await this.step(projectId, 'optimize-panorama', log, () =>
      this.recordDimensions(projectId, panoPath, log),
    );

    await this.step(projectId, 'store-output', log, () =>
      this.storeOutput(projectId, panoPath, log),
    );

    this.projects.setStatus(projectId, 'completed');
    log.info('Panorama pipeline completed successfully');
  }

  private listPhotos(ws: PanoramaWorkspace): string[] {
    if (!fs.existsSync(ws.photos)) return [];
    return fs
      .readdirSync(ws.photos)
      .filter((f) => /\.(jpe?g|png)$/i.test(f))
      .sort();
  }

  private stitch(ws: PanoramaWorkspace, panoPath: string, log: ProjectLogger): Promise<void> {
    fs.mkdirSync(path.dirname(panoPath), { recursive: true });
    const script = path.join(this.app.pipelineScriptsDir, 'stitch_panorama.py');
    const args = [
      script,
      '--input',
      ws.photos,
      '--output',
      panoPath,
      '--max-dim',
      String(this.app.stitchMaxDim),
      '--max-width',
      String(this.app.panoramaMaxWidth),
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

  /**
   * Records the stitched dimensions, which the stitcher writes alongside the
   * image. The viewer checks these to confirm it received a 2:1 equirectangular
   * before mapping it onto a sphere.
   */
  private async recordDimensions(
    projectId: string,
    panoPath: string,
    log: ProjectLogger,
  ): Promise<void> {
    this.assertExists(panoPath, 'stitched panorama');
    const { width, height } = this.readDimensions(panoPath);
    this.projects.update(projectId, { panoramaWidth: width, panoramaHeight: height });
    log.info(`Panorama is ${width}x${height} (aspect ${(width / height).toFixed(2)})`);
  }

  /** Reads the sidecar metadata emitted by `stitch_panorama.py`. */
  private readDimensions(panoPath: string): { width: number; height: number } {
    const sidecar = panoPath.replace(/\.jpg$/, '.json');
    this.assertExists(sidecar, 'panorama metadata');
    const meta = JSON.parse(fs.readFileSync(sidecar, 'utf8')) as {
      width?: number;
      height?: number;
    };
    if (!meta.width || !meta.height) throw new Error('Panorama metadata has no dimensions');
    return { width: meta.width, height: meta.height };
  }

  private storeOutput(projectId: string, panoPath: string, log: ProjectLogger): Promise<void> {
    this.assertExists(panoPath, 'panorama');
    const outDir = path.join(this.app.outputPath, projectId);
    fs.mkdirSync(outDir, { recursive: true });
    const dest = path.join(outDir, 'panorama.jpg');
    fs.copyFileSync(panoPath, dest);
    const size = fs.statSync(dest).size;
    this.projects.update(projectId, {
      panoramaPath: path.join(projectId, 'panorama.jpg'),
      panoramaSizeBytes: size,
    });
    log.info(`Stored panorama (${size} bytes) at ${dest}`);
    return Promise.resolve();
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
