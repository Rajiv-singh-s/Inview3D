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
  kind: ProjectKind;
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

/** Which pipeline produced a project's output. */
export type ProjectKind = 'mesh' | 'panorama';

interface ViewerMetadataBase {
  id: string;
  kind: ProjectKind;
  originalName: string;
  completedAt: string;
}

/** Video -> COLMAP/OpenMVS -> textured GLB, orbited from outside. */
export interface MeshViewerMetadata extends ViewerMetadataBase {
  kind: 'mesh';
  videoInfo?: VideoInfo;
  modelUrl: string;
  glbSizeBytes?: number;
}

/** Guided photo capture -> stitched photosphere, viewed from inside. */
export interface PanoramaViewerMetadata extends ViewerMetadataBase {
  kind: 'panorama';
  panoramaUrl: string;
  panoramaSizeBytes?: number;
  width?: number;
  height?: number;
  photoCount?: number;
}

export type ViewerMetadata = MeshViewerMetadata | PanoramaViewerMetadata;

export interface UploadResponse {
  id: string;
  status: ProjectStatus;
  videoInfo?: VideoInfo;
  originalName: string;
}
