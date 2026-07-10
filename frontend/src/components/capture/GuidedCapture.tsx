'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface Target {
  face: string;
  yaw: number;
  pitch: number;
}

function buildCubemapTargets(): Target[] {
  return [
    // FRONT
    { face: 'front', yaw: 0, pitch: 0 },
    { face: 'front', yaw: -20, pitch: 0 },
    { face: 'front', yaw: 20, pitch: 0 },
    
    // RIGHT
    { face: 'right', yaw: 90, pitch: 0 },
    { face: 'right', yaw: 70, pitch: 0 },
    { face: 'right', yaw: 110, pitch: 0 },
    
    // BACK
    { face: 'back', yaw: 180, pitch: 0 },
    { face: 'back', yaw: 160, pitch: 0 },
    { face: 'back', yaw: -160, pitch: 0 },
    
    // LEFT
    { face: 'left', yaw: -90, pitch: 0 },
    { face: 'left', yaw: -110, pitch: 0 },
    { face: 'left', yaw: -70, pitch: 0 },
    
    // TOP
    { face: 'top', yaw: 0, pitch: 90 },
    { face: 'top', yaw: 0, pitch: 70 },
    { face: 'top', yaw: 180, pitch: 70 },
    
    // BOTTOM
    { face: 'bottom', yaw: 0, pitch: -90 },
    { face: 'bottom', yaw: 0, pitch: -70 },
    { face: 'bottom', yaw: 180, pitch: -70 },
  ];
}

export const TOTAL_SHOTS = 18;

const TOLERANCE_DEG = 8;
const CAPTURE_DWELL_MS = 300;
const MAX_DOT_BEARING_DEG = 120;
const MIN_SHARPNESS = 10;
const MAX_ROTATION_DEG_PER_SEC = 25;
const DOT_RADIUS_X = 42;
const DOT_RADIUS_Y = 30;

export interface CapturedShot {
  blob: Blob;
  face: string;
  yaw: number;
  pitch: number;
}

function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

function sharpness(video: HTMLVideoElement): number {
  const W = 160;
  const H = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return Number.POSITIVE_INFINITY; 
  ctx.drawImage(video, 0, 0, W, H);
  const { data } = ctx.getImageData(0, 0, W, H);

  const gray = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - W] - gray[i + W];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

