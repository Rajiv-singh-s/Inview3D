/**
 * Shared domain types for the InView3D backend.
 *
 * Phase 1 keeps all state in-process and mirrors it to a `project.json`
 * file per project. No database is used (by design). Interfaces are kept
 * framework-agnostic so a persistence layer can be added later without
 * touching call sites.
 */

/** Technical metadata probed from an uploaded video via FFprobe. */
export interface VideoInfo {
  filename: string;
  /** Size in bytes. */
  sizeBytes: number;
  /** Duration in seconds. */
  durationSeconds: number;
  width: number;
  height: number;
  /** Frames per second (may be fractional). */
  fps: number;
  videoCodec: string;
  /** Overall bitrate in bits/second (0 if unknown). */
  bitrate: number;
  /** Container / format name, e.g. "mov,mp4,m4a,3gp,3g2,mj2". */
  container: string;
}

/** High-level lifecycle of a project. */
export type ProjectStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

/**
 * Two reconstruction products, with different capture inputs and viewers:
 *
 * - `mesh`      — walkthrough video -> COLMAP + OpenMVS -> textured GLB,
 *                 viewed from outside with orbit controls.
 * - `panorama`  — photos captured rotating in place -> OpenCV stitching ->
 *                 photosphere, viewed from inside a sphere (Street View style).
 */
export type ProjectKind = 'mesh' | 'panorama';

/** Ordered pipeline steps. Keep in sync with {@link PIPELINE_STEPS} / {@link PANORAMA_STEPS}. */
export type PipelineStepId =
  // panorama pipeline
  | 'validate-photos'
  | 'stitch-panorama'
  | 'optimize-panorama'
  // mesh pipeline
  | 'validate'
  | 'transcode'
  | 'extract-frames'
  | 'feature-extraction'
  | 'feature-matching'
  | 'sparse-reconstruction'
  | 'image-undistortion'
  | 'dense-reconstruction'
  | 'export-point-cloud'
  | 'mesh-reconstruction'
  | 'texture-mesh'
  | 'generate-glb'
  | 'optimize-glb'
  | 'store-output';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PipelineStepState {
  id: PipelineStepId;
  label: string;
  status: StepStatus;
  /** ISO timestamps. */
  startedAt?: string;
  endedAt?: string;
  /** Duration in milliseconds once finished. */
  durationMs?: number;
  error?: string;
}

/** The full record persisted per project. */
export interface Project {
  id: string;
  /** Which pipeline produced (or will produce) this project's output. */
  kind: ProjectKind;
  status: ProjectStatus;
  /** Overall progress 0–100. */
  progress: number;
  createdAt: string;
  updatedAt: string;

  /** Original uploaded filename (as sent by the client). */
  originalName: string;
  /** Absolute path to the preserved original upload. */
  originalPath: string;
  /** Absolute path to the pipeline-ready MP4 (== originalPath if no transcode). */
  workingVideoPath?: string;

  videoInfo?: VideoInfo;

  /** Per-step state, in execution order. */
  steps: PipelineStepState[];

  /** Relative (to OUTPUT_PATH) path of the final GLB once produced (kind === 'mesh'). */
  glbPath?: string;
  /** Size of the produced GLB in bytes. */
  glbSizeBytes?: number;

  /** Relative (to OUTPUT_PATH) path of the stitched photosphere (kind === 'panorama'). */
  panoramaPath?: string;
  panoramaSizeBytes?: number;
  /** Pixel dimensions of the stitched panorama. */
  panoramaWidth?: number;
  panoramaHeight?: number;
  /** How many source photos were captured. */
  photoCount?: number;

  /** Populated when status === 'failed'. */
  error?: string;
}

/** Canonical ordered list of steps with human-readable labels. */
export const PIPELINE_STEPS: ReadonlyArray<{ id: PipelineStepId; label: string }> = [
  { id: 'validate', label: 'Validate video' },
  { id: 'transcode', label: 'Transcode to MP4 (if needed)' },
  { id: 'extract-frames', label: 'Extract frames' },
  { id: 'feature-extraction', label: 'COLMAP feature extraction' },
  { id: 'feature-matching', label: 'COLMAP feature matching' },
  { id: 'sparse-reconstruction', label: 'Sparse reconstruction' },
  { id: 'image-undistortion', label: 'Image undistortion' },
  { id: 'dense-reconstruction', label: 'Dense reconstruction' },
  { id: 'export-point-cloud', label: 'Export point cloud' },
  { id: 'mesh-reconstruction', label: 'OpenMVS mesh reconstruction' },
  { id: 'texture-mesh', label: 'Texture mesh' },
  { id: 'generate-glb', label: 'Generate GLB model' },
  { id: 'optimize-glb', label: 'Optimize GLB' },
  { id: 'store-output', label: 'Store output' },
] as const;

/** Ordered steps for the panorama (photosphere) pipeline. */
export const PANORAMA_STEPS: ReadonlyArray<{ id: PipelineStepId; label: string }> = [
  { id: 'validate-photos', label: 'Validate photos' },
  { id: 'stitch-panorama', label: 'Stitch photosphere' },
  { id: 'optimize-panorama', label: 'Optimize panorama' },
  { id: 'store-output', label: 'Store output' },
] as const;

/** Payload carried by the reconstruction BullMQ job. */
export interface ReconstructionJobData {
  projectId: string;
  /** Defaults to 'mesh' for jobs enqueued before this field existed. */
  kind?: ProjectKind;
}
