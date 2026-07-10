'use client';

import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { CubeFaces } from './cubeFaces';
import { CubeScene, LookRef } from './CubeScene';
import { angleDelta, coverageHint, readAim } from './orientation';
import { sharpness } from './quality';

// ---- Tuning Constants -----------------------------------------------------

/** Sweeping faster than this guarantees motion blur; refuse to capture. */
const MAX_ROTATION_DEG_PER_SEC = 20;
/** Frames below this Laplacian variance are rejected as blurred. */
const MIN_SHARPNESS = 8;
/** Minimum angular rotation (deg) since last accepted frame before capturing again. */
const MIN_ROTATION_SINCE_LAST = 5;
/** Minimum milliseconds between accepted frames, to avoid overwhelming the projector. */
const MIN_CAPTURE_INTERVAL_MS = 200;
/**
 * Assumed horizontal field of view of the rear camera, in degrees.
 * Typical phone main cameras sit around 65–70°.
 */
const CAMERA_HFOV_DEG = 68;
/** Coverage fraction at which the capture auto-completes. */
const AUTO_COMPLETE_COVERAGE = 0.92;
/** Hard ceiling — stop accepting frames past this coverage. */
const HARD_LIMIT_COVERAGE = 0.98;

interface CubeCaptureProps {
  /** Called with the new project id once the finalized cube is stored. */
  onComplete: (projectId: string) => void;
  onCancel: () => void;
}

/**
 * Continuous cubemap capture engine.
 *
 * The user sees a live 3D cube from the inside, steered by their phone's
 * orientation. As they rotate freely, frames are automatically accepted when
 * stable + sharp + sufficiently rotated, and projected into the cubemap in
 * real time. The room appears around them progressively. No predefined face
 * targets, no shutter button — just rotate and watch.
 */
