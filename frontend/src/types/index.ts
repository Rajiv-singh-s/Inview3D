/** Shared frontend types — mirror the backend's public API shapes. */

export type ProjectStatus =
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface PipelineStepState {
  id: string;
  label: string;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface Project {
  id: string;
  status: ProjectStatus;
  progress: number;
  createdAt: string;
  updatedAt: string;
  originalName: string;
  steps: PipelineStepState[];
  panoramaSizeBytes?: number;
  photoCount?: number;
  error?: string;
}

export interface StatusResponse {
  id: string;
  status: ProjectStatus;
  progress: number;
  steps: PipelineStepState[];
  error?: string;
  updatedAt: string;
}

/** Metadata the photosphere viewer needs. An equirectangular image is 2:1. */
export interface ViewerMetadata {
  id: string;
  originalName: string;
  panoramaUrl: string;
  panoramaSizeBytes?: number;
  width?: number;
  height?: number;
  photoCount?: number;
  completedAt: string;
}

export interface CaptureResponse {
  id: string;
  status: ProjectStatus;
  photoCount: number;
  originalName: string;
}
