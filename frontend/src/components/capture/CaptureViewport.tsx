'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCaptureStore } from '@/store/captureStore';
import { StitchedWorld } from './StitchedWorld';

/** 16 capture targets over the sphere: 8-dot horizon ring + 4 up + 4 down. */
const TARGETS: { id: number; yaw: number; pitch: number }[] = [
  ...[0, 45, 90, 135, 180, 225, 270, 315].map((yaw, i) => ({ id: i, yaw, pitch: 0 })),
  ...[0, 90, 180, 270].map((yaw, i) => ({ id: 8 + i, yaw, pitch: 42 })),
  ...[0, 90, 180, 270].map((yaw, i) => ({ id: 12 + i, yaw, pitch: -42 })),
];

/** Reticle sits at the centre of the camera box (upper-centre of the screen). */
const RETICLE_X = 50; // %
const RETICLE_Y = 45; // %
/** Degrees→percent placement, tuned so the camera-box edge ≈ the camera FOV. */
const KX = 0.95;
const KY = 0.8;
/** Only targets within this cone of the aim are drawn. */
const VISIBLE_CONE = 72;
/** Alignment + dwell for auto-capture. */
const TOLERANCE = 11;
const DWELL_MS = 320;

function angleDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

function readAim(e: DeviceOrientationEvent): { yaw: number; pitch: number } | null {
  const webkit = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
  const yawRaw = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
  if (yawRaw == null || Number.isNaN(yawRaw) || e.beta == null) return null;
  return { yaw: ((yawRaw % 360) + 360) % 360, pitch: Math.max(-90, Math.min(90, e.beta - 90)) };
}

