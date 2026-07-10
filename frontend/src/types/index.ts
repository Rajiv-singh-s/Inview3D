/** Shared frontend types — mirror the backend's public API shapes. */

export type ProjectStatus = 'completed' | 'failed';

export interface Project {
  id: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  originalName: string;
  faces: string[];
  error?: string;
}

/** The six cube faces, in the order the viewer expects. */
export type CubeFaceName = 'front' | 'right' | 'back' | 'left' | 'top' | 'bottom';

/** Metadata the cubemap viewer needs: which faces exist and where to load them. */
export interface ViewerMetadata {
  id: string;
  originalName: string;
  /** Faces that were captured and stored. */
  faces: CubeFaceName[];
  completedAt: string;
}

export interface CubeCaptureResponse {
  id: string;
  status: ProjectStatus;
  faceCount: number;
  originalName: string;
}
