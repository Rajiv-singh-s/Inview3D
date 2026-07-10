import type { CubeFace, CubeFaces } from './cubeFaces';

/** Smallest signed angle from `a` to `b`, in (-180, 180]. */
export function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
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

/**
 * Gentle nudge: returns a hint like "Try looking right →" based on which face
 * has the least coverage. Returns null if overall coverage is already high.
 */
export function coverageHint(cube: CubeFaces): string | null {
  const total = cube.totalCoverage();
  if (total >= 0.92) return null; // already above auto-complete threshold

  const weakest = cube.leastCoveredFace();
  const cov = cube.coverageOf(weakest);
  if (cov > 0.6) return null; // all faces have decent coverage, no nudge needed

  const hints: Record<CubeFace, string> = {
    front: 'Try facing forward',
    right: 'Try looking right →',
    back: 'Try turning around',
    left: '← Try looking left',
    top: 'Try tilting up ↑',
    bottom: 'Tilt down toward the floor ↓',
  };
  return hints[weakest];
}
