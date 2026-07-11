'use client';

import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { CubeScene, LookRef, TargetPoint3D } from './CubeScene';
import { angleDelta, readAim } from './orientation';

// ---- Tuning Constants -----------------------------------------------------

const MAX_ROTATION_DEG_PER_SEC = 25;
const TOLERANCE_DEG = 12; // Snap radius to dots
const DWELL_MS = 500; // Hold aligned to capture

// 16 spherical targets [yaw, pitch] covering a sphere
const PHOTO_TARGETS = [
  // Horizon ring (8 targets)
  { id: 0, yaw: 0, pitch: 0 },
  { id: 1, yaw: 45, pitch: 0 },
  { id: 2, yaw: 90, pitch: 0 },
  { id: 3, yaw: 135, pitch: 0 },
  { id: 4, yaw: 180, pitch: 0 },
  { id: 5, yaw: 225, pitch: 0 },
  { id: 6, yaw: 270, pitch: 0 },
  { id: 7, yaw: 315, pitch: 0 },
  // Upper ring (4 targets)
  { id: 8, yaw: 0, pitch: 45 },
  { id: 9, yaw: 90, pitch: 45 },
  { id: 10, yaw: 180, pitch: 45 },
  { id: 11, yaw: 270, pitch: 45 },
  // Lower ring (4 targets)
  { id: 12, yaw: 0, pitch: -45 },
  { id: 13, yaw: 90, pitch: -45 },
  { id: 14, yaw: 180, pitch: -45 },
  { id: 15, yaw: 270, pitch: -45 },
];

function targetToPosition(yaw: number, pitch: number, radius = 5): [number, number, number] {
  const yRad = (yaw * Math.PI) / 180;
  const pRad = (pitch * Math.PI) / 180;
  const x = radius * Math.cos(pRad) * Math.sin(yRad);
  const y = radius * Math.sin(pRad);
  const z = -radius * Math.cos(pRad) * Math.cos(yRad);
  return [x, y, z];
}

function playSnapSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    // AudioContext blocked or unsupported
  }
}

interface CubeCaptureProps {
  onComplete: (projectId: string) => void;
  onCancel: () => void;
}