export function CubeCapture({ onComplete, onCancel }: CubeCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cube = useMemo(() => new CubeFaces(), []);
  const look = useRef<LookRef>({ yaw: 0, pitch: 0 });

  // Orientation tracking — all in refs so the rAF loop reads current values.
  const baseYawRef = useRef<number | null>(null);
  const aimRef = useRef({ yaw: 0, pitch: 0 });
  const rotSpeedRef = useRef(0);
  const prevAimRef = useRef<{ yaw: number; pitch: number; t: number } | null>(null);

  // Continuous capture state
  const lastCaptureAimRef = useRef<{ yaw: number; pitch: number } | null>(null);
  const lastCaptureTimeRef = useRef(0);
  const capturingRef = useRef(false);
  const acceptedCountRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCompass, setHasCompass] = useState(false);
  const [coverage, setCoverage] = useState(0);
  const [acceptedCount, setAcceptedCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [autoCompleted, setAutoCompleted] = useState(false);

  const done = coverage >= AUTO_COMPLETE_COVERAGE || autoCompleted;

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
      cube.dispose();
    };
  }, [cube]);

  // ---- device orientation drives both aim and the live cube camera ---------
  useEffect(() => {
    const onOrientation = (e: DeviceOrientationEvent) => {
      const raw = readAim(e);
      if (!raw) return;
      setHasCompass(true);
      if (baseYawRef.current == null) baseYawRef.current = raw.yaw;

      // Relative to the origin established on the first frame (front = 0).
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
      look.current = aim; // the 3D cube looks where the phone points
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, []);

  const triggerFlash = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 100);
  }, []);

  /** Grab the current video frame and project it into the cube. */
  const captureFrame = useCallback((): boolean => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || capturingRef.current) return false;

    const sharp = sharpness(video, video.videoWidth, video.videoHeight);
    if (sharp < MIN_SHARPNESS) {
      setReason('Hold steady — too blurry');
      return false;
    }

    capturingRef.current = true;
    const cap = document.createElement('canvas');
    cap.width = video.videoWidth;
    cap.height = video.videoHeight;
    cap.getContext('2d')!.drawImage(video, 0, 0);

    // Project the whole frame into cube space at the current device orientation.
    const pose = aimRef.current;
    cube.project(cap, pose, CAMERA_HFOV_DEG, sharp);

    // Update state
    const newCoverage = cube.totalCoverage();
    setCoverage(newCoverage);
    acceptedCountRef.current++;
    setAcceptedCount(acceptedCountRef.current);
    lastCaptureAimRef.current = { ...pose };
    lastCaptureTimeRef.current = performance.now();

    triggerFlash();
    setReason(null);

    // Check auto-complete
    if (newCoverage >= AUTO_COMPLETE_COVERAGE) {
      setAutoCompleted(true);
    }

    setTimeout(() => (capturingRef.current = false), 150);
    return true;
  }, [cube, triggerFlash]);

  // ---- continuous auto-capture loop (compass mode) -------------------------
  useEffect(() => {
    if (!ready || !hasCompass || uploading) return;

    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const aim = aimRef.current;
      const currentCoverage = cube.totalCoverage();

      // Stop capturing if we've reached the hard limit
      if (currentCoverage >= HARD_LIMIT_COVERAGE) {
        setHint('Room capture complete!');
        raf = requestAnimationFrame(tick);
        return;
      }

      // Update the nudge hint periodically
      const nudge = coverageHint(cube);
      setHint(nudge);

      // Check if conditions are right for a capture
      const timeSinceLastCapture = now - lastCaptureTimeRef.current;
      const rotSpeed = rotSpeedRef.current;

      if (rotSpeed > MAX_ROTATION_DEG_PER_SEC) {
        setReason('Slow down…');
      } else if (timeSinceLastCapture > MIN_CAPTURE_INTERVAL_MS) {
        // Check rotation since last accepted frame
        const lastAim = lastCaptureAimRef.current;
        let rotationSinceLast = Infinity; // first capture always accepted
        if (lastAim) {
          const dYaw = angleDelta(lastAim.yaw, aim.yaw);
          const dPitch = aim.pitch - lastAim.pitch;
          rotationSinceLast = Math.hypot(dYaw, dPitch);
        }

        if (rotationSinceLast >= MIN_ROTATION_SINCE_LAST) {
          setReason(null);
          captureFrame();
        } else {
          setReason(null); // stable but hasn't rotated enough — that's fine, no warning
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, hasCompass, uploading, cube, captureFrame]);

  // ---- drag to look around (no-compass fallback) ---------------------------
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
  };
  const endDrag = () => (dragging.current = false);

  const finalize = async () => {
    setUploading(true);
    setReason(null);
    try {
      const faces = await cube.exportFaces();
      const res = await api.uploadCube(faces, `Room ${new Date().toLocaleString()}`);
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

  const coveragePct = Math.round(coverage * 100);
  const statusText = uploading
    ? 'Finalizing room…'
    : done
      ? 'Capture complete!'
      : coveragePct > 0
        ? 'Keep rotating slowly…'
        : 'Start by looking around the room';

  const message = reason ?? hint;

  return (
    <div
      className="relative mx-auto h-[78vh] w-full max-w-md touch-none select-none overflow-hidden rounded-2xl border border-slate-800 bg-black"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      {/* The room cube being built, seen from the inside. */}
      <Canvas camera={{ fov: 80, position: [0, 0, 0], near: 0.1, far: 100 }} dpr={[1, 2]}>
        <CubeScene faces={cube} look={look} />
      </Canvas>

      {/* Live camera viewfinder — the source feeding the cube. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div
          className={`relative grid place-items-center overflow-hidden rounded-full border-4 transition-all ${
            acceptedCount > 0 ? 'border-green-400/80' : 'border-white/80'
          }`}
          style={{ width: 180, height: 180 }}
        >
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        </div>
      </div>

      {/* Capture flash */}
      <div
        className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-100"
        style={{ opacity: flash ? 0.45 : 0 }}
      />

      {/* Top bar: cancel + coverage % */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <button
          onClick={onCancel}
          className="grid h-9 w-9 place-items-center rounded-full bg-red-500 text-white"
          aria-label="Cancel"
        >
          ✕
        </button>
        <span className="rounded-full bg-black/50 px-3 py-1 text-sm font-semibold text-white backdrop-blur-sm tabular-nums">
          {coveragePct}% captured
        </span>
      </div>

      {/* Guidance */}
      <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/85 to-transparent p-4">
        <p className="text-center text-base font-semibold text-white">
          {statusText}
        </p>
        {message && !done && !uploading && (
          <p
            className={`text-center text-sm font-medium ${
              reason ? 'text-amber-300' : 'text-white/80'
            }`}
          >
            {message}
          </p>
        )}

        {/* Coverage progress bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-green-500 transition-[width] duration-300"
            style={{ width: `${coveragePct}%` }}
          />
        </div>

        <div className="flex gap-3">
          {!hasCompass && !done && (
            <button
              onClick={() => {
                // For no-compass fallback: manually capture at the current look direction
                aimRef.current = look.current;
                captureFrame();
              }}
              disabled={uploading}
              className="flex-1 rounded-xl border border-white/40 px-4 py-2.5 font-medium text-white disabled:opacity-40"
            >
              Capture here
            </button>
          )}
          <button
            onClick={finalize}
            disabled={acceptedCount < 1 || uploading}
            className="flex-1 rounded-xl bg-green-500 px-5 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {uploading ? 'Uploading…' : done ? 'Finish room' : `Finish (${coveragePct}%)`}
          </button>
        </div>
        {!hasCompass && (
          <p className="text-center text-[11px] text-white/60">
            No motion sensor — drag to look around the cube, and capture each direction in turn.
          </p>
        )}
      </div>
    </div>
  );
}
