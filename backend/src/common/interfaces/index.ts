/**
 * Shared domain types for the InView3D backend.
 *
 * A project is a photosphere: photos captured while rotating in place, stitched
 * into a single equirectangular image and explored from inside a sphere.
 *
 * Phase 1 keeps all state in-process and mirrors it to a `project.json` file per
 * project. No database (by design). Interfaces are framework-agnostic so a
 * persistence layer can be added later without touching call sites.
 */

/** High-level lifecycle of a project. */
export type ProjectStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

/** Ordered pipeline steps. Keep in sync with {@link PANORAMA_STEPS}. */
export type PipelineStepId =
  | 'validate-photos'
  | 'stitch-panorama'
  | 'optimize-panorama'
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
  status: ProjectStatus;
  /** Overall progress 0–100. */
  progress: number;
  createdAt: string;
  updatedAt: string;

  /** Human-readable capture name. */
  originalName: string;
  /** Absolute path of the captured photos directory. */
  originalPath: string;

  /** Per-step state, in execution order. */
  steps: PipelineStepState[];

  /** Relative (to OUTPUT_PATH) path to the directory containing the 6 stitched cubemap faces. */
  facesPath?: string;
  /** Whether the 6 cubemap faces have been successfully stitched. */
  cubemapReady?: boolean;
  /** How many source photos were captured. */
  photoCount?: number;

  /** Populated when status === 'failed'. */
  error?: string;
}

/** Canonical ordered list of steps with human-readable labels. */
export const PANORAMA_STEPS: ReadonlyArray<{ id: PipelineStepId; label: string }> = [
  { id: 'validate-photos', label: 'Validate photos' },
  { id: 'stitch-panorama', label: 'Stitch cubemap faces' },
  { id: 'optimize-panorama', label: 'Optimize faces' },
  { id: 'store-output', label: 'Store output' },
] as const;

/** Payload carried by the stitching BullMQ job. */
export interface StitchJobData {
  projectId: string;
}
