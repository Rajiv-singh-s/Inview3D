'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Targets tile the whole sphere: a dense middle ring plus sparser upper/lower
 * rings (fewer shots are needed near the poles) plus single zenith/nadir shots.
 */
const RINGS: Array<{ pitch: number; count: number }> = [
  { pitch: 90, count: 1 },
  { pitch: 45, count: 4 },
  { pitch: 0, count: 6 },
  { pitch: -45, count: 4 },
  { pitch: -90, count: 1 },
];

export interface Target {
  yaw: number;
  pitch: number;
}

function buildTargets(): Target[] {
  const out: Target[] = [];
  for (const ring of RINGS) {
    if (ring.count === 1) {
      out.push({ yaw: 0, pitch: ring.pitch });
    } else {
      for (let i = 0; i < ring.count; i++) {
        out.push({ yaw: (360 / ring.count) * i, pitch: ring.pitch });
      }
    }
  }
  return out;
}

export const TOTAL_SHOTS = buildTargets().length;

/** How close (degrees) the reticle must be to a target to auto-capture it. */
const TOLERANCE_DEG = 6;
/** Must remain aligned for this long before auto-capture fires. */
const CAPTURE_DWELL_MS = 220;
/** Half-angles of the on-screen guidance viewport. */
const H_FOV = 52;
const V_FOV = 40;

export interface CapturedShot {
  blob: Blob;
  yaw: number;
  pitch: number;
}

