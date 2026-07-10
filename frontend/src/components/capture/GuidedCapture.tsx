'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Number of shots around a full 360° rotation. */
export const TOTAL_SHOTS = 16;
/** Degrees between consecutive shots. */
const STEP_DEG = 360 / TOTAL_SHOTS;
/** How close to the target heading you must be before the shot is taken. */
const TOLERANCE_DEG = 7;

export interface CapturedShot {
  blob: Blob;
  /** Compass heading at which this shot was taken, for debugging/ordering. */
  heading: number;
}

/** Smallest signed angle from `a` to `b`, in (-180, 180]. */
function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

interface GuidedCaptureProps {
  shots: CapturedShot[];
  onShot: (shot: CapturedShot) => void;
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * Guided 360° photo capture: the user stands still and rotates, and a shot is
 * taken automatically each time they reach the next target heading. Capture
 * order is preserved, which is what the stitcher relies on.
 *
 * Device orientation drives the guidance where available (mobile). On devices
 * without a compass we fall back to manual capture, since evenly-spaced shots
 * are a nicety, not a hard requirement for stitching.
 */
export function GuidedCapture({
  shots,
  onShot,
  onUndo,
  onFinish,
  onCancel,
  busy,
}: GuidedCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  /** Heading of the first shot; all targets are measured from it. */
  const baseHeadingRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [hasCompass, setHasCompass] = useState(false);
  const [ready, setReady] = useState(false);

  const index = shots.length;
  const done = index >= TOTAL_SHOTS;

  // ---- camera ------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setReady(true);
      } catch (err) {
        setError(
          `Could not access the camera: ${(err as Error).message}. ` +
            'Camera access requires HTTPS and permission.',
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---- compass -----------------------------------------------------------
  useEffect(() => {
    const onOrientation = (e: DeviceOrientationEvent) => {
      // iOS exposes a true compass heading; elsewhere alpha is relative.
      const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;
      const h = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
      if (h == null || Number.isNaN(h)) return;
      setHasCompass(true);
      setHeading(((h % 360) + 360) % 360);
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, []);

  const takeShot = useCallback(() => {
    const video = videoRef.current;
    if (!video || capturingRef.current || video.videoWidth === 0) return;
    capturingRef.current = true;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const h = heading ?? 0;
          if (baseHeadingRef.current == null) baseHeadingRef.current = h;
          onShot({ blob, heading: h });
        }
        // Brief cooldown so one alignment does not fire several shots.
        setTimeout(() => (capturingRef.current = false), 600);
      },
      'image/jpeg',
      0.92,
    );
  }, [heading, onShot]);

  // Target heading for the next shot, relative to the first one.
  const targetHeading =
    baseHeadingRef.current == null ? heading : (baseHeadingRef.current + index * STEP_DEG) % 360;

  const delta = heading != null && targetHeading != null ? angleDelta(heading, targetHeading) : null;
  const aligned = delta != null && Math.abs(delta) <= TOLERANCE_DEG;

  // Auto-capture once aligned with the next target.
  useEffect(() => {
    if (!ready || done || busy || !hasCompass) return;
    if (index === 0 || aligned) takeShot();
  }, [ready, done, busy, hasCompass, aligned, index, takeShot]);

  if (error) {
    return (
      <div className="card border-red-500/40 bg-red-500/5 p-6">
        <p className="font-medium text-red-300">Camera unavailable</p>
        <p className="mt-1 text-sm text-red-200/80">{error}</p>
        <button onClick={onCancel} className="btn-ghost mt-4">
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoRef}
        playsInline
        muted
        className="h-[70vh] w-full bg-black object-cover"
      />

      {/* Framing guide */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-8 inset-y-24 rounded-sm border border-white/40" />

        {/* Alignment reticle: fills green as you approach the target heading. */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className={`grid h-20 w-20 place-items-center rounded-full border-4 transition-colors ${
              aligned ? 'border-white bg-green-500' : 'border-white/80 bg-transparent'
            }`}
          >
            {!hasCompass && <span className="text-[10px] text-white/80">TAP</span>}
          </div>
        </div>

        {/* Direction hint */}
        {hasCompass && delta != null && !aligned && (
          <div className="absolute left-1/2 top-[62%] -translate-x-1/2 text-sm font-medium text-white/90">
            Turn {delta > 0 ? 'right →' : '← left'}
          </div>
        )}
      </div>

      {/* Top controls */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <button
          onClick={onUndo}
          disabled={index === 0 || busy}
          className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-900 disabled:opacity-40"
          aria-label="Undo last shot"
        >
          ↺
        </button>
        <button
          onClick={onCancel}
          className="grid h-9 w-9 place-items-center rounded-full bg-red-500 text-white"
          aria-label="Cancel capture"
        >
          ✕
        </button>
      </div>

      {/* Bottom bar: progress + counter + actions */}
      <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/80 to-transparent p-4">
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              className="h-full rounded-full bg-green-500 transition-[width]"
              style={{ width: `${(index / TOTAL_SHOTS) * 100}%` }}
            />
          </div>
          <span className="text-sm font-medium tabular-nums text-white">
            {index} of {TOTAL_SHOTS}
          </span>
        </div>

        <div className="flex gap-3">
          {!hasCompass && !done && (
            <button onClick={takeShot} disabled={busy} className="btn-ghost flex-1 !text-white">
              Capture photo
            </button>
          )}
          <button
            onClick={onFinish}
            disabled={index < 4 || busy}
            className="flex-1 rounded-xl bg-green-500 px-5 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {busy ? 'Uploading…' : done ? 'Finish' : `Finish (${index})`}
          </button>
        </div>
        {!hasCompass && (
          <p className="text-center text-[11px] text-white/70">
            No compass detected — rotate a little between each shot, keeping ~50% overlap.
          </p>
        )}
      </div>
    </div>
  );
}
