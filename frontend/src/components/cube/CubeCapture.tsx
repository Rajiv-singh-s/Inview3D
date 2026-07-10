'use client';

import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { CubeFaces } from './cubeFaces';
import { CubeScene, LookRef } from './CubeScene';
import { FACE_TARGETS, aimError, directionHint, readAim } from './orientation';
import { sharpness } from './quality';

/** Alignment tolerance (deg) to the target aim before capture can fire. */
const TOLERANCE_DEG = 12;
/** Hold aligned + steady this long before auto-capture, to reject transients. */
const DWELL_MS = 400;
/** Sweeping faster than this guarantees motion blur; refuse to capture. */
const MAX_ROTATION_DEG_PER_SEC = 20;
/** Frames below this Laplacian variance are rejected as blurred. */
const MIN_SHARPNESS = 10;
/**
 * Assumed horizontal field of view of the rear camera, in degrees — the one
 * intrinsic the browser will not tell us. Used to project each frame into cube
 * space. Typical phone main cameras sit around 65–70°.
 */
const CAMERA_HFOV_DEG = 68;

interface CubeCaptureProps {
  /** Called with the new project id once the finalized cube is stored. */
  onComplete: (projectId: string) => void;
  onCancel: () => void;
}

/**
 * The room cube is built live, during capture, exactly as the reference model
 * demands:
 *
 *   start -> empty black cube -> guide to a face -> validate (aim, stability,
 *   focus) -> auto-capture -> project onto that face instantly -> guide next
 *   -> ... -> finalize.
 *
 * The full-screen 3D view is the cube itself, seen from the inside and steered
 * by the device orientation, so the user watches the room appear around them as
 * they turn. The circular viewfinder shows the live camera that feeds it. There
 * is no post-capture stitch: finishing just uploads the six painted faces.
 */
