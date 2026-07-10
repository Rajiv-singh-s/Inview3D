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
  /** Maximum size of a single captured photo, in bytes. */
  maxPhotoSize: number;
  /** Maximum photos accepted in one capture. */
  maxPhotos: number;
  /** Longest side each photo is downscaled to before stitching. */
  stitchMaxDim: number;
  /** Upper bound on the stitched equirectangular width, in pixels. */
  panoramaMaxWidth: number;
  pipelineScriptsDir: string;
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

function resolvePath(value: string | undefined, fallback: string): string {
  const raw = value && value.trim().length > 0 ? value : fallback;
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

export default (): { app: AppConfig } => {
  const repoRoot = path.resolve(process.cwd(), '..');
  const defaultScripts = path.join(repoRoot, 'processing', 'scripts');

  return {
    app: {
      // Hosted platforms inject $PORT; honor it, else BACKEND_PORT.
      backendPort: toInt(process.env.BACKEND_PORT ?? process.env.PORT, 4000),
      corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
      uploadPath: resolvePath(process.env.UPLOAD_PATH, path.join(repoRoot, 'uploads')),
      outputPath: resolvePath(process.env.OUTPUT_PATH, path.join(repoRoot, 'output')),
      maxPhotoSize: toInt(process.env.MAX_PHOTO_SIZE, 20 * 1024 * 1024),
      maxPhotos: toInt(process.env.MAX_PHOTOS, 64),
      stitchMaxDim: toInt(process.env.STITCH_MAX_DIM, 1600),
      panoramaMaxWidth: toInt(process.env.PANORAMA_MAX_WIDTH, 8192),
      pipelineScriptsDir: resolvePath(process.env.PIPELINE_SCRIPTS_DIR, defaultScripts),
      redis: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: toInt(process.env.REDIS_PORT, 6379),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    },
  };
};
