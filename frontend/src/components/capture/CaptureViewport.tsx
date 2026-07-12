'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCaptureStore } from '@/store/captureStore';

/** 16 capture targets: 8-dot horizon ring + 4 up + 4 down. */
const TARGETS: { id: number; yaw: number; pitch: number }[] = [
  ...[0, 45, 90, 135, 180, 225, 270, 315].map((yaw, i) => ({ id: i, yaw, pitch: 0 })),
  ...[45, 135, 225, 315].map((yaw, i) => ({ id: 8 + i, yaw, pitch: 45 })),
  ...[45, 135, 225, 315].map((yaw, i) => ({ id: 12 + i, yaw, pitch: -45 })),
];

/** Degrees→screen-percent placement for the world-anchored dots. */
const KX = 0.85;
const KY = 0.78;
/** Only targets within this cone of the aim are drawn. */
const VISIBLE_CONE = 70;
/** Alignment radius + dwell before auto-capture. */
const TOLERANCE = 11;
const DWELL_MS = 300;

function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

function readAim(e: DeviceOrientationEvent): { yaw: number; pitch: number } | null {
  const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  const yawRaw = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
  if (yawRaw == null || Number.isNaN(yawRaw)) return null;
  // Phone upright (portrait) → beta ≈ 90 → pitch 0; tilt up to the ceiling → pitch +.
  // Some devices omit beta; fall back to a level pitch so the horizon dots still show.
  const pitch = e.beta != null ? Math.max(-90, Math.min(90, e.beta - 90)) : 0;
  return { yaw: ((yawRaw % 360) + 360) % 360, pitch };
}

/**
 * Guided capture matching docs/first video.mp4: the live camera fills the
 * screen, a thin white viewfinder box sits in the centre, large green target
 * dots float over the scene and move as you turn, and the centre reticle shows a
 * directional arrow toward the next dot then pie-fills and auto-captures when a
 * dot reaches it — no shutter button.
 */