interface GuidedCaptureProps {
  shots: CapturedShot[];
  onShot: (shot: CapturedShot) => void;
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
  busy?: boolean;
}

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
  
  // Positional Tracking via WebXR / DeviceMotion
  const [originSet, setOriginSet] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  
  const baseYawRef = useRef<number | null>(null);
  const capturedOrderRef = useRef<number[]>([]);
  const alignedSinceRef = useRef<number | null>(null);
  const shotsLengthRef = useRef(0);
  shotsLengthRef.current = shots.length;

  const targets = useMemo(buildCubemapTargets, []);
  
  // Capture faces sequentially or let user chase closest?
  // We'll let them chase the closest untaken target.
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
  const [flash, setFlash] = useState(false);
  const [dwellProgress, setDwellProgress] = useState(0);
  const [rejected, setRejected] = useState<string | null>(null);
  
  const rotSpeedRef = useRef(0);
  const prevOrientRef = useRef<{ yaw: number; pitch: number; t: number } | null>(null);
  const [capturePhase, setCapturePhase] = useState<'origin' | 'capturing' | 'review'>('origin');
  const [isPrivate, setIsPrivate] = useState(false);

  const count = shots.length;
  const done = taken.every(Boolean);

  useEffect(() => {
    if (count === TOTAL_SHOTS && capturePhase === 'capturing') {
      setCapturePhase('review');
    }
  }, [count, capturePhase]);

  // ---- Camera Initialization ----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let stream: MediaStream;
        try {
          // Attempt wide-angle / focus lock
          stream = await navigator.mediaDevices.getUserMedia({
            video: { 
              facingMode: { ideal: 'environment' }, 
              width: { ideal: 1920 },
              // @ts-ignore - experimental constraints
              focusMode: 'continuous',
              zoom: { ideal: 0.5 } 
            } as any,
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
            audio: false,
          });
        }
        
        // Attempt to lock focus/exposure if track supports it
        const track = stream.getVideoTracks()[0];
        try {
           const capabilities = track.getCapabilities() as any;
           const constraints: any = { advanced: [{}] };
           if (capabilities.focusMode?.includes('single-shot')) constraints.advanced[0].focusMode = 'single-shot';
           if (capabilities.exposureMode?.includes('manual')) constraints.advanced[0].exposureMode = 'manual';
           if (Object.keys(constraints.advanced[0]).length > 0) {
             await track.applyConstraints(constraints);
           }
        } catch (e) {
           // Ignore unsupported constraints
        }

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
        setError(`Could not access the camera: ${(err as Error).message}.`);
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---- Orientation Tracking ----------------------------------------------
  useEffect(() => {
    if (capturePhase !== 'capturing' && capturePhase !== 'origin') return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const yawRaw = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
      if (yawRaw == null || Number.isNaN(yawRaw) || e.beta == null) return;
      
      setHasCompass(true);
      const yaw = ((yawRaw % 360) + 360) % 360;
      const pitch = Math.max(-90, Math.min(90, e.beta - 90));

      const now = performance.now();
      const prev = prevOrientRef.current;
      if (prev) {
        const dt = (now - prev.t) / 1000;
        if (dt > 0.01) {
          const moved = Math.hypot(angleDelta(prev.yaw, yaw), pitch - prev.pitch);
          rotSpeedRef.current = 0.6 * rotSpeedRef.current + 0.4 * (moved / dt);
          prevOrientRef.current = { yaw, pitch, t: now };
        }
      } else {
        prevOrientRef.current = { yaw, pitch, t: now };
      }

      setOrient({ yaw, pitch });
    };
    
    // Simulate Positional drift warning
    const onMotion = (e: DeviceMotionEvent) => {
       if (!originSet) return;
       // We can't robustly integrate acc to position without heavy drift.
       // For this demo, we'll just check if acceleration is too high, indicating walking.
       if (e.acceleration) {
         const acc = Math.hypot(e.acceleration.x || 0, e.acceleration.y || 0, e.acceleration.z || 0);
         if (acc > 3.0) { // arbitrary threshold for walking vs rotating
           setPosError('Move back to the capture position');
         } else if (posError) {
           // gradually clear it?
           setTimeout(() => setPosError(null), 2000);
         }
       }
    };
    
    window.addEventListener('deviceorientation', onOrientation, true);
    window.addEventListener('devicemotion', onMotion, true);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation, true);
      window.removeEventListener('devicemotion', onMotion, true);
    };
  }, [capturePhase, originSet, posError]);

  const setCaptureOrigin = useCallback(() => {
     if (orient) {
        baseYawRef.current = orient.yaw;
        setOriginSet(true);
        setCapturePhase('capturing');
     }
  }, [orient]);

  const triggerFlash = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
  }, []);

  const takeShot = useCallback(
    (targetIndex: number) => {
      const video = videoRef.current;
      if (!video || capturingRef.current || video.videoWidth === 0 || posError) return;

      const sharp = sharpness(video);
      if (sharp < MIN_SHARPNESS) {
        setRejected('Hold steady — blurry frame');
        alignedSinceRef.current = null;
        setDwellProgress(0);
        return;
      }
      setRejected(null);
      capturingRef.current = true;

      const shotIndex = shotsLengthRef.current;
      const target = targets[targetIndex];

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            capturedOrderRef.current = [...capturedOrderRef.current.slice(0, shotIndex), targetIndex];
            onShot({ blob, face: target.face, yaw: orient?.yaw ?? 0, pitch: orient?.pitch ?? 0 });
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
    [onShot, orient, triggerFlash, posError, targets],
  );

  const takeManualShot = useCallback(() => {
    const idx = targets.findIndex((_, i) => !taken[i]);
    if (idx < 0) return;
    takeShot(idx);
  }, [targets, taken, takeShot]);

  // Find the closest untaken target
  const nextTargetIndex = useMemo(() => {
    if (!orient || baseYawRef.current == null) return null;
    let closestIdx = -1;
    let minD = Infinity;
    const base = baseYawRef.current;
    
    targets.forEach((t, i) => {
      if (taken[i]) return;
      const dYaw = angleDelta(orient.yaw, (base + t.yaw) % 360);
      const dPitch = t.pitch - orient.pitch;
      const dist = Math.hypot(dYaw, dPitch);
      if (dist < minD) {
        minD = dist;
        closestIdx = i;
      }
    });
    return closestIdx >= 0 ? closestIdx : null;
  }, [orient, targets, taken]);

  const { dots, current } = useMemo((): {
    dots: Array<{ index: number; x: number; y: number; dist: number; isTaken: boolean }>;
    current: { index: number; dist: number; dYaw: number; dPitch: number } | null;
  } => {
    if (!orient || baseYawRef.current == null) return { dots: [], current: null };
    const base = baseYawRef.current;

    let currentTarget: { index: number; dist: number; dYaw: number; dPitch: number } | null = null;
    const byAnchor = new Map<number, { index: number; dist: number; isTaken: boolean }>();

    targets.forEach((t, index) => {
      const dYaw = angleDelta(orient.yaw, (base + t.yaw) % 360);
      const dPitch = t.pitch - orient.pitch;
      const dist = Math.hypot(dYaw * Math.cos((orient.pitch * Math.PI) / 180), dPitch);

      if (index === nextTargetIndex) currentTarget = { index, dist, dYaw, dPitch };

      if (dist <= TOLERANCE_DEG) return;
      if (dist > MAX_DOT_BEARING_DEG) return;

      const bearing = Math.atan2(dPitch, dYaw);
      const anchor = ((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8;

      const existing = byAnchor.get(anchor);
      if (!existing || dist < existing.dist) {
        byAnchor.set(anchor, { index, dist, isTaken: taken[index] });
      }
    });

    const visible = [...byAnchor.entries()].map(([anchor, v]) => {
      const a = (anchor * Math.PI) / 4;
      return {
        index: v.index,
        x: 50 + Math.cos(a) * DOT_RADIUS_X,
        y: 50 - Math.sin(a) * DOT_RADIUS_Y,
        dist: v.dist,
        isTaken: v.isTaken,
      };
    });

    return { dots: visible, current: currentTarget };
  }, [orient, targets, taken, nextTargetIndex]);

  useEffect(() => {
    if (!ready || busy || done || !hasCompass || capturePhase !== 'capturing' || posError) return;
    if (!current) return;

    let animFrame: number;
    const updateProgress = () => {
      if (rotSpeedRef.current > MAX_ROTATION_DEG_PER_SEC) {
        alignedSinceRef.current = null;
        setDwellProgress(0);
        setRejected('Slow down');
        animFrame = requestAnimationFrame(updateProgress);
        return;
      }
      setRejected((r) => (r === 'Slow down' ? null : r));

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
  }, [ready, busy, done, hasCompass, current, takeShot, capturePhase, posError]);

  const imageUrls = useMemo(() => shots.map((s) => URL.createObjectURL(s.blob)), [shots]);

  useEffect(() => {
    return () => imageUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [imageUrls]);

  // ========================================================================
  //  ERROR STATE
  // ========================================================================
  if (error) {
    return (
      <div className="card border-red-500/40 bg-red-500/5 p-6">
        <p className="font-medium text-red-300">Camera unavailable</p>
        <p className="mt-1 text-sm text-red-200/80">{error}</p>
        <button onClick={onCancel} className="btn-ghost mt-4">Back</button>
      </div>
    );
  }

  // ========================================================================
  //  ORIGIN PHASE
  // ========================================================================
  if (capturePhase === 'origin') {
    return (
      <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} playsInline muted className="h-[85vh] w-full bg-black object-cover" />
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] p-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-4">Set Capture Origin</h2>
          <p className="text-white/80 mb-8">
            Stand in the center of the room where you want to capture the cubemap. 
            Do not walk around during the capture.
          </p>
          <div className="border-2 border-dashed border-white/50 w-48 h-48 rounded-full flex items-center justify-center mb-8">
            <div className="w-2 h-2 bg-white rounded-full" />
          </div>
          <button 
            onClick={setCaptureOrigin}
            disabled={!hasCompass}
            className="w-full rounded-xl bg-green-500 py-3 font-semibold text-white disabled:opacity-40"
          >
            {hasCompass ? 'Set Origin & Start' : 'Waiting for sensors...'}
          </button>
        </div>
        <button onClick={onCancel} className="absolute top-4 right-4 text-white p-2">✕</button>
      </div>
    );
  }

  // ========================================================================
  //  REVIEW PHASE
  // ========================================================================
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
        </div>

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

  // ========================================================================
  //  CAPTURE PHASE
  // ========================================================================
  const aligned = current != null && current.dist <= TOLERANCE_DEG;

  const directionHint = ((): string | null => {
    if (current == null || aligned) return null;
    const { dYaw, dPitch } = current;
    if (Math.abs(dYaw) >= Math.abs(dPitch)) return dYaw > 0 ? 'Turn right →' : '← Turn left';
    return dPitch > 0 ? 'Tilt up ↑' : 'Tilt down ↓';
  })();

  return (
    <div className="relative mx-auto w-full max-w-md overflow-hidden rounded-2xl bg-black">
      <video ref={videoRef} playsInline muted className="h-[85vh] w-full bg-black object-cover" />

      <div
        className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-75"
        style={{ opacity: flash ? 0.6 : 0 }}
      />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-8 inset-y-20 rounded-sm border border-white/20" />

        {dots.map((d) => {
          const isNext = d.index === nextTargetIndex;
          const isAligned = isNext && d.dist <= TOLERANCE_DEG;
          const size = isNext ? (isAligned ? 38 : 26) : 20;

          return (
            <div
              key={d.index}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${d.x}%`,
                top: `${d.y}%`,
                width: size,
                height: size,
                backgroundColor: d.isTaken
                  ? 'rgba(34,197,94,0.95)' // green
                  : isNext
                    ? 'rgba(255,255,255,0.95)' // bright white
                    : 'rgba(255,255,255,0.6)', // dim white
                border: d.isTaken
                  ? '2px solid rgba(34,197,94,1)'
                  : isAligned
                    ? '3px solid rgba(34,197,94,0.95)'
                    : 'none',
                boxShadow: isAligned
                  ? '0 0 12px rgba(255,255,255,0.7), 0 0 0 4px rgba(34,197,94,0.35)'
                  : 'none',
                transition: 'all 0.15s ease-out',
              }}
            />
          );
        })}

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div
            className={`relative grid h-16 w-16 place-items-center rounded-full border-[3px] transition-all duration-150 ${
              aligned
                ? 'scale-110 border-white bg-green-500/20'
                : 'border-white/60 bg-transparent'
            }`}
          >
            {aligned && (
              <svg className="absolute inset-0 -rotate-90 h-full w-full p-0.5" viewBox="0 0 36 36">
                <path
                  className="text-green-400"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeDasharray={`${dwellProgress * 100}, 100`}
                  d="M18 2.0845
                    a 15.9155 15.9155 0 0 1 0 31.831
                    a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
            )}
            <div className={`h-3 w-3 rounded-full transition-colors ${aligned ? 'bg-green-400' : 'bg-white/50'}`} />
            {!hasCompass && <span className="absolute text-[10px] font-semibold text-white">TAP</span>}
          </div>
        </div>

        {hasCompass && (posError || rejected || directionHint) && (
          <div
            className={`absolute left-1/2 top-[63%] w-[90%] text-center -translate-x-1/2 rounded-full px-4 py-1.5 text-sm font-semibold text-white backdrop-blur-sm ${
              posError || rejected ? 'bg-amber-600/80' : 'bg-black/55'
            }`}
          >
            {posError ?? rejected ?? directionHint}
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <button
          onClick={onUndo}
          disabled={count === 0 || busy}
          className="grid h-9 w-9 place-items-center rounded-full bg-white/15 backdrop-blur-sm text-white disabled:opacity-30"
          aria-label="Undo last shot"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
        </button>
        <button
          onClick={onCancel}
          className="grid h-9 w-9 place-items-center rounded-full bg-red-500/80 backdrop-blur-sm text-white"
          aria-label="Cancel capture"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/90 to-transparent p-4 pt-8">
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-green-500 transition-[width] duration-300"
              style={{ width: `${(count / TOTAL_SHOTS) * 100}%` }}
            />
          </div>
          <span className="min-w-[5ch] text-right text-xs font-semibold tabular-nums text-white">
            {count} of {TOTAL_SHOTS}
          </span>
        </div>

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
