/**
 * SphereTargets.ts
 * Defines target positions for spherical capture and related mathematical helpers.
 */

export interface Target {
  id: number;
  yaw: number;
  pitch: number;
}

// 16 spherical target positions in degrees
export const TARGETS: Target[] = [
  // Ring 1: pitch 0 (Equator)
  { id: 0, yaw: 0, pitch: 0 },
  { id: 1, yaw: 45, pitch: 0 },
  { id: 2, yaw: 90, pitch: 0 },
  { id: 3, yaw: 135, pitch: 0 },
  { id: 4, yaw: 180, pitch: 0 },
  { id: 5, yaw: 225, pitch: 0 },
  { id: 6, yaw: 270, pitch: 0 },
  { id: 7, yaw: 315, pitch: 0 },
  // Ring 2: pitch 45 (Elevated)
  { id: 8, yaw: 0, pitch: 45 },
  { id: 9, yaw: 45, pitch: 45 },
  { id: 10, yaw: 90, pitch: 45 },
  { id: 11, yaw: 135, pitch: 45 },
  { id: 12, yaw: 180, pitch: 45 },
  { id: 13, yaw: 225, pitch: 45 },
  { id: 14, yaw: 270, pitch: 45 },
  { id: 15, yaw: 315, pitch: 45 },
];

/**
 * Converts spherical coordinates (degrees) to Cartesian coordinates (x, y, z).
 * Assumes a Y-up coordinate system common in Three.js.
 * @param yaw - Yaw angle in degrees
 * @param pitch - Pitch angle in degrees
 * @param radius - Distance from origin (default: 5)
 * @returns [x, y, z] coordinate array
 */
export function targetToWorldPos(yaw: number, pitch: number, radius: number = 5): [number, number, number] {
  const yawRad = yaw * (Math.PI / 180);
  const pitchRad = pitch * (Math.PI / 180);

  const x = radius * Math.cos(pitchRad) * Math.sin(yawRad);
  const y = radius * Math.sin(pitchRad);
  const z = radius * Math.cos(pitchRad) * Math.cos(yawRad);

  return [x, y, z];
}

/**
 * Calculates the smallest signed angle difference from 'a' to 'b' in degrees.
 * @param a - Starting angle in degrees
 * @param b - Target angle in degrees
 * @returns Smallest signed difference (-180 to 180)
 */
export function angleDelta(a: number, b: number): number {
  let delta = (b - a) % 360;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  return delta;
}

/**
 * Finds the nearest uncaptured target based on angular distance.
 * @param aim - Current camera aim (yaw and pitch in degrees)
 * @param capturedSet - Record of captured target IDs (true if captured)
 * @returns Nearest uncaptured target with its angular error, or null if all captured
 */
export function nearestUncaptured(
  aim: { yaw: number; pitch: number },
  capturedSet: Record<number, boolean>
): { id: number; angularError: number } | null {
  let nearest: { id: number; angularError: number } | null = null;
  let minError = Infinity;

  for (const target of TARGETS) {
    if (capturedSet[target.id]) continue;

    const dy = angleDelta(aim.yaw, target.yaw);
    const dp = angleDelta(aim.pitch, target.pitch);
    const error = Math.sqrt(dy * dy + dp * dp);

    if (error < minError) {
      minError = error;
      nearest = { id: target.id, angularError: error };
    }
  }

  return nearest;
}
