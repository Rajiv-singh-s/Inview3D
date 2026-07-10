import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppConfig } from '../config/configuration';
import {
  PipelineLoggerFactory,
  ProjectLogger,
} from '../common/logger/pipeline-logger.service';
import { PipelineStepId } from '../common/interfaces';
import { ProjectsService } from '../modules/projects/projects.service';
import { CommandError, runCommand } from './command.util';

/** Resolved on-disk locations for one project's pipeline run. */
interface Workspace {
  root: string;
  originalVideo: string;
  frames: string;
  colmap: string;
  dense: string;
  mesh: string;
  textures: string;
  glb: string;
  logs: string;
}

/**
 * Executes the full classical photogrammetry pipeline for a project:
 * FFmpeg frame extraction → COLMAP SfM/MVS → OpenMVS mesh + texture →
 * GLB export → optimization. Each step updates project state and logs.
 *
 * The orchestration lives here (fine-grained progress + logging); the raw
 * toolchain commands are invoked directly so a failure can be attributed to a
 * specific step. Equivalent standalone shell scripts live in `processing/`.
 */
@Injectable()
export class PipelineService {
  private readonly logger = new Logger(PipelineService.name);
  private readonly app: AppConfig;

  constructor(
    config: ConfigService,
    private readonly projects: ProjectsService,
    private readonly loggerFactory: PipelineLoggerFactory,
  ) {
    this.app = config.getOrThrow<AppConfig>('app');
  }

  private get threads(): number {
    return this.app.processingThreads > 0 ? this.app.processingThreads : os.cpus().length;
  }