/** Smallest signed angle from `a` to `b`, in (-180, 180]. */
function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Build a smooth sweep order (alternating yaw direction per ring). */
function buildCaptureOrder(targets: Target[]): number[] {
  const ringOrder = [0, 45, 90, -45, -90];
  const out: number[] = [];
  ringOrder.forEach((pitch, ringIdx) => {
    const ids = targets
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t.pitch === pitch)
      .sort((a, b) => a.t.yaw - b.t.yaw)
      .map((x) => x.i);
    if (ringIdx % 2 === 1) ids.reverse();
    out.push(...ids);
  });
  return out;
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
 * Guided spherical photo capture. The user stands still and sweeps the phone
 * across the sphere; each target is shot automatically when the reticle reaches
 * it.
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
  /** Compass heading anchored on first orientation event; target yaws are relative. */
  const baseYawRef = useRef<number | null>(null);
  /** Maps shot index -> target index, so undo can un-mark the correct target. */
  const capturedOrderRef = useRef<number[]>([]);
  /** When alignment with the current target started (for dwell capture). */
  const alignedSinceRef = useRef<number | null>(null);
  /** Ref mirror of shots.length so async callbacks always read the current value. */
  const shotsLengthRef = useRef(0);
  shotsLengthRef.current = shots.length;

  const targets = useMemo(buildTargets, []);
  const captureOrder = useMemo(() => buildCaptureOrder(targets), [targets]);

  /** Which targets have been captured, derived from capturedOrder & shots.length. */
  const taken = useMemo(() => {
    const arr = targets.map(() => false);
    capturedOrderRef.current.slice(0, shots.length).forEach((idx) => {
      if (idx >= 0 && idx < arr.length) arr[idx] = true;
    });
    return arr;
  }, [shots.length, targets]);

  const [error, setError] = useState<string | null>(null);
  const [orient, setOrient] = useState<{ yaw: number; pitch: number } | null>(null);
  const [hasCompass, setHasCompass] = useState(false);
  const [ready, setReady] = useState(false);
  /** Flash overlay when a shot is auto-captured. */
  const [flash, setFlash] = useState(false);
  const [dwellProgress, setDwellProgress] = useState(0);
  const [capturePhase, setCapturePhase] = useState<'capturing' | 'review'>('capturing');
  const [isPrivate, setIsPrivate] = useState(false);

  const count = shots.length;
  const done = taken.every(Boolean);

  // Auto transition to review when all 16 shots are captured
  useEffect(() => {
    if (count === TOTAL_SHOTS && capturePhase === 'capturing') {
      setCapturePhase('review');
    }
  }, [count, capturePhase]);

  // ---- camera ------------------------------------------------------------
  useEffect(() => {
    if (capturePhase !== 'capturing') return;
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
  }, [capturePhase]);

  // ---- orientation -------------------------------------------------------
  useEffect(() => {
    if (capturePhase !== 'capturing') return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number })
        .webkitCompassHeading;
      const yawRaw = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
      if (yawRaw == null || Number.isNaN(yawRaw) || e.beta == null) return;
      setHasCompass(true);
      const yaw = ((yawRaw % 360) + 360) % 360;
      const pitch = Math.max(-90, Math.min(90, e.beta - 90));
      setOrient({ yaw, pitch });
      if (baseYawRef.current == null) baseYawRef.current = yaw;
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, [capturePhase]);

  const triggerFlash = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  }, []);

  const takeShot = useCallback(
    (targetIndex: number) => {
      const video = videoRef.current;
      if (!video || capturingRef.current || video.videoWidth === 0) return;
      capturingRef.current = true;

      const shotIndex = shotsLengthRef.current;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            capturedOrderRef.current = [...capturedOrderRef.current.slice(0, shotIndex), targetIndex];
            onShot({ blob, yaw: orient?.yaw ?? 0, pitch: orient?.pitch ?? 0 });
            triggerFlash();
            alignedSinceRef.current = null;
            setDwellProgress(0);
          }
          setTimeout(() => (capturingRef.current = false), 400);
        },
        'image/jpeg',
        0.92,
      );
    },
    [onShot, orient, triggerFlash],
  );

  /** Manual capture (no compass): find the first untaken target and record it. */
  const takeManualShot = useCallback(() => {
    const idx = targets.findIndex((_, i) => !taken[i]);
    if (idx < 0) return;
    takeShot(idx);
  }, [targets, taken, takeShot]);

  const nextTargetIndex = useMemo(() => {
    const nextStep = captureOrder.findIndex((idx) => !taken[idx]);
    return nextStep >= 0 ? captureOrder[nextStep] : null;
  }, [captureOrder, taken]);

  /** Screen-projected positions for the current target and a few upcoming hints. */
  const { dots, current } = useMemo((): {
    dots: Array<{ index: number; x: number; y: number; dist: number; isTaken: boolean }>;
    current: { index: number; dist: number; dYaw: number; dPitch: number } | null;
  } => {
    if (!orient || baseYawRef.current == null) return { dots: [], current: null };
    const base = baseYawRef.current;

    if (nextTargetIndex == null) return { dots: [], current: null };

    const lookahead: number[] = [nextTargetIndex];
    const nextStep = captureOrder.findIndex((idx) => idx === nextTargetIndex);
    for (let k = 1; k <= 2; k++) {
      const id = captureOrder[nextStep + k];
      if (id != null && !taken[id]) lookahead.push(id);
    }

    const visible: Array<{ index: number; x: number; y: number; dist: number; isTaken: boolean }> = [];

    let currentTarget: { index: number; dist: number; dYaw: number; dPitch: number } | null = null;
    lookahead.forEach((index) => {
      const t = targets[index];
      const dYaw = angleDelta(orient.yaw, (base + t.yaw) % 360);
      const dPitch = t.pitch - orient.pitch;
      const dist = Math.hypot(dYaw * Math.cos((orient.pitch * Math.PI) / 180), dPitch);
      if (index === nextTargetIndex) currentTarget = { index, dist, dYaw, dPitch };

      if (Math.abs(dYaw) <= H_FOV && Math.abs(dPitch) <= V_FOV) {
        visible.push({
          index,
          x: 50 + (dYaw / H_FOV) * 46,
          y: 50 - (dPitch / V_FOV) * 43,
          dist,
          isTaken: taken[index],
        });
      }
    });

    return { dots: visible, current: currentTarget };
  }, [orient, targets, taken, captureOrder, nextTargetIndex]);

  // Auto-capture: fire only on the current ordered target after brief stable alignment.
  useEffect(() => {
    if (!ready || busy || done || !hasCompass || capturePhase !== 'capturing') return;
    if (!current) return;

    let animFrame: number;
    const updateProgress = () => {
      if (current.dist <= TOLERANCE_DEG) {
        const now = Date.now();
        if (alignedSinceRef.current == null) {
          alignedSinceRef.current = now;
        }
        const elapsed = now - alignedSinceRef.current;
        const progress = Math.min(1, elapsed / CAPTURE_DWELL_MS);
        setDwellProgress(progress);
        if (elapsed >= CAPTURE_DWELL_MS) {
          takeShot(current.index);
          return;
        }
        animFrame = requestAnimationFrame(updateProgress);
      } else {
        alignedSinceRef.current = null;
        setDwellProgress(0);
      }
    };

    updateProgress();
    return () => cancelAnimationFrame(animFrame);
  }, [ready, busy, done, hasCompass, current, takeShot, capturePhase]);

  // Clean object URLs for images on unmount or review phase exit
  const imageUrls = useMemo(() => {
    return shots.map((s) => URL.createObjectURL(s.blob));
  }, [shots]);

  useEffect(() => {
    return () => {
      imageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [imageUrls]);

  if (capturePhase === 'review') {
    return (
      <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-slate-950 p-4 border border-slate-800 text-white min-h-[75vh] flex flex-col justify-between">
        <div className="space-y-6 overflow-y-auto max-h-[62vh] pr-1">
          <div>
            <h2 className="text-xl font-bold">Source images ({count})</h2>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {imageUrls.map((url, idx) => (
                <div key={idx} className="relative aspect-square overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Captured ${idx}`} className="h-full w-full object-cover" />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 border-t border-slate-800 pt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Details</h3>
            
            {/* Private Toggle Switch */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">Private</p>
                <p className="text-xs text-slate-500 mt-0.5">If enabled, your asset will be hidden from the explore page.</p>
              </div>
              <button
                onClick={() => setIsPrivate(!isPrivate)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
                  isPrivate ? 'bg-green-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                    isPrivate ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Location Component */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-blue-400">📍</span>
                <span className="font-medium">Taketomi, Japan 🇯🇵</span>
              </div>
              <div className="h-24 w-full rounded-xl bg-slate-900 border border-slate-800 overflow-hidden relative flex items-center justify-center">
                <div className="absolute inset-0 bg-blue-900/10 flex flex-col items-center justify-center text-xs text-slate-500">
                  <span>Map Preview</span>
                  <span className="mt-1 text-[10px]">24.329° N, 124.088° E</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer controls */}
        <div className="border-t border-slate-800 pt-4 space-y-2">
          <button
            onClick={onFinish}
            disabled={busy}
            className="w-full rounded-xl bg-green-500 py-3 font-semibold text-white active:bg-green-600 disabled:opacity-40"
          >
            {busy ? 'Stitching...' : 'Stitch and post'}
          </button>
          <button
            onClick={() => setCapturePhase('capturing')}
            disabled={busy}
            className="w-full text-center py-2 text-sm text-slate-400 hover:text-white"
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

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

  const aligned = current != null && current.dist <= TOLERANCE_DEG;

  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-black">
      {/* Live camera feed */}
      <video ref={videoRef} playsInline muted className="h-[65vh] w-full bg-black object-cover" />

      {/* White-flash overlay on capture */}
      <div
        className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-75"
        style={{ opacity: flash ? 0.6 : 0 }}
      />

      {/* AR overlay */}
      <div className="pointer-events-none absolute inset-0">
        {/* Guide frame */}
        <div className="absolute inset-x-8 inset-y-20 rounded-sm border border-white/25" />

        {/* Current target + short lookahead only (less visual noise). */}
        {dots.map((d) => (
          <div
            key={d.index}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: d.index === nextTargetIndex ? (d.dist <= TOLERANCE_DEG ? 40 : 28) : 18,
              height: d.index === nextTargetIndex ? (d.dist <= TOLERANCE_DEG ? 40 : 28) : 18,
              backgroundColor: d.index === nextTargetIndex
                ? (d.dist <= TOLERANCE_DEG
                  ? 'rgba(34,197,94,0.3)'
                  : 'transparent')
                : 'rgba(255,255,255,0.18)',
              border: d.index === nextTargetIndex
                ? (d.dist <= TOLERANCE_DEG
                  ? '3px solid rgba(255,255,255,0.95)'
                  : '2px solid rgba(255,255,255,0.65)')
                : '1px solid rgba(255,255,255,0.35)',
              boxShadow:
                d.index === nextTargetIndex && d.dist <= TOLERANCE_DEG
                  ? '0 0 0 6px rgba(255,255,255,0.25)'
                  : 'none',
              transition: 'all 0.12s',
            }}
          />
        ))}

        {/* Centre reticle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className={`relative grid h-16 w-16 place-items-center rounded-full border-4 transition-all duration-150 ${
              aligned
                ? 'scale-110 border-white bg-green-500/20'
                : 'border-white/70 bg-transparent'
            }`}
          >
            {aligned && (
              <svg className="absolute inset-0 -rotate-90 h-full w-full p-1" viewBox="0 0 36 36">
                <path
                  className="text-green-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray={`${dwellProgress * 100}, 100`}
                  d="M18 2.0845
                    a 15.9155 15.9155 0 0 1 0 31.831
                    a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
            )}
            {!hasCompass && <span className="text-[10px] font-semibold text-white">TAP</span>}
          </div>
        </div>
      </div>

      {/* Top controls */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <button
          onClick={onUndo}
          disabled={count === 0 || busy}
          className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-900 disabled:opacity-40"
          aria-label="Undo last shot"
        >
          U
        </button>
        <button
          onClick={onCancel}
          className="grid h-9 w-9 place-items-center rounded-full bg-red-500 text-white"
          aria-label="Cancel capture"
        >
          X
        </button>
      </div>

      {/* Bottom panel */}
      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/90 to-transparent p-4 pt-6">
        <p className="text-center text-xs text-white/80 font-medium px-4">
          Shoot all photos from the same spot as your initial photo to ensure an optimal result.
        </p>

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-green-500 transition-[width] duration-300"
              style={{ width: `${(count / TOTAL_SHOTS) * 100}%` }}
            />
          </div>
          <span className="min-w-[5ch] text-right text-xs font-semibold tabular-nums text-white">
            {count} of {TOTAL_SHOTS}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          {!hasCompass && !done && (
            <button
              onClick={takeManualShot}
              disabled={busy}
              className="flex-1 rounded-xl border border-white/40 px-5 py-2.5 font-medium text-white active:bg-white/10"
            >
              Capture photo
            </button>
          )}
          <button
            onClick={() => setCapturePhase('review')}
            disabled={count < 4 || busy}
            className="flex-1 rounded-xl bg-green-500 px-5 py-2.5 font-medium text-white disabled:opacity-40"
          >
            Finish early ({count})
          </button>
        </div>
      </div>
    </div>
  );
}