export function CubeCapture({ onComplete, onCancel }: CubeCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cube = useMemo(() => new CubeFaces(), []);
  const look = useRef<LookRef>({ yaw: 0, pitch: 0 });

  // Orientation tracking, all in refs so the rAF loop reads current values.
  const baseYawRef = useRef<number | null>(null);
  const aimRef = useRef({ yaw: 0, pitch: 0 });
  const rotSpeedRef = useRef(0);
  const prevAimRef = useRef<{ yaw: number; pitch: number; t: number } | null>(null);
  const capturingRef = useRef(false);
  const dwellStartRef = useRef<number | null>(null);
  const targetIndexRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCompass, setHasCompass] = useState(false);
  const [targetIndex, setTargetIndex] = useState(0);
  const [paintedCount, setPaintedCount] = useState(0);
  const [flash, setFlash] = useState(false);
  const [dwell, setDwell] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const target = FACE_TARGETS[Math.min(targetIndex, FACE_TARGETS.length - 1)];
  const done = paintedCount >= FACE_TARGETS.length;

  // ---- camera ------------------------------------------------------------
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

  // ---- device orientation drives both aim and the live cube camera -------
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
    setTimeout(() => setFlash(false), 130);
  }, []);

  /** Grab the current video frame and project it into the cube at the given pose. */
  const captureFace = useCallback(
    (faceIndex: number): boolean => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || capturingRef.current) return false;
      const t = FACE_TARGETS[faceIndex];
      if (!t || cube.isCaptured(t.face)) return false;

      const sharp = sharpness(video, video.videoWidth, video.videoHeight);
      if (sharp < MIN_SHARPNESS) {
        setReason('Hold steady — too blurry');
        dwellStartRef.current = null;
        setDwell(0);
        return false;
      }

      capturingRef.current = true;
      const cap = document.createElement('canvas');
      cap.width = video.videoWidth;
      cap.height = video.videoHeight;
      cap.getContext('2d')!.drawImage(video, 0, 0);

      // Project the whole frame into cube space at the pose it was shot from.
      // With a compass that pose is the live orientation; without one, the
      // target's nominal direction is the best estimate.
      const pose = hasCompass ? aimRef.current : { yaw: t.yaw, pitch: t.pitch };
      cube.project(cap, pose, CAMERA_HFOV_DEG);

      setPaintedCount(cube.capturedCount());
      triggerFlash();
      setReason(null);
      dwellStartRef.current = null;
      setDwell(0);

      // Advance to the next face that still needs coverage.
      let next = faceIndex + 1;
      while (next < FACE_TARGETS.length && cube.isCaptured(FACE_TARGETS[next].face)) next++;
      targetIndexRef.current = next;
      setTargetIndex(next);

      setTimeout(() => (capturingRef.current = false), 500);
      return true;
    },
    [cube, hasCompass, triggerFlash],
  );

  // ---- auto-capture loop (compass mode) ----------------------------------
  useEffect(() => {
    if (!ready || !hasCompass || done || uploading) return;
    let raf = 0;
    const tick = () => {
      const idx = targetIndexRef.current;
      const t = FACE_TARGETS[idx];
      if (t && !cube.isCaptured(t.face)) {
        const err = aimError(aimRef.current, t);
        setHint(directionHint(aimRef.current, t, TOLERANCE_DEG));

        if (rotSpeedRef.current > MAX_ROTATION_DEG_PER_SEC) {
          setReason('Slow down');
          dwellStartRef.current = null;
          setDwell(0);
        } else if (err <= TOLERANCE_DEG) {
          setReason((r) => (r === 'Slow down' ? null : r));
          const now = performance.now();
          if (dwellStartRef.current == null) dwellStartRef.current = now;
          const held = now - dwellStartRef.current;
          setDwell(Math.min(1, held / DWELL_MS));
          if (held >= DWELL_MS) captureFace(idx);
        } else {
          setReason((r) => (r === 'Slow down' ? null : r));
          dwellStartRef.current = null;
          setDwell(0);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, hasCompass, done, uploading, cube, captureFace]);

  // ---- drag to look around (no-compass fallback) -------------------------
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
            dwell > 0 ? 'border-green-400' : 'border-white/80'
          }`}
          style={{ width: 190, height: 190 }}
        >
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          {/* Dwell progress ring */}
          {dwell > 0 && (
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
              <path
                fill="none"
                stroke="rgba(74,222,128,0.95)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${dwell * 100}, 100`}
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
          )}
        </div>
      </div>

      {/* Capture flash */}
      <div
        className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-150"
        style={{ opacity: flash ? 0.55 : 0 }}
      />

      {/* Top bar: cancel + progress */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
        <button
          onClick={onCancel}
          className="grid h-9 w-9 place-items-center rounded-full bg-red-500 text-white"
          aria-label="Cancel"
        >
          ✕
        </button>
        <span className="rounded-full bg-black/50 px-3 py-1 text-sm font-semibold text-white backdrop-blur-sm">
          {paintedCount} of {FACE_TARGETS.length} faces
        </span>
      </div>

      {/* Guidance */}
      <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/85 to-transparent p-4">
        {!done && (
          <p className="text-center text-base font-semibold text-white">
            {uploading ? 'Finalizing room…' : `Aim at the ${target.label}`}
          </p>
        )}
        {message && !done && !uploading && (
          <p
            className={`text-center text-sm font-medium ${
              reason ? 'text-amber-300' : 'text-white/80'
            }`}
          >
            {message}
          </p>
        )}

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-green-500 transition-[width]"
            style={{ width: `${(paintedCount / FACE_TARGETS.length) * 100}%` }}
          />
        </div>

        <div className="flex gap-3">
          {!hasCompass && !done && (
            <button
              onClick={() => captureFace(targetIndexRef.current)}
              disabled={uploading}
              className="flex-1 rounded-xl border border-white/40 px-4 py-2.5 font-medium text-white disabled:opacity-40"
            >
              Capture {target.label}
            </button>
          )}
          <button
            onClick={finalize}
            disabled={paintedCount < 1 || uploading}
            className="flex-1 rounded-xl bg-green-500 px-5 py-2.5 font-medium text-white disabled:opacity-40"
          >
            {uploading ? 'Uploading…' : done ? 'Finish room' : `Finish (${paintedCount})`}
          </button>
        </div>
        {!hasCompass && (
          <p className="text-center text-[11px] text-white/60">
            No motion sensor — drag to look around the cube, and capture each wall in turn.
          </p>
        )}
      </div>
    </div>
  );
}
