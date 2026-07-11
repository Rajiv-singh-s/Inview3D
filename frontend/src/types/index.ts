/** Shared frontend types — mirror the backend's public API shapes. */

// ─── Project & Status ────────────────────────────────────────────────────────

export type ProjectStatus = 'uploading' | 'processing' | 'completed' | 'failed';

export interface GeoLocation {
  lat: number;
  lon: number;
  name?: string;
}

export interface Project {
  id: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  originalName: string;
  location?: GeoLocation;
  progress?: number;
  error?: string;
}

// ─── Capture ─────────────────────────────────────────────────────────────────

/** A single capture target on the coordinate sphere. */
export interface SphereTarget {
  id: number;
  yaw: number;
  pitch: number;
}

/** Camera pose recorded at capture time. */
export interface CameraPose {
  yaw: number;
  pitch: number;
  roll: number;
  timestamp: number;
}

/** A captured frame alongside its metadata. */
export interface CapturedFrame {
  targetId: number;
  blob: Blob;
  thumbnailUrl: string;
  pose: CameraPose;
  sharpness: number;
}

/** Response from POST /capture. */
export interface CaptureResponse {
  id: string;
  status: ProjectStatus;
  originalName: string;
}

// ─── Viewer ──────────────────────────────────────────────────────────────────

/** Metadata the Gaussian Splat viewer needs. */
export interface ViewerMetadata {
  id: string;
  originalName: string;
  location?: GeoLocation;
  completedAt: string;
}

// ─── Orientation ─────────────────────────────────────────────────────────────

/** Normalized orientation reading from any tracking source. */
export interface OrientationAim {
  yaw: number;
  pitch: number;
  roll: number;
  timestamp: number;
}

// ─── Motion Gate ─────────────────────────────────────────────────────────────

export interface MotionGateState {
  isStable: boolean;
  linearAcceleration: number;
  angularVelocity: number;
}

// ─── Ring Buffer ─────────────────────────────────────────────────────────────

export interface BufferedFrame {
  imageData: ImageBitmap | HTMLCanvasElement;
  timestamp: number;
}
