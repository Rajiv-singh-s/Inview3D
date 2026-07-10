import type { CubeFace } from './cubeFaces';

/** The direction the user is guided to aim for each face. */
export interface FaceTarget {
  face: CubeFace;
  /** Yaw relative to the capture origin (front = 0), degrees, clockwise. */
  yaw: number;
  /** Pitch from the horizon, degrees, up positive. */
  pitch: number;
  label: string;
}

/**
 * Capture order: sweep the four walls, then ceiling, then floor. The first
 * face (front) establishes the origin — wherever the user is aiming becomes
 * yaw 0, so we never depend on an absolute compass bearing.
 */
export const FACE_TARGETS: FaceTarget[] = [
  { face: 'front', yaw: 0, pitch: 0, label: 'Front wall' },
  { face: 'right', yaw: 90, pitch: 0, label: 'Right wall' },
  { face: 'back', yaw: 180, pitch: 0, label: 'Back wall' },
  { face: 'left', yaw: 270, pitch: 0, label: 'Left wall' },
  { face: 'top', yaw: 0, pitch: 75, label: 'Ceiling' },
  { face: 'bottom', yaw: 0, pitch: -75, label: 'Floor' },
];

/** Smallest signed angle from `a` to `b`, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/**
 * Angular distance (deg) between the current aim and a target. Yaw error is
 * weighted by cos(pitch) so that near the poles — where any yaw points nearly
 * straight up/down — yaw stops dominating.
 */
export function aimError(
  aim: { yaw: number; pitch: number },
  target: { yaw: number; pitch: number },
): number {
  const dYaw = angleDelta(aim.yaw, target.yaw) * Math.cos((aim.pitch * Math.PI) / 180);
  const dPitch = target.pitch - aim.pitch;
  return Math.hypot(dYaw, dPitch);
}

/** Which way to move to reach a target, or null once aligned. */
export function directionHint(
  aim: { yaw: number; pitch: number },
  target: { yaw: number; pitch: number },
  tolerance: number,
): string | null {
  if (aimError(aim, target) <= tolerance) return null;
  const dYaw = angleDelta(aim.yaw, target.yaw);
  const dPitch = target.pitch - aim.pitch;
  if (Math.abs(dYaw) >= Math.abs(dPitch)) return dYaw > 0 ? 'Turn right →' : '← Turn left';
  return dPitch > 0 ? 'Tilt up ↑' : 'Tilt down ↓';
}

/**
 * Reads a device orientation event as a simple (yaw, pitch) aim in degrees.
 * iOS exposes a true compass heading; elsewhere alpha is relative — either way
 * we only use it relative to the origin captured on the first frame.
 */
export function readAim(e: DeviceOrientationEvent): { yaw: number; pitch: number } | null {
  const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
    .webkitCompassHeading;
  const yawRaw = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
  if (yawRaw == null || Number.isNaN(yawRaw) || e.beta == null) return null;
  const yaw = ((yawRaw % 360) + 360) % 360;
  // beta is 90° when the phone is held upright; subtract to get pitch about the horizon.
  const pitch = Math.max(-90, Math.min(90, e.beta - 90));
  return { yaw, pitch };
}
