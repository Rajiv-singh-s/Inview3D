/** Shared frontend types — mirror the backend's public API shapes. */

export interface VideoInfo {
  filename: string;
  sizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  bitrate: number;
  container: string;
}

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
  videoInfo?: VideoInfo;
  steps: PipelineStepState[];
  glbSizeBytes?: number;
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

export interface ViewerMetadata {
  id: string;
  originalName: string;
  videoInfo?: VideoInfo;
  modelUrl: string;
  glbSizeBytes?: number;
  completedAt: string;
}

export interface UploadResponse {
  id: string;
  status: ProjectStatus;
  videoInfo?: VideoInfo;
  originalName: string;
}
