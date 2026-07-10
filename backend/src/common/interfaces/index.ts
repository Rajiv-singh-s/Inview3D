/**
 * Shared domain types for the InView3D backend.
 *
 * A project is a room cube: six face images captured live in the browser and
 * uploaded here for storage. There is no server-side reconstruction — the cube
 * is assembled on the client during capture, so the backend only persists and
 * serves the finished faces.
 *
 * State lives in memory and is mirrored to a `project.json` file per project.
 * No database (by design). Interfaces are framework-agnostic so a persistence
 * layer can be added later without touching call sites.
 */

/** High-level lifecycle of a project. */
export type ProjectStatus = 'completed' | 'failed';

/** The six cube faces, in a fixed order. */
export const CUBE_FACES = ['front', 'right', 'back', 'left', 'top', 'bottom'] as const;
export type CubeFaceName = (typeof CUBE_FACES)[number];

/** The full record persisted per project. */
export interface Project {
  id: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;

  /** Human-readable capture name. */
  originalName: string;

  /** Faces that were captured and stored, relative to `<outputPath>/<id>/cube`. */
  faces: CubeFaceName[];

  /** Populated when status === 'failed'. */
  error?: string;
}