export const CaptureViewport: React.FC = () => {
  const router = useRouter();
  const store = useCaptureStore();

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const aimRef = useRef({ yaw: 0, pitch: 0 });
  const baseYawRef = useRef<number | null>(null);
  const capturedRef = useRef<Record<number, boolean>>({});
  const dwellStartRef = useRef<number | null>(null);
  const capturingRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasCompass, setHasCompass] = useState(false);
  const [aim, setAim] = useState({ yaw: 0, pitch: 0 });
  const [dwell, setDwell] = useState(0);
  const [flash, setFlash] = useState(false);
  const [count, setCount] = useState(0);

  // capture the current full camera frame + a real blob
  const capture = useCallback(
    (targetId: number) => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || capturingRef.current) return;
      capturingRef.current = true;

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      const thumb = canvas.toDataURL('image/jpeg', 0.5);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            capturedRef.current[targetId] = true;
            store.addFrame({
              targetId,
              blob,
              thumbnailUrl: thumb,
              pose: { yaw: aimRef.current.yaw, pitch: aimRef.current.pitch, roll: 0, timestamp: Date.now() },
              sharpness: 1,
            });
            setCount(Object.keys(capturedRef.current).length);
            setFlash(true);
            setTimeout(() => setFlash(false), 110);
          }
          dwellStartRef.current = null;
          setDwell(0);
          setTimeout(() => (capturingRef.current = false), 280);
        },
        'image/jpeg',
        0.9,
      );
    },
    [store],
  );

  /** Requests motion access. On iOS this MUST run first in the tap gesture. */
  const requestMotion = useCallback(async () => {
    const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D?.requestPermission === 'function') {
      try {
        await D.requestPermission();
      } catch {
        /* denied — capture still runs, just without dot guidance */
      }
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    // 1) Motion permission FIRST — an `await getUserMedia` before this breaks the
    //    iOS user-gesture requirement and silently kills device orientation.
    await requestMotion();
    // 2) Camera.
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      streamRef.current = stream;
      setStarted(true);
    } catch (err) {
      setError(`Could not access the camera: ${(err as Error).message}`);
    }
  }, [requestMotion]);

  // attach the stream once the <video> mounts
  useEffect(() => {
    if (started && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => undefined);
    }
  }, [started]);

  useEffect(() => {
    if (!started) return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      const raw = readAim(e);
      if (!raw) return;
      setHasCompass(true);
      if (baseYawRef.current == null) baseYawRef.current = raw.yaw;
      const yaw = ((raw.yaw - baseYawRef.current) % 360 + 360) % 360;
      aimRef.current = { yaw, pitch: raw.pitch };
      setAim(aimRef.current);
    };
    window.addEventListener('deviceorientation', onOrientation, true);
    // Some Android builds only fire the absolute variant.
    window.addEventListener('deviceorientationabsolute', onOrientation as EventListener, true);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation, true);
      window.removeEventListener('deviceorientationabsolute', onOrientation as EventListener, true);
    };
  }, [started]);

  const nearest = useMemo(() => {
    let best: { id: number; err: number; dYaw: number; dPitch: number } | null = null;
    for (const t of TARGETS) {
      if (capturedRef.current[t.id]) continue;
      const dYaw = angleDelta(aim.yaw, t.yaw);
      const dPitch = t.pitch - aim.pitch;
      const err = Math.hypot(dYaw * Math.cos((aim.pitch * Math.PI) / 180), dPitch);
      if (!best || err < best.err) best = { id: t.id, err, dYaw, dPitch };
    }
    return best;
  }, [aim, count]);

  useEffect(() => {
    if (!started) return;
    let raf = 0;
    const tick = () => {
      let best: { id: number; err: number } | null = null;
      for (const t of TARGETS) {
        if (capturedRef.current[t.id]) continue;
        const dYaw = angleDelta(aimRef.current.yaw, t.yaw) * Math.cos((aimRef.current.pitch * Math.PI) / 180);
        const err = Math.hypot(dYaw, t.pitch - aimRef.current.pitch);
        if (!best || err < best.err) best = { id: t.id, err };
      }
      if (best && best.err <= TOLERANCE && !capturingRef.current) {
        const now = performance.now();
        if (dwellStartRef.current == null) dwellStartRef.current = now;
        const held = now - dwellStartRef.current;
        setDwell(Math.min(1, held / DWELL_MS));
        if (held >= DWELL_MS) capture(best.id);
      } else {
        dwellStartRef.current = null;
        setDwell(0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, capture]);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  // world-anchored dots projected onto the screen (centre = current aim)
  const dots = useMemo(() => {
    if (!hasCompass) return [];
    return TARGETS.flatMap((t) => {
      if (capturedRef.current[t.id]) return [];
      const dYaw = angleDelta(aim.yaw, t.yaw);
      const dPitch = t.pitch - aim.pitch;
      if (Math.abs(dYaw) > VISIBLE_CONE || Math.abs(dPitch) > VISIBLE_CONE) return [];
      return [{
        id: t.id,
        x: Math.max(4, Math.min(96, 50 + dYaw * KX)),
        y: Math.max(8, Math.min(92, 50 - dPitch * KY)),
      }];
    });
  }, [aim, hasCompass, count]);

  const aligned = dwell > 0;
  const arrowDeg =
    nearest && !aligned ? (Math.atan2(-nearest.dPitch * KY, nearest.dYaw * KX) * 180) / Math.PI : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black touch-none select-none">
      {/* Full-screen live camera */}
      {started && <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted autoPlay />}

      {/* Start gate (also satisfies the iOS motion-permission gesture) */}
      {!started && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black p-6 text-center text-white">
          <h2 className="text-2xl font-bold">Capture your room</h2>
          <p className="max-w-xs text-[15px] text-white/70">
            Stand in one spot and slowly turn. Line each green dot up with the centre — photos are
            taken automatically.
          </p>
          <button onClick={start} className="mt-3 rounded-full bg-[#4040ff] px-8 py-3.5 font-bold tracking-wide">
            Start capture
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      )}

      {started && (
        <>
          {/* Thin white viewfinder box (overlay, centred) */}
          <div
            className="pointer-events-none absolute z-20 rounded-md border-[1.5px] border-white/80"
            style={{ left: '50%', top: '50%', width: '58%', height: '52%', transform: 'translate(-50%, -50%)' }}
          />

          {/* Large green target dots */}
          {dots.map((d) => {
            const active = d.id === nearest?.id;
            const size = active ? 52 : 44;
            return (
              <div
                key={d.id}
                className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#22c55e]"
                style={{
                  left: `${d.x}%`,
                  top: `${d.y}%`,
                  width: size,
                  height: size,
                  boxShadow: active ? '0 0 14px rgba(34,197,94,0.8)' : '0 0 6px rgba(0,0,0,0.4)',
                }}
              />
            );
          })}

          {/* Centre reticle + directional arrow / green pie-fill */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2">
            {arrowDeg != null && (
              <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2" style={{ transform: `translate(-50%,-50%) rotate(${arrowDeg}deg)` }}>
                <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-full text-2xl font-bold text-white drop-shadow">›</span>
              </div>
            )}
            <div className={`relative grid h-[68px] w-[68px] place-items-center rounded-full border-[3px] drop-shadow ${aligned ? 'border-green-400' : 'border-white'}`}>
              <div className={`h-3 w-3 rounded-full ${aligned ? 'bg-green-400' : 'bg-transparent'}`} />
              {aligned && (
                <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
                  <path fill="none" stroke="#16a34a" strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${dwell * 100}, 100`}
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                </svg>
              )}
            </div>
          </div>

          {/* Capture flash */}
          <div className="pointer-events-none absolute inset-0 z-40 bg-white transition-opacity duration-100" style={{ opacity: flash ? 0.55 : 0 }} />

          {/* Top HUD */}
          <div className="absolute inset-x-0 top-0 z-40 flex items-center justify-between p-5">
            <button
              onClick={() => {
                const ids = Object.keys(capturedRef.current).map(Number).sort((a, b) => b - a);
                if (ids.length) {
                  store.removeFrame(ids[0]);
                  delete capturedRef.current[ids[0]];
                  setCount(Object.keys(capturedRef.current).length);
                }
              }}
              className="grid h-10 w-10 place-items-center rounded-full bg-white/85 text-lg text-slate-900"
              aria-label="Undo"
            >
              ↺
            </button>
            <button
              onClick={() => {
                store.resetCapture();
                router.push('/');
              }}
              className="grid h-10 w-10 place-items-center rounded-full bg-red-500 text-white"
              aria-label="Cancel"
            >
              ✕
            </button>
          </div>

          {/* Bottom HUD: instruction + progress */}
          <div className="absolute inset-x-0 bottom-0 z-40 space-y-2 p-5 text-white">
            {count === 0 && (
              <p className="text-center text-sm font-medium drop-shadow">
                Shoot all photos from the same spot to ensure an optimal result.
              </p>
            )}
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-green-500 transition-[width]" style={{ width: `${(count / 16) * 100}%` }} />
              </div>
              <span className="text-sm font-semibold tabular-nums">{count} of 16</span>
            </div>
            {!hasCompass && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-center text-[12px] text-amber-300">
                  Motion sensor not active — dots need it. Tap Enable, or capture manually.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={requestMotion}
                    className="pointer-events-auto rounded-full bg-white/90 px-4 py-1.5 text-xs font-semibold text-slate-900"
                  >
                    Enable motion
                  </button>
                  <button
                    onClick={() => {
                      const next = TARGETS.find((t) => !capturedRef.current[t.id]);
                      if (next) capture(next.id);
                    }}
                    className="pointer-events-auto rounded-full bg-green-500 px-4 py-1.5 text-xs font-semibold text-white"
                  >
                    Capture
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