/**
 * Guided capture matching the reference app: the live camera sits in a bordered
 * box in the upper-centre, green target dots float around it and move as you
 * turn, a centre reticle shows a directional arrow toward the next dot, and each
 * dot auto-captures when it reaches the centre — no shutter button.
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
          setTimeout(() => (capturingRef.current = false), 300);
        },
        'image/jpeg',
        0.9,
      );
    },
    [store],
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
        .catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof D?.requestPermission === 'function') {
        try {
          await D.requestPermission();
        } catch {
          /* optional */
        }
      }
      setStarted(true);
    } catch (err) {
      setError(`Could not access the camera: ${(err as Error).message}`);
    }
  }, []);

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
    return () => window.removeEventListener('deviceorientation', onOrientation, true);
  }, [started]);

  // nearest uncaptured target, for the arrow/hint and capture
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

  // project uncaptured targets within the cone onto the screen
  const dots = useMemo(() => {
    if (!hasCompass) return [];
    return TARGETS.flatMap((t) => {
      if (capturedRef.current[t.id]) return [];
      const dYaw = angleDelta(aim.yaw, t.yaw);
      const dPitch = t.pitch - aim.pitch;
      if (Math.abs(dYaw) > VISIBLE_CONE || Math.abs(dPitch) > VISIBLE_CONE) return [];
      const x = Math.max(2, Math.min(98, RETICLE_X + dYaw * KX));
      const y = Math.max(6, Math.min(92, RETICLE_Y - dPitch * KY));
      return [{ id: t.id, x, y }];
    });
  }, [aim, hasCompass, count]);

  const aligned = dwell > 0;
  // arrow angle from reticle toward the nearest target's projected position
  const arrowDeg =
    nearest && !aligned
      ? (Math.atan2(-nearest.dPitch * KY, nearest.dYaw * KX) * 180) / Math.PI
      : null;
  const hint =
    nearest && !aligned
      ? Math.abs(nearest.dYaw) >= Math.abs(nearest.dPitch)
        ? nearest.dYaw > 0
          ? 'Turn right'
          : 'Turn left'
        : nearest.dPitch > 0
          ? 'Tilt up'
          : 'Tilt down'
      : null;

  useEffect(() => {
    if (count >= 16) {
      setTimeout(() => router.push('/review'), 500);
    }
  }, [count, router]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black touch-none select-none">
      {/* LAYER 0: The 3D AR Background of captured photos */}
      {started && (
        <div className="absolute inset-0 z-0">
          <StitchedWorld 
            currentAim={aim} 
            capturedFrames={store.capturedFrames} 
          />
        </div>
      )}

      {/* Start gate (also satisfies the iOS motion-permission gesture) */}
      {!started && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-slate-950 p-6 text-center text-white">
          <h2 className="text-xl font-bold">Capture your room</h2>
          <p className="max-w-xs text-sm text-slate-400">
            Stand in one spot and slowly turn. Line each green dot up with the centre — photos are
            taken automatically.
          </p>
          <button onClick={start} className="rounded-2xl bg-indigo-500 px-8 py-3 font-semibold">
            Start capture
          </button>
          {error && <p className="text-sm text-red-300">{error}</p>}
        </div>
      )}

      {/* Camera box (upper-centre, bordered) */}
      {started && (
        <div
          className="absolute overflow-hidden border-2 border-white/80 z-10 bg-black"
          style={{ left: '50%', top: '20%', width: '64%', height: '50%', transform: 'translateX(-50%)' }}
        >
          <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
        </div>
      )}

      {/* Floating target dots (over the whole screen) */}
      {started &&
        dots.map((d) => (
          <div
            key={d.id}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-500 transition-all duration-75 z-20"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: d.id === nearest?.id ? 26 : 20,
              height: d.id === nearest?.id ? 26 : 20,
              boxShadow: d.id === nearest?.id ? '0 0 10px rgba(34,197,94,0.7)' : 'none',
            }}
          />
        ))}

      {/* Centre reticle with directional arrow / green pie-fill */}
      {started && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 z-30"
          style={{ left: `${RETICLE_X}%`, top: `${RETICLE_Y}%` }}
        >
          <div className={`relative grid h-16 w-16 place-items-center rounded-full border-2 ${aligned ? 'border-green-400 bg-green-500/25' : 'border-white/80'}`}>
            <div className={`h-2.5 w-2.5 rounded-full ${aligned ? 'bg-green-400' : 'bg-white/80'}`} />
            {aligned && (
              <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 36 36">
                <path fill="none" stroke="#4ade80" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={`${dwell * 100}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
            )}
            {arrowDeg != null && (
              <div className="absolute" style={{ transform: `rotate(${arrowDeg}deg) translateX(26px)` }}>
                <span className="text-lg font-bold text-green-400">›</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Capture flash */}
      <div className="pointer-events-none absolute inset-0 bg-white transition-opacity duration-100 z-40" style={{ opacity: flash ? 0.5 : 0 }} />

      {/* Top HUD */}
      {started && (
        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-6 z-50">
          <button
            onClick={() => {
              const ids = Object.keys(capturedRef.current).map(Number).sort((a, b) => b - a);
              if (ids.length) {
                store.removeFrame(ids[0]);
                delete capturedRef.current[ids[0]];
                setCount(Object.keys(capturedRef.current).length);
              }
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md text-white text-xl border border-white/30"
            aria-label="Undo"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          </button>
          <button
            onClick={() => {
              store.resetCapture();
              router.push('/');
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md text-white border border-white/30"
            aria-label="Cancel"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      )}

      {/* Bottom HUD: hint / instruction + progress */}
      {started && (
        <div className="absolute inset-x-0 bottom-0 z-50 p-6 pt-12 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
          <p className="text-center text-[13px] font-bold text-white mb-6 tracking-wide drop-shadow-md">
            {count === 0
              ? 'Shoot all photos from the same spot as your initial photo to ensure an optimal result.'
              : (hint ?? 'Hold steady…')}
          </p>
          <div className="flex items-center gap-4">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/20 backdrop-blur-md border border-white/10">
              <div className="h-full rounded-full bg-green-500 transition-all duration-300" style={{ width: `${(count / 16) * 100}%` }} />
            </div>
            <span className="text-[13px] font-bold text-white tabular-nums w-12 text-right">{count} of 16</span>
          </div>
          {!hasCompass && (
            <p className="text-center text-[11px] text-white/60 mt-2">
              No motion sensor detected — the dots need a phone gyroscope.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
