import * as path from 'path';

/**
 * Central, strongly-typed configuration derived from environment variables.
 *
 * All relative paths are resolved to absolute paths against the process CWD
 * so the rest of the app never has to reason about relative locations.
 */
export interface AppConfig {
  backendPort: number;
  corsOrigin: string;
  uploadPath: string;
  outputPath: string;
  maxUploadSize: number;
  maxDurationSeconds: number;
  frameIntervalSeconds: number;
  maxFrames: number;
  processingThreads: number;
  pipelineScriptsDir: string;
  bin: {
    ffmpeg: string;
    ffprobe: string;
    colmap: string;
    openmvsDir: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Frame interval may be fractional (e.g. 0.5s => 2 fps), so parse as float. */
function toFloat(value: string | undefined, fallback: number): number {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function resolvePath(value: string | undefined, fallback: string): string {
  const raw = value && value.trim().length > 0 ? value : fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export default (): { app: AppConfig } => {
  const repoRoot = path.resolve(process.cwd(), '..');
  const defaultScripts = path.join(repoRoot, 'processing', 'scripts');

  return {
    app: {
      // Railway/hosted platforms inject $PORT; honor it, else BACKEND_PORT.
      backendPort: toInt(process.env.BACKEND_PORT ?? process.env.PORT, 4000),
      corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
      uploadPath: resolvePath(process.env.UPLOAD_PATH, path.join(repoRoot, 'uploads')),
      outputPath: resolvePath(process.env.OUTPUT_PATH, path.join(repoRoot, 'output')),
      maxUploadSize: toInt(process.env.MAX_UPLOAD_SIZE, 2 * 1024 * 1024 * 1024),
      maxDurationSeconds: toInt(process.env.MAX_DURATION_SECONDS, 300),
      frameIntervalSeconds: toFloat(process.env.FRAME_INTERVAL_SECONDS, 0.5),
      maxFrames: toInt(process.env.MAX_FRAMES, 300),
      processingThreads: toInt(process.env.PROCESSING_THREADS, 0),
      pipelineScriptsDir: resolvePath(process.env.PIPELINE_SCRIPTS_DIR, defaultScripts),
      bin: {
        ffmpeg: process.env.FFMPEG_BIN ?? 'ffmpeg',
        ffprobe: process.env.FFPROBE_BIN ?? 'ffprobe',
        colmap: process.env.COLMAP_BIN ?? 'colmap',
        openmvsDir: process.env.OPENMVS_BIN_DIR ?? '',
      },
      redis: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: toInt(process.env.REDIS_PORT, 6379),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    },
  };
};