  private workspace(projectId: string): Workspace {
    const root = path.join(this.app.uploadPath, projectId);
    return {
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
  }

  private openmvsBin(name: string): string {
    return this.app.bin.openmvsDir ? path.join(this.app.bin.openmvsDir, name) : name;
  }

  /**
   * Runs the whole pipeline. Throws on the first failing step (after marking
   * that step failed) so the caller (BullMQ processor) can mark the project
   * failed and record the error.
   */
  async run(projectId: string): Promise<void> {
    const ws = this.workspace(projectId);
    const log = this.loggerFactory.create(projectId, ws.logs);
    const project = this.projects.findOne(projectId);

    this.projects.setStatus(projectId, 'processing');
    log.info('Pipeline started', { threads: this.threads });

    // Step 1 — validation already happened at upload time.
    await this.step(projectId, 'validate', log, async () => {
      if (!project.videoInfo) throw new Error('Missing video info');
    });

    // Step 2 — transcode to H.264 MP4 when the source codec is unfriendly.
    const workingVideo = await this.resolveWorkingVideo(projectId, ws, log);

    // Step 3 — extract frames.
    await this.step(projectId, 'extract-frames', log, () =>
      this.extractFrames(workingVideo, ws.frames, log),
    );

    // Steps 4–7 — COLMAP structure-from-motion + undistortion.
    await this.step(projectId, 'feature-extraction', log, () =>
      this.colmapFeatureExtraction(ws, log),
    );
    await this.step(projectId, 'feature-matching', log, () => this.colmapFeatureMatching(ws, log));
    await this.step(projectId, 'sparse-reconstruction', log, () => this.colmapMapper(ws, log));
    await this.step(projectId, 'image-undistortion', log, () => this.colmapUndistort(ws, log));

    // Steps 8–9 — OpenMVS densification (dense cloud + export).
    await this.step(projectId, 'dense-reconstruction', log, () => this.mvsDensify(ws, log));
    await this.step(projectId, 'export-point-cloud', log, async () => {
      this.assertExists(path.join(ws.dense, 'scene_dense.ply'), 'dense point cloud');
    });

    // Steps 10–11 — OpenMVS mesh + texturing.
    await this.step(projectId, 'mesh-reconstruction', log, () => this.mvsReconstructMesh(ws, log));
    await this.step(projectId, 'texture-mesh', log, () => this.mvsTextureMesh(ws, log));

    // Step 12 — GLB export.
    const glbPath = path.join(ws.glb, 'model.glb');
    await this.step(projectId, 'generate-glb', log, () => this.exportGlb(ws, glbPath, log));

    // Step 13 — optimize (best-effort; skipped if optimizer unavailable).
    await this.step(projectId, 'optimize-glb', log, () => this.optimizeGlb(glbPath, log));

    // Step 14 — publish output to the output directory.
    await this.step(projectId, 'store-output', log, () =>
      this.storeOutput(projectId, glbPath, log),
    );

    this.projects.setStatus(projectId, 'completed');
    log.info('Pipeline completed successfully');
  }

  // --------------------------------------------------------------------------
  // Step wrapper
  // --------------------------------------------------------------------------

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
        err instanceof CommandError
          ? `${err.message}\n${err.stderrTail}`
          : (err as Error).message;
      this.projects.updateStep(projectId, stepId, { status: 'failed', error: message });
      log.error(`[${stepId}] failed`, { error: message });
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // Steps
  // --------------------------------------------------------------------------

  private async resolveWorkingVideo(
    projectId: string,
    ws: Workspace,
    log: ProjectLogger,
  ): Promise<string> {
    const project = this.projects.findOne(projectId);
    if (project.workingVideoPath && fs.existsSync(project.workingVideoPath)) {
      this.projects.updateStep(projectId, 'transcode', { status: 'skipped' });
      return project.workingVideoPath;
    }
    // Needs transcode.
    const out = path.join(ws.originalVideo, 'working.mp4');
    await this.step(projectId, 'transcode', log, () =>
      this.transcodeToMp4(project.originalPath, out, log),
    );
    this.projects.update(projectId, { workingVideoPath: out });
    return out;
  }

  private transcodeToMp4(input: string, output: string, log: ProjectLogger): Promise<void> {
    return new Promise((resolve, reject) => {
      log.info(`Transcoding ${input} -> ${output} (H.264/AAC MP4)`);
      ffmpeg(input)
        .outputOptions(['-c:v libx264', '-preset medium', '-crf 20', '-pix_fmt yuv420p', '-an'])
        .on('stderr', (line) => log.raw('ffmpeg:transcode', line))
        .on('error', (err) => reject(new Error(`Transcode failed: ${err.message}`)))
        .on('end', () => resolve())
        .save(output);
    });
  }

  private extractFrames(video: string, framesDir: string, log: ProjectLogger): Promise<void> {
    fs.mkdirSync(framesDir, { recursive: true });
    const fps = 1 / Math.max(1, this.app.frameIntervalSeconds);
    return new Promise((resolve, reject) => {
      log.info(`Extracting frames at ${fps} fps (interval ${this.app.frameIntervalSeconds}s)`);
      const filters = [`fps=${fps}`];
      if (this.app.maxFrames > 0) {
        // Hard cap the number of frames extracted.
        filters.push(`select='lte(n\\,${this.app.maxFrames * this.app.frameIntervalSeconds})'`);
      }
      ffmpeg(video)
        .outputOptions(['-qscale:v 2'])
        .videoFilters(`fps=${fps}`)
        .output(path.join(framesDir, 'frame_%05d.jpg'))
        .on('stderr', (line) => log.raw('ffmpeg:frames', line))
        .on('error', (err) => reject(new Error(`Frame extraction failed: ${err.message}`)))
        .on('end', () => {
          const count = fs.readdirSync(framesDir).filter((f) => f.endsWith('.jpg')).length;
          if (count < 8) {
            return reject(
              new Error(
                `Only ${count} frames extracted — need at least 8 for reconstruction. ` +
                  'Use a longer video or a smaller frame interval.',
              ),
            );
          }
          log.info(`Extracted ${count} frames`);
          resolve();
        })
        .run();
    });
  }

  private get colmap() {
    return this.app.bin.colmap;
  }

  private get databasePath() {
    return 'database.db';
  }

  private colmapFeatureExtraction(ws: Workspace, log: ProjectLogger): Promise<void> {
    fs.mkdirSync(ws.colmap, { recursive: true });
    return runCommand(
      this.colmap,
      [
        'feature_extractor',
        '--database_path',
        path.join(ws.colmap, this.databasePath),
        '--image_path',
        ws.frames,
        '--ImageReader.single_camera',
        '1',
        '--SiftExtraction.num_threads',
        String(this.threads),
      ],
      log,
    );
  }

  private colmapFeatureMatching(ws: Workspace, log: ProjectLogger): Promise<void> {
    return runCommand(
      this.colmap,
      [
        'exhaustive_matcher',
        '--database_path',
        path.join(ws.colmap, this.databasePath),
        '--SiftMatching.num_threads',
        String(this.threads),
      ],
      log,
    );
  }

  private async colmapMapper(ws: Workspace, log: ProjectLogger): Promise<void> {
    const sparse = path.join(ws.colmap, 'sparse');
    fs.mkdirSync(sparse, { recursive: true });
    await runCommand(
      this.colmap,
      [
        'mapper',
        '--database_path',
        path.join(ws.colmap, this.databasePath),
        '--image_path',
        ws.frames,
        '--output_path',
        sparse,
      ],
      log,
    );
    if (!fs.existsSync(path.join(sparse, '0'))) {
      throw new Error(
        'Sparse reconstruction produced no model — the frames may not overlap enough. ' +
          'Record a slower, steadier walkthrough with more overlap between views.',
      );
    }
  }

  private colmapUndistort(ws: Workspace, log: ProjectLogger): Promise<void> {
    fs.mkdirSync(ws.dense, { recursive: true });
    return runCommand(
      this.colmap,
      [
        'image_undistorter',
        '--image_path',
        ws.frames,
        '--input_path',
        path.join(ws.colmap, 'sparse', '0'),
        '--output_path',
        ws.dense,
        '--output_type',
        'COLMAP',
      ],
      log,
    );
  }

  private async mvsDensify(ws: Workspace, log: ProjectLogger): Promise<void> {
    // Bring the undistorted COLMAP workspace into OpenMVS.
    await runCommand(
      this.openmvsBin('InterfaceCOLMAP'),
      ['-i', ws.dense, '-o', path.join(ws.dense, 'scene.mvs'), '--working-folder', ws.dense],
      log,
    );
    await runCommand(
      this.openmvsBin('DensifyPointCloud'),
      [
        path.join(ws.dense, 'scene.mvs'),
        '--working-folder',
        ws.dense,
        '--max-threads',
        String(this.threads),
      ],
      log,
    );
  }

  private async mvsReconstructMesh(ws: Workspace, log: ProjectLogger): Promise<void> {
    fs.mkdirSync(ws.mesh, { recursive: true });
    await runCommand(
      this.openmvsBin('ReconstructMesh'),
      [
        path.join(ws.dense, 'scene_dense.mvs'),
        '-o',
        path.join(ws.mesh, 'scene_mesh.mvs'),
        '--working-folder',
        ws.dense,
      ],
      log,
    );
  }

  private async mvsTextureMesh(ws: Workspace, log: ProjectLogger): Promise<void> {
    fs.mkdirSync(ws.textures, { recursive: true });
    await runCommand(
      this.openmvsBin('TextureMesh'),
      [
        path.join(ws.mesh, 'scene_mesh.mvs'),
        '-o',
        path.join(ws.textures, 'model_textured.obj'),
        '--export-type',
        'obj',
        '--working-folder',
        ws.dense,
      ],
      log,
    );
    this.assertExists(path.join(ws.textures, 'model_textured.obj'), 'textured mesh');
  }

  private exportGlb(ws: Workspace, glbPath: string, log: ProjectLogger): Promise<void> {
    fs.mkdirSync(path.dirname(glbPath), { recursive: true });
    const script = path.join(this.app.pipelineScriptsDir, '..', 'python', 'convert_to_glb.py');
    return runCommand(
      'python3',
      [script, '--input', path.join(ws.textures, 'model_textured.obj'), '--output', glbPath],
      log,
    ).catch((err) => {
      // Fall back to `python` on systems where python3 is unavailable.
      if (err instanceof CommandError && err.code === null) {
        return runCommand(
          'python',
          [script, '--input', path.join(ws.textures, 'model_textured.obj'), '--output', glbPath],
          log,
        );
      }
      throw err;
    });
  }

  private async optimizeGlb(glbPath: string, log: ProjectLogger): Promise<void> {
    // gltfpack (meshoptimizer) is optional. Skip gracefully if not installed.
    const optimized = glbPath.replace(/\.glb$/, '.opt.glb');
    try {
      await runCommand('gltfpack', ['-i', glbPath, '-o', optimized, '-cc'], log);
      fs.renameSync(optimized, glbPath);
      log.info('GLB optimized with gltfpack');
    } catch (err) {
      log.warn(`Skipping GLB optimization (gltfpack unavailable): ${(err as Error).message}`);
    }
  }

  private storeOutput(projectId: string, glbPath: string, log: ProjectLogger): Promise<void> {
    this.assertExists(glbPath, 'final GLB');
    const outDir = path.join(this.app.outputPath, projectId);
    fs.mkdirSync(outDir, { recursive: true });
    const dest = path.join(outDir, 'model.glb');
    fs.copyFileSync(glbPath, dest);
    const size = fs.statSync(dest).size;
    this.projects.update(projectId, {
      glbPath: path.join(projectId, 'model.glb'),
      glbSizeBytes: size,
    });
    log.info(`Stored output GLB (${size} bytes) at ${dest}`);
    return Promise.resolve();
  }

  private assertExists(file: string, what: string): void {
    if (!fs.existsSync(file)) {
      throw new Error(`Expected ${what} was not produced at ${file}`);
    }
  }
}