export function CubeCapture({ onComplete, onCancel }: CubeCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const look = useRef<LookRef>({ yaw: 0, pitch: 0 });

  // Orientation refs
  const baseYawRef = useRef<number | null>(null);
  const aimRef = useRef({ yaw: 0, pitch: 0 });
  const rotSpeedRef = useRef(0);
  const prevAimRef = useRef<{ yaw: number; pitch: number; t: number } | null>(null);

  // Capture state
  const [capturedMap, setCapturedMap] = useState<Record<number, boolean>>({});
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const photosRef = useRef<Blob[]>([]);
  
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCompass, setHasCompass] = useState(false);
  const [flash, setFlash] = useState(false);
  const [dwell, setDwell] = useState(0);
  const [reason, setReason] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);

  const dwellStartRef = useRef<number | null>(null);
  const capturingRef = useRef(false);

  // Live mirrors so the rAF loop reads the current values without re-subscribing.
  const capturedRef = useRef<Record<number, boolean>>({});
  useEffect(() => {
    capturedRef.current = capturedMap;
  }, [capturedMap]);

  // The target currently nearest the aim; recomputed every frame in the loop.
  const [closestId, setClosestId] = useState<number>(-1);
  const closestIdRef = useRef(-1);

  const capturedCount = Object.values(capturedMap).filter(Boolean).length;
  const isCaptureComplete = capturedCount >= PHOTO_TARGETS.length;

  /** Nearest not-yet-captured target to the current aim (live). */
  const nearestUncaptured = useCallback((): { id: number; err: number } | null => {
    let bestId = -1;
    let bestErr = Infinity;
    for (const t of PHOTO_TARGETS) {
      if (capturedRef.current[t.id]) continue;
      const dYaw = angleDelta(aimRef.current.yaw, t.yaw);
      const dPitch = t.pitch - aimRef.current.pitch;
      const err = Math.hypot(dYaw, dPitch);
      if (err < bestErr) {
        bestErr = err;
        bestId = t.id;
      }
    }
    return bestId >= 0 ? { id: bestId, err: bestErr } : null;
  }, []);

  // 3D target dots. `isClosest` is driven by the live `closestId` (updated each
  // frame in the loop), so the highlight follows the aim instead of freezing.
  const targets = useMemo(
    (): TargetPoint3D[] =>
      PHOTO_TARGETS.map((t) => ({
        id: t.id,
        pos: targetToPosition(t.yaw, t.pitch),
        captured: !!capturedMap[t.id],
        isClosest: t.id === closestId,
      })),
    [capturedMap, closestId],
  );

  // ---- camera --------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
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
        setError(
          `Could not access the camera: ${(err as Error).message}. Camera access requires HTTPS and permission.`,
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ---- device orientation driving camera steering ---------------------------
  useEffect(() => {
    const onOrientation = (e: DeviceOrientationEvent) => {
      const raw = readAim(e);
      if (!raw) return;
      setHasCompass(true);
      if (baseYawRef.current == null) baseYawRef.current = raw.yaw;

      const yaw = ((raw.yaw - baseYawRef.current) % 360 + 360) % 360;
      const aim = { yaw, pitch: raw.pitch };

      const now = performance.now();
      const prev = prevAimRef.current;
      if (prev) {
        const dt = (now - prev.t) / 1000;
        if (dt > 0.01) {
          const moved = Math.hypot(
            ((((yaw - prev.yaw) % 360) + 540) % 360) - 180,
            aim.pitch - prev.pitch,
          );
          rotSpeedRef.current = 0.6 * rotSpeedRef.current + 0.4 * (moved / dt);
          prevAimRef.current = { yaw, pitch: aim.pitch, t: now };
        }
      } else {
        prevAimRef.current = { yaw, pitch: aim.pitch, t: now };
      }

      aimRef.current = aim;
      look.current = aim;
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, []);

  // ---- snap a photo --------------------------------------------------------
  const snapPhoto = useCallback((targetId: number) => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || capturingRef.current) return;
    
    capturingRef.current = true;
    
    const cap = document.createElement('canvas');
    cap.width = video.videoWidth;
    cap.height = video.videoHeight;
    const ctx = cap.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    
    // Save image blob for upload
    cap.toBlob((blob) => {
      if (blob) {
        photosRef.current[targetId] = blob;
        
        // Save thumbnail for summary screen
        const thumbUrl = cap.toDataURL('image/jpeg', 0.5);
        setCapturedImages((prev) => {
          const next = [...prev];
          next[targetId] = thumbUrl;
          return next;
        });

        // Mark target captured
        setCapturedMap((prev) => ({ ...prev, [targetId]: true }));
        playSnapSound();
        
        // Trigger visual flash
        setFlash(true);
        setTimeout(() => setFlash(false), 100);
      }
      capturingRef.current = false;
    }, 'image/jpeg', 0.92);
  }, []);

  // ---- auto capture logic loop ---------------------------------------------
  useEffect(() => {
    if (!ready || !hasCompass || isCaptureComplete || showSummary) return;

    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const rotSpeed = rotSpeedRef.current;

      // Recompute the nearest uncaptured target LIVE, from the current aim.
      const active = nearestUncaptured();

      // Keep the on-screen highlight in sync (cheap: only on change).
      const newClosest = active ? active.id : -1;
      if (newClosest !== closestIdRef.current) {
        closestIdRef.current = newClosest;
        setClosestId(newClosest);
      }

      if (active) {
        if (rotSpeed > MAX_ROTATION_DEG_PER_SEC) {
          setReason('Slow down…');
          dwellStartRef.current = null;
          setDwell(0);
        } else if (active.err <= TOLERANCE_DEG) {
          setReason(null);
          if (dwellStartRef.current == null) dwellStartRef.current = now;
          const elapsed = now - dwellStartRef.current;
          setDwell(Math.min(1, elapsed / DWELL_MS));

          if (elapsed >= DWELL_MS && !capturingRef.current) {
            snapPhoto(active.id);
            dwellStartRef.current = null;
            setDwell(0);
          }
        } else {
          setReason(null);
          dwellStartRef.current = null;
          setDwell(0);
        }
      } else {
        setReason(null);
        setDwell(0);
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, hasCompass, isCaptureComplete, showSummary, snapPhoto, nearestUncaptured]);

  // ---- drag to look (no-compass fallback) ----------------------------------
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const onPointerDown = (e: React.PointerEvent) => {
    if (hasCompass) return;
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (hasCompass || !dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    look.current.yaw = (look.current.yaw - dx * 0.3 + 360) % 360;
    look.current.pitch = Math.max(-89, Math.min(89, look.current.pitch + dy * 0.3));
    aimRef.current = look.current;
  };
  const endDrag = () => (dragging.current = false);

  const finalize = async () => {
    setUploading(true);
    try {
      const photosArray = PHOTO_TARGETS.map((t) => photosRef.current[t.id]).filter(Boolean);
      const res = await api.uploadPhotos(photosArray, `Splat Room ${new Date().toLocaleString()}`);
      onComplete(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
      setUploading(false);
    }
  };

  if (error) {
    return (
      <div className="card border-red-500/40 bg-red-500/5 p-6">
        <p className="font-medium text-red-300">Capture unavailable</p>
        <p className="mt-1 text-sm text-red-200/80">{error}</p>
        <button onClick={onCancel} className="btn-ghost mt-4">
          Back
        </button>
      </div>
    );
  }

  // --- RENDERING SUMMARY SCREEN ---
  if (showSummary) {
    return (
      <div className="relative mx-auto flex h-[78vh] w-full max-w-md flex-col justify-between overflow-y-auto rounded-2xl border border-slate-800 bg-[#0f1115] p-5 text-white">
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-center text-green-400">Capture Complete!</h2>
          <p className="text-sm text-center text-slate-400">
            Verify your 16 source images before uploading for 3D Gaussian Splatting reconstruction.
          </p>
          
          <div className="grid grid-cols-4 gap-2 py-3">
            {PHOTO_TARGETS.map((t) => (
              <div key={t.id} className="relative aspect-square overflow-hidden rounded-lg bg-slate-900 border border-slate-800">
                {capturedImages[t.id] ? (
                  <img src={capturedImages[t.id]} alt={`Captured ${t.id}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-slate-700">Empty</div>
                )}
                <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[9px] text-slate-300">#{t.id + 1}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3 pt-4">
          <button
            onClick={finalize}
            disabled={uploading}
            className="w-full rounded-xl bg-green-500 py-3 font-semibold text-white hover:bg-green-600 disabled:opacity-40"
          >
            {uploading ? 'Processing 3D World (takes ~3m)...' : 'Stitch and post'}
          </button>
          <button
            onClick={() => setShowSummary(false)}
            disabled={uploading}
            className="w-full rounded-xl border border-slate-700 py-3 font-medium text-slate-300 hover:bg-slate-900"
          >
            Back to Capture
          </button>
        </div>
      </div>
    );
  }

  // --- RENDERING CAPTURE SCREEN ---
  return (
    <div
      className="relative mx-auto h-[78vh] w-full max-w-md touch-none select-none overflow-hidden rounded-2xl border border-slate-800 bg-black"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      {/* Full screen video preview */}
      <div className="absolute inset-0 z-0 h-full w-full">
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover opacity-80" />
      </div>

      {/* R3F Canvas showing the floating target dots in space */}
      <div className="absolute inset-0 z-10 h-full w-full">
        <Canvas camera={{ fov: 70, position: [0, 0, 0], near: 0.1, far: 100 }} dpr={[1, 2]} style={{ background: 'transparent' }}>
          <CubeScene targets={targets} look={look} />
        </Canvas>
      </div>

      {/* Target Reticle (HTML Overlay on center) */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
        <div
          className={`relative grid place-items-center rounded-full border-4 transition-all duration-100 ${
            dwell > 0 ? 'scale-105 border-blue-400' : 'border-white/50'
          }`}
          style={{ width: 90, height: 90 }}
        >
          {/* Central dot */}
          <div className={`h-3 w-3 rounded-full ${dwell > 0 ? 'bg-blue-400' : 'bg-white/80'}`} />
          
          {/* Progress Ring */}
          {dwell > 0 && (
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
              <path
                fill="none"
                stroke="#60a5fa"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={`${dwell * 100}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Visual Flash effect */}
      <div
        className="pointer-events-none absolute inset-0 z-30 bg-white transition-opacity duration-100"
        style={{ opacity: flash ? 0.6 : 0 }}
      />

      {/* Top HUD: cancel + photos count */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
        <button
          onClick={onCancel}
          className="grid h-9 w-9 place-items-center rounded-full bg-red-500/80 text-white backdrop-blur hover:bg-red-600"
          aria-label="Cancel"
        >
          ✕
        </button>
        <span className="rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white backdrop-blur-sm">
          {capturedCount} of {PHOTO_TARGETS.length} photos
        </span>
      </div>

      {/* Bottom HUD: Guidance + actions */}
      <div className="absolute inset-x-0 bottom-0 z-20 space-y-3 bg-gradient-to-t from-black/90 to-transparent p-4 text-white">
        <p className="text-center text-sm font-medium tracking-wide">
          {reason ?? (isCaptureComplete ? 'All targets shot!' : 'Aim at the floating dots')}
        </p>

        {/* Progress Bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-green-500 transition-[width] duration-300"
            style={{ width: `${(capturedCount / PHOTO_TARGETS.length) * 100}%` }}
          />
        </div>

        <div className="flex gap-3">
          {!hasCompass && !isCaptureComplete && (
            <button
              onClick={() => {
                // Manual capture fallback: snap the nearest uncaptured target.
                const active = nearestUncaptured();
                if (active) snapPhoto(active.id);
              }}
              className="flex-1 rounded-xl border border-white/40 px-4 py-2.5 font-medium hover:bg-white/10"
            >
              Manual Snap
            </button>
          )}
          
          <button
            onClick={() => setShowSummary(true)}
            disabled={capturedCount === 0}
            className="flex-1 rounded-xl bg-green-500 px-5 py-2.5 font-semibold hover:bg-green-600 disabled:opacity-40"
          >
            {isCaptureComplete ? 'Proceed to Stitch' : `Review (${capturedCount})`}
          </button>
        </div>

        {!hasCompass && (
          <p className="text-center text-[10px] text-white/50">
            No orientation sensor found. Drag to turn and press manual snap to capture.
          </p>
        )}
      </div>
    </div>
  );
}
